/**
 * migrations/run.js
 * ------------------------------------------------------------------
 * Migration runner.  Simply initialises the database module which
 * executes every *.sql migration in order (currently just the schema
 * file).  Run with:  npm run migrate
 *
 * Usage:
 *   node migrations/run.js
 */
const db = require('../models/database');

(async () => {
  try {
    console.log('[MIGRATE] Starting database migration...');
    await db.initialize();
    console.log('[MIGRATE] Done. Schema is ready.');
    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('[MIGRATE] Failed:', err.message);
    process.exit(1);
  }
})();