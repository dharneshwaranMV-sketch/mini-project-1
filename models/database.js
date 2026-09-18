/**
 * models/database.js
 * ------------------------------------------------------------------
 * MongoDB connection singleton (Mongoose). On startup the application
 * calls `initialize()` which:
 *   1. Connects to the configured MongoDB server
 *   2. Registers every model and ensures its indexes exist
 *   3. Schedules periodic retention cleanup
 *
 * Every data layer simply requires its own Mongoose model; the
 * connection itself is shared process-wide by Mongoose.
 */
const mongoose = require('mongoose');
const serverConfig = require('../config/server');

let cleanupTimer = null;

// ---------------------------------------------------------------------------
// Connect + prepare collections.
// ---------------------------------------------------------------------------
async function initialize() {
  if (mongoose.connection.readyState === 1) return;

  try {
    mongoose.set('strictQuery', true);

    await mongoose.connect(serverConfig.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    const { host, port, name } = mongoose.connection;
    console.log(`[DB] Connected to MongoDB: ${host}:${port}/${name}`);

    // Register models + build their indexes.
    const sensorData = require('./sensorData');
    const device = require('./device');
    const alert = require('./alert');
    await Promise.all([
      sensorData.ensureIndexes(),
      device.ensureIndexes(),
      alert.ensureIndexes(),
    ]);
    console.log('[DB] Indexes ensured');

    // Schedule periodic cleanup of old data (every 6 hours).
    if (!cleanupTimer) {
      cleanupTimer = setInterval(cleanupOldData, 6 * 60 * 60 * 1000);
    }
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
    const cutoff = new Date(Date.now() - serverConfig.retentionDays * 86400000);
    const result = await require('./sensorData').deleteOlderThan(cutoff);
    if (result && result.deletedCount > 0) {
      console.log(`[DB] Purged ${result.deletedCount} old sensor readings (before ${cutoff.toISOString()})`);
    }
  } catch (err) {
    console.error('[DB] Cleanup error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown.
// ---------------------------------------------------------------------------
async function close() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    console.log('[DB] Connection closed');
  }
}

module.exports = { initialize, close, mongoose };
