/**
 * models/database.js
 * ------------------------------------------------------------------
 * SQLite connection singleton. On startup the application calls
 * `initialize()` which:
 *   1. Ensures the data/ directory exists
 *   2. Opens (or creates) the SQLite file
 *   3. Enables WAL mode for better concurrent read performance
 *   4. Runs all migration SQL statements to create/update tables
 *
 * The module exports a promise-based wrapper around sqlite3 so
 * every other file can simply:  const db = require('../models/database');
 *                                const row = await db.get(...);
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const serverConfig = require('../config/server');

// ---------------------------------------------------------------------------
// Ensure data directory exists before opening the database file.
// ---------------------------------------------------------------------------
const dataDir = path.dirname(serverConfig.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Open (or create) the SQLite database.
// ---------------------------------------------------------------------------
let _db = null;

function getDb() {
  if (!_db) {
    _db = new sqlite3.Database(serverConfig.dbPath, (err) => {
      if (err) {
        console.error('[DB] Failed to open database:', err.message);
      } else {
        console.log('[DB] Opened:', serverConfig.dbPath);
      }
    });
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Promisified helpers — sqlite3 callbacks → async/await.
// ---------------------------------------------------------------------------

/**
 * Run a SQL statement (INSERT/UPDATE/DELETE/CREATE).
 */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) return reject(err);
      // `this` contains lastID and changes for INSERT/UPDATE/DELETE
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * Get a single row.
 */
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Get all matching rows.
 */
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ---------------------------------------------------------------------------
// Initialization — enable WAL mode, run migrations, schedule cleanup.
// ---------------------------------------------------------------------------
async function initialize() {
  try {
    // Enable WAL journal mode for better concurrent performance.
    await run('PRAGMA journal_mode = WAL');
    // Enable foreign key support (off by default in SQLite).
    await run('PRAGMA foreign_keys = ON');

    // Load and execute migration SQL.
    const migrationPath = path.resolve(__dirname, '../migrations/001_create_tables.sql');
    if (fs.existsSync(migrationPath)) {
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      // Split on semicolons to execute statements individually.
      const statements = migrationSQL
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        await run(stmt);
      }
      console.log('[DB] Migrations executed successfully');
    }

    // Schedule periodic cleanup of old data (every 6 hours).
    setInterval(cleanupOldData, 6 * 60 * 60 * 1000);
    // Run cleanup once on startup.
    await cleanupOldData();

    console.log('[DB] Initialised');
  } catch (err) {
    console.error('[DB] Initialisation error:', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Housekeeping — delete readings older than the configured retention period.
// ---------------------------------------------------------------------------
async function cleanupOldData() {
  try {
    const cutoff = new Date(Date.now() - serverConfig.retentionDays * 86400000).toISOString();
    const { changes } = await run(
      'DELETE FROM sensor_readings WHERE timestamp < ?',
      [cutoff]
    );
    if (changes > 0) {
      console.log(`[DB] Purged ${changes} old sensor readings (before ${cutoff})`);
    }
  } catch (err) {
    console.error('[DB] Cleanup error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown.
// ---------------------------------------------------------------------------
function close() {
  return new Promise((resolve) => {
    if (_db) {
      _db.close((err) => {
        if (err) console.error('[DB] Close error:', err.message);
        _db = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = { initialize, run, get, all, close, getDb };