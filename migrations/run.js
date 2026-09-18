/**
 * migrations/run.js
 * ------------------------------------------------------------------
 * Database initialisation runner for MongoDB.  Connects to the
 * configured MongoDB server and ensures every collection + index
 * exists.  Run with:  npm run migrate
 *
 * Usage:
 *   node migrations/run.js
 */
const db = require('../models/database');

(async () => {
  try {
    console.log('[MIGRATE] Connecting to MongoDB...');
    await db.initialize();
    console.log('[MIGRATE] Done. Collections and indexes are ready.');
    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('[MIGRATE] Failed:', err.message);
    process.exit(1);
  }
})();