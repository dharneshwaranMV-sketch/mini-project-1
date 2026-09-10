/**
 * config/constants.js
 * ------------------------------------------------------------------
 * Application-wide constants: motor condition thresholds, status
 * labels and colours. Tune the thresholds here or in the .env file
 * based on your experimental readings from the real motor.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

module.exports = {
  // ---- Motor condition thresholds -------------------------------
  THRESHOLDS: {
    temperature: {
      healthyMax: parseFloat(process.env.TEMP_HEALTHY_MAX) || 45, // <= 45  -> HEALTHY
      warningMax: parseFloat(process.env.TEMP_WARNING_MAX) || 60,  // 45-60  -> WARNING, >60 -> FAULT
    },
    vibration: {
      healthyMax: parseFloat(process.env.VIB_HEALTHY_MAX) || 300,  // ADC 0-1023
      warningMax: parseFloat(process.env.VIB_WARNING_MAX) || 600,  // ADC 0-1023
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

  // ---- Full sensor range for vibration (ESP32 ADC 0-1023) -------
  VIBRATION_MAX_ADC: 1023,

  // ---- Device status --------------------------------------------
  DEVICE_STATUS: {
    ONLINE: 'ONLINE',
    OFFLINE: 'OFFLINE',
  },
};