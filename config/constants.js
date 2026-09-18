/**
 * config/constants.js
 * ------------------------------------------------------------------
 * Application-wide constants: motor condition thresholds, status
 * labels/colours and simulator configuration. Tune the thresholds in
 * .env — the values used here must stay in sync with app.py (the
 * authoritative classifier for this project).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const projectRoot = path.resolve(__dirname, '..');

module.exports = {
  // ---- Motor condition thresholds -------------------------------
  // Boundary semantics (matches app.py): >= healthyMax -> WARNING,
  // >= warningMax -> FAULT.
  THRESHOLDS: {
    temperature: {
      healthyMax: parseFloat(process.env.TEMP_HEALTHY_MAX) || 55, // >= 55  -> WARNING
      warningMax: parseFloat(process.env.TEMP_WARNING_MAX) || 65,  // >= 65  -> FAULT
    },
    vibration: {
      healthyMax: parseFloat(process.env.VIB_HEALTHY_MAX) || 2500, // >= 2500 -> WARNING
      warningMax: parseFloat(process.env.VIB_WARNING_MAX) || 3500, // >= 3500 -> FAULT
    },
  },

  // ---- Motor condition states -----------------------------------
  CONDITION: {
    HEALTHY: 'HEALTHY',
    WARNING: 'WARNING',
    FAULT: 'FAULT',
  },

  // ---- Helpful status messages for each condition ---------------
  CONDITION_MESSAGES: {
    HEALTHY: 'Normal operation',
    WARNING: 'Check motor - reading outside safe range',
    FAULT: 'Immediate inspection required!',
  },

  // ---- Upper bound for a valid vibration reading (scale 0-4095) --
  VIBRATION_MAX: parseInt(process.env.VIBRATION_MAX, 10) || 4095,

  // ---- Device status --------------------------------------------
  DEVICE_STATUS: {
    ONLINE: 'ONLINE',
    OFFLINE: 'OFFLINE',
  },

  // ---- Simulator (Simulate ESP32 master ON/OFF) ------------------
  SIMULATOR: {
    flaskPort: parseInt(process.env.FLASK_PORT, 10) || 5001,
    intervalMs: parseInt(process.env.SIM_FEED_INTERVAL_MS, 10) || 2000,
    // The Python interpreter used to (re)start app.py. Defaults to the
    // project's virtual environment on both Windows and POSIX shells.
    pythonPath: process.env.PYTHON_PATH || (process.platform === 'win32'
      ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, '.venv', 'bin', 'python')),
    flaskAppPath: path.join(projectRoot, 'app.py'),
  },
};