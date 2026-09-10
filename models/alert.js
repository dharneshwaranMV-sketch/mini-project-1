/**
 * models/alert.js
 * ------------------------------------------------------------------
 * Data-access layer for the `alert_log` table.
 * Every time the motor condition changes to WARNING or FAULT, the route
 * handler inserts an alert row here.
 */
const db = require('./database');

// ---------------------------------------------------------------------------
// INSERT a new alert record.
// ---------------------------------------------------------------------------
async function create({ deviceId, alertType, severity, message }) {
  const sql = `
    INSERT INTO alert_log (deviceId, alertType, severity, message, timestamp)
    VALUES (?, ?, ?, ?, datetime('now'))
  `;
  const result = await db.run(sql, [deviceId, alertType, severity, message]);
  return result.lastID;
}

// ---------------------------------------------------------------------------
// GET the most recent alerts, optionally filtered by device.
// ---------------------------------------------------------------------------
async function getRecent(deviceId, limit = 50) {
  let sql = 'SELECT * FROM alert_log';
  const params = [];
  if (deviceId) {
    sql += ' WHERE deviceId = ?';
    params.push(deviceId);
  }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);
  return db.all(sql, params);
}

// ---------------------------------------------------------------------------
// ACKNOWLEDGE (clear) a single alert.
// ---------------------------------------------------------------------------
async function acknowledge(id) {
  return db.run(
    'UPDATE alert_log SET acknowledgedAt = datetime(\'now\') WHERE id = ?',
    [id]
  );
}

// ---------------------------------------------------------------------------
// CLEAR all unacknowledged alerts.
// ---------------------------------------------------------------------------
async function clearAll(deviceId) {
  let sql = 'DELETE FROM alert_log';
  const params = [];
  if (deviceId) {
    sql += ' WHERE deviceId = ?';
    params.push(deviceId);
  }
  const result = await db.run(sql, params);
  return result.changes;
}

module.exports = { create, getRecent, acknowledge, clearAll };