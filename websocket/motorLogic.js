/**
 * websocket/motorLogic.js
 * ------------------------------------------------------------------
 * Core motor-condition decision engine, shared by the sensor route
 * and the WebSocket handler.
 *
 * Rules:
 *   - FAULT   if either temperature OR vibration is in the FAULT range
 *   - WARNING if any sensor is WARNING but none are FAULT
 *   - HEALTHY if all sensors are HEALTHY
 */
const constants = require('../config/constants');

function determineMotorCondition(temperature, vibration) {
  const { temperature: t, vibration: v } = constants.THRESHOLDS;

  // ---- Validate inputs ------------------------------------------
  // Guard against missing/NaN values carried by faulty ESP32 payloads.
  const temp = Number(temperature);
  const vib = Number(vibration);
  if (!Number.isFinite(temp) || !Number.isFinite(vib)) {
    return constants.CONDITION.HEALTHY;
  }

  // ---- Per-sensor status ----------------------------------------
  let tempStatus = constants.CONDITION.HEALTHY;
  if (temp > t.warningMax) {
    tempStatus = constants.CONDITION.FAULT;
  } else if (temp > t.healthyMax) {
    tempStatus = constants.CONDITION.WARNING;
  }

  let vibStatus = constants.CONDITION.HEALTHY;
  if (vib > v.warningMax) {
    vibStatus = constants.CONDITION.FAULT;
  } else if (vib > v.healthyMax) {
    vibStatus = constants.CONDITION.WARNING;
  }

  // ---- Combine: worst of the two wins ----------------------------
  if (tempStatus === constants.CONDITION.FAULT || vibStatus === constants.CONDITION.FAULT) {
    return constants.CONDITION.FAULT;
  }
  if (tempStatus === constants.CONDITION.WARNING || vibStatus === constants.CONDITION.WARNING) {
    return constants.CONDITION.WARNING;
  }
  return constants.CONDITION.HEALTHY;
}

/**
 * Build a human-readable message describing why the condition changed.
 */
function buildConditionMessage(temperature, vibration, condition) {
  const { temperature: t, vibration: v } = constants.THRESHOLDS;
  const parts = [];

  if (temperature > t.warningMax) parts.push(`Excessive temperature detected (>${t.warningMax}°C)`);
  else if (temperature > t.healthyMax) parts.push(`Temperature elevated above ${t.healthyMax}°C`);

  if (vibration > v.warningMax) parts.push(`Excessive vibration level detected (>${v.warningMax})`);
  else if (vibration > v.healthyMax) parts.push(`Vibration elevated above ${v.healthyMax}`);

  if (parts.length === 0) {
    return constants.CONDITION_MESSAGES[condition] || 'Normal operation';
  }
  return parts.join(' — ');
}

module.exports = { determineMotorCondition, buildConditionMessage };