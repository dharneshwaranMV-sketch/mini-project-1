/**
 * config/server.js
 * ------------------------------------------------------------------
 * Centralised server configuration.
 * Reads values from environment variables (.env) with safe defaults,
 * so the dashboard works out-of-the-box on a local network.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

module.exports = {
  env: process.env.NODE_ENV || 'development',

  // Host 0.0.0.0 allows the ESP32 on the same Wi-Fi network to reach us.
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT, 10) || 5000,

  // Absolute path to the SQLite database file (project-root / data).
  dbPath: path.resolve(__dirname, '..', process.env.DB_PATH || './data/motor_inspection.db'),

  // How many days of sensor history to keep before auto-cleanup.
  retentionDays: parseInt(process.env.DATA_RETENTION_DAYS, 10) || 7,

  // Consider ESP32 OFFLINE when no data arrives within this window (milliseconds).
  deviceOfflineMs: parseInt(process.env.DEVICE_OFFLINE_MS, 10) || 30000,

  logLevel: process.env.LOG_LEVEL || 'info',
};