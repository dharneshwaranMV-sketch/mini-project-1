/**
 * websocket/bus.js
 * ------------------------------------------------------------------
 * Helper functions to build and broadcast WebSocket messages to every
 * connected dashboard.  server.js injects this bus into routes/sensor.
 */
const manager = require('./manager');

/**
 * Push a fresh sensor reading to all dashboards.
 */
function broadcastSensorUpdate({ deviceId, data }) {
  manager.broadcast({
    type: 'sensor_update',
    deviceId,
    data,
  });
}

/**
 * Push a connection-status change (ONLINE/OFFLINE).
 */
function broadcastConnectionStatus({ deviceId, status, message, ipAddress, signalStrength }) {
  manager.broadcast({
    type: 'connection_status',
    status, // 'connected' | 'disconnected' | 'online' | 'offline'
    deviceId,
    message,
    ipAddress,
    signalStrength,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Push a new alert to the right-hand panel immediately.
 */
function broadcastAlert(alert) {
  manager.broadcast({
    type: 'alert',
    ...alert,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Push full device info (IP, MAC, firmware, uptime...) to dashboards.
 */
function broadcastDeviceInfo(info) {
  manager.broadcast({
    type: 'device_info',
    data: info,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { broadcastSensorUpdate, broadcastConnectionStatus, broadcastAlert, broadcastDeviceInfo };