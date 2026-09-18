/**
 * migrations/sqlite-to-mongo.js
 * ------------------------------------------------------------------
 * One-time data migration: copies the legacy SQLite dashboard data
 * (data/motor_inspection.db) into MongoDB.
 *
 * Uses Node's built-in `node:sqlite` module, so it does NOT require
 * the native `sqlite3` package to be installed.
 *
 * Run with:  npm run migrate:sqlite
 *
 * Safe to run more than once — devices are upserted and readings are
 * guarded by (deviceId + timestamp) so duplicates are skipped.
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = require('../models/database');
const { SensorReading } = require('../models/sensorData');
const { Device } = require('../models/device');
const { AlertLog } = require('../models/alert');

const SQLITE_PATH = process.env.SQLITE_PATH
  || path.resolve(__dirname, '../data/motor_inspection.db');

/**
 * Parse a SQLite timestamp string into a JS Date.
 * Handles SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) and ISO-8601 strings.
 */
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function readTable(sqlite, sql) {
  try {
    return sqlite.prepare(sql).all();
  } catch (err) {
    console.warn(`[MIGRATE] Skipping table query (${err.message})`);
    return [];
  }
}

(async () => {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.log(`[MIGRATE] No SQLite database found at ${SQLITE_PATH}. Nothing to migrate.`);
    process.exit(0);
  }

  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });

  try {
    await db.initialize();

    // ---- Devices -----------------------------------------------------
    const devices = readTable(sqlite, 'SELECT * FROM devices');
    for (const row of devices) {
      await Device.updateOne(
        { deviceId: row.deviceId },
        {
          $set: {
            deviceName: row.deviceName ?? null,
            ipAddress: row.ipAddress ?? null,
            macAddress: row.macAddress ?? null,
            firmwareVersion: row.firmwareVersion ?? null,
            lastSeen: parseDate(row.lastSeen),
            status: row.status || 'ONLINE',
          },
        },
        { upsert: true }
      );
    }
    console.log(`[MIGRATE] Devices: ${devices.length}`);

    // ---- Sensor readings --------------------------------------------
    const readings = readTable(sqlite, 'SELECT * FROM sensor_readings ORDER BY id ASC');
    let inserted = 0;
    let skipped = 0;
    for (const row of readings) {
      const timestamp = parseDate(row.timestamp) || new Date();
      const exists = await SensorReading.exists({ deviceId: row.deviceId, timestamp });
      if (exists) { skipped += 1; continue; }
      await SensorReading.create({
        deviceId: row.deviceId,
        temperature: row.temperature,
        vibration: row.vibration,
        motorCondition: row.motorCondition,
        timestamp,
        espSignalStrength: row.espSignalStrength ?? null,
        dataPointNumber: row.dataPointNumber ?? null,
      });
      inserted += 1;
    }
    console.log(`[MIGRATE] Sensor readings: inserted ${inserted}, skipped ${skipped}`);

    // ---- Alerts ------------------------------------------------------
    const alerts = readTable(sqlite, 'SELECT * FROM alert_log ORDER BY id ASC');
    let alertsInserted = 0;
    for (const row of alerts) {
      const timestamp = parseDate(row.timestamp) || new Date();
      const exists = await AlertLog.exists({
        deviceId: row.deviceId,
        timestamp,
        alertType: row.alertType,
      });
      if (exists) continue;
      await AlertLog.create({
        deviceId: row.deviceId,
        alertType: row.alertType,
        severity: row.severity,
        message: row.message ?? null,
        acknowledgedAt: parseDate(row.acknowledgedAt),
        timestamp,
      });
      alertsInserted += 1;
    }
    console.log(`[MIGRATE] Alerts: inserted ${alertsInserted}`);

    console.log('[MIGRATE] SQLite -> MongoDB migration complete.');
    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('[MIGRATE] Failed:', err.message);
    try { await db.close(); } catch (e) { /* noop */ }
    process.exit(1);
  } finally {
    sqlite.close();
  }
})();
