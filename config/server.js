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

  // MongoDB connection string. Defaults to a local mongod on the default port.
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/motor_inspection',

  // How many days of sensor history to keep before auto-cleanup.
  retentionDays: parseInt(process.env.DATA_RETENTION_DAYS, 10) || 7,

  // Consider ESP32 OFFLINE when no data arrives within this window (milliseconds).
  deviceOfflineMs: parseInt(process.env.DEVICE_OFFLINE_MS, 10) || 30000,

  logLevel: process.env.LOG_LEVEL || 'info',
};