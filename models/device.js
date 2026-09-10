/**
 * models/device.js
 * ------------------------------------------------------------------
 * Data-access layer for the `devices` table.
 * Stores metadata about each ESP32 that has ever sent data.
 */
const db = require('./database');
const constants = require('../config/constants');

// ---------------------------------------------------------------------------
// UPSERT — register a device or update its info if it already exists.
// The `replace()` semantics of SQLite make this simple: INSERT OR REPLACE.
// ---------------------------------------------------------------------------
async function upsert({ deviceId, deviceName, ipAddress, macAddress, firmwareVersion, espSignalStrength }) {
  const sql = `
    INSERT INTO devices (deviceId, deviceName, ipAddress, macAddress, firmwareVersion, lastSeen, status)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(deviceId) DO UPDATE SET
      deviceName      = COALESCE(excluded.deviceName, devices.deviceName),
      ipAddress       = COALESCE(excluded.ipAddress, devices.ipAddress),
      macAddress      = COALESCE(excluded.macAddress, devices.macAddress),
      firmwareVersion = COALESCE(excluded.firmwareVersion, devices.firmwareVersion),
      lastSeen        = datetime('now'),
      status          = ?
  `;
  const online = constants.DEVICE_STATUS.ONLINE;
  return db.run(sql, [deviceId, deviceName, ipAddress, macAddress, firmwareVersion, online, online]);
}

// ---------------------------------------------------------------------------
// GET the latest data point number for a device (incremented each reading).
// ---------------------------------------------------------------------------
async function getLatestDataPointNumber(deviceId) {
  const row = await db.get(
    'SELECT dataPointNumber FROM sensor_readings WHERE deviceId = ? ORDER BY id DESC LIMIT 1',
    [deviceId]
  );
  return row ? row.dataPointNumber : 0;
}

// ---------------------------------------------------------------------------
// GET device info.
// ---------------------------------------------------------------------------
async function getById(deviceId) {
  return db.get('SELECT * FROM devices WHERE deviceId = ?', [deviceId]);
}

// ---------------------------------------------------------------------------
// LIST all registered devices.
// ---------------------------------------------------------------------------
async function listAll() {
  return db.all('SELECT * FROM devices ORDER BY lastSeen DESC');
}

// ---------------------------------------------------------------------------
// UPDATE device status (ONLINE/OFFLINE).
// ---------------------------------------------------------------------------
async function setStatus(deviceId, status) {
  return db.run('UPDATE devices SET status = ?, lastSeen = datetime(\'now\') WHERE deviceId = ?', [status, deviceId]);
}

module.exports = { upsert, getById, listAll, setStatus, getLatestDataPointNumber };