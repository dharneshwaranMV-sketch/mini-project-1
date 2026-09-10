/**
 * models/sensorData.js
 * ------------------------------------------------------------------
 * Data-access layer for the `sensor_readings` table.
 * Every function is async so the route handlers can await them
 * and any SQL errors bubble up as rejected promises.
 */
const db = require('./database');

// ---------------------------------------------------------------------------
// INSERT a new sensor reading.  Called every time the ESP32 POSTs data.
// ---------------------------------------------------------------------------
async function create({ deviceId, temperature, vibration, motorCondition, timestamp, espSignalStrength, dataPointNumber }) {
  const sql = `
    INSERT INTO sensor_readings
      (deviceId, temperature, vibration, motorCondition, timestamp, espSignalStrength, dataPointNumber)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const result = await db.run(sql, [
    deviceId,
    temperature,
    vibration,
    motorCondition,
    timestamp || new Date().toISOString(),
    espSignalStrength || null,
    dataPointNumber || null,
  ]);
  return result.lastID;
}

// ---------------------------------------------------------------------------
// GET the most recent reading for a device.
// ---------------------------------------------------------------------------
async function getLatest(deviceId) {
  const sql = 'SELECT * FROM sensor_readings WHERE deviceId = ? ORDER BY timestamp DESC LIMIT 1';
  return db.get(sql, [deviceId]);
}

// ---------------------------------------------------------------------------
// GET historical readings for trend graphs.
//   `minutes`  — how far back to look (default 30)
//   `limit`    — max rows to return  (default 100)
// ---------------------------------------------------------------------------
async function getHistory(deviceId, minutes = 30, limit = 100) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const sql = `
    SELECT timestamp, temperature, vibration, motorCondition
    FROM sensor_readings
    WHERE deviceId = ? AND timestamp >= ?
    ORDER BY timestamp ASC
    LIMIT ?
  `;
  return db.all(sql, [deviceId, cutoff, limit]);
}

// ---------------------------------------------------------------------------
// GET readings for CSV export within a time window.
// ---------------------------------------------------------------------------
async function getForExport(deviceId, startTime, endTime) {
  let sql = 'SELECT * FROM sensor_readings WHERE 1=1';
  const params = [];
  if (deviceId) { sql += ' AND deviceId = ?'; params.push(deviceId); }
  if (startTime) { sql += ' AND timestamp >= ?'; params.push(startTime); }
  if (endTime) { sql += ' AND timestamp <= ?'; params.push(endTime); }
  sql += ' ORDER BY timestamp ASC';
  return db.all(sql, params);
}

// ---------------------------------------------------------------------------
// DELETE all readings for a device (used by clear endpoint).
// ---------------------------------------------------------------------------
async function clearAll(deviceId) {
  const sql = deviceId
    ? 'DELETE FROM sensor_readings WHERE deviceId = ?'
    : 'DELETE FROM sensor_readings';
  const result = await db.run(sql, deviceId ? [deviceId] : []);
  return result.changes;
}

module.exports = { create, getLatest, getHistory, getForExport, clearAll };