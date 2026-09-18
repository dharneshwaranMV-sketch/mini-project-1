/**
 * server.js — Motor Inspection Bot IoT Dashboard
 * ------------------------------------------------------------------
 * Main entry point. Zeroes in on:
 *   1. Express app + static serving of the dashboard
 *   2. REST API for sensor data (ESP32 → server)
 *   3. WebSocket live updates (server → browser)
 *   4. MongoDB persistence
 *
 * Run with:   npm install && npm start
 * Then visit: http://localhost:5000   (or http://<laptop-ip>:5000 )
 */
const express = require('express');
const http = require('http');
const path   = require('path');
const cors   = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const serverConfig = require('./config/server');
const db = require('./models/database');
const wsHandler = require('./websocket/handler');
const wsBus = require('./websocket/bus');
const manager = require('./websocket/manager');

// ---------------------------------------------------------------------------
// Express app + HTTP server
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);

// Middleware: parse JSON bodies, allow cross-origin requests (ESP32 is
// a different origin from the browser), and serve the static dashboard.
app.use(cors());
app.use(bodyParser.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// WebSocket server (handles browser dashboards)
// ---------------------------------------------------------------------------
const wss = wsHandler.setupWebSocket(server);
wsHandler.startHeartbeat(wss);

// Allow the sensor route + hooks to broadcast via the shared bus.
const sensorRoute = require('./routes/sensor');
sensorRoute.setWsBus(wsBus);

// Simulator master switch (Simulate ESP32): spawns/stops app.py and
// feeds fake readings through the full Flask -> Node pipeline.
const simulatorRoute = require('./routes/simulator');
simulatorRoute.setWsBus(wsBus);

// Register the "get_state" hook so a dashboard asking for a fresh copy of
// the latest readings triggers a re-broadcast of the latest stored value.
wsHandler.hooks.onGetStateRequest = async () => {
  try {
    const deviceId = 'MOTOR_BOT_01';
    const latest = await require('./models/sensorData').getLatest(deviceId);
    if (latest) wsBus.broadcastSensorUpdate({ deviceId, data: latest });
  } catch (err) {
    console.error('[WS] get_state refresh failed:', err.message);
  }
};

// ---------------------------------------------------------------------------
// REST API routes
// ---------------------------------------------------------------------------
app.use('/api/sensor', sensorRoute);
app.use('/api/simulator', simulatorRoute);
app.use('/api/device', require('./routes/device'));
app.use('/api/export', require('./routes/export'));
app.use('/health', require('./routes/health'));

// ---------------------------------------------------------------------------
// Track ESP32 online/offline by polling the stored "lastSeen" — the server
// broadcasts an OFFLINE status event when the device goes silent for more
// than DEVICE_OFFLINE_MS (default 30s).
// ---------------------------------------------------------------------------
let lastBroadcastOffline = new Map();
setInterval(async () => {
  try {
    const devices = await require('./models/device').listAll();
    for (const device of devices) {
      if (!device.lastSeen) continue;
      const lastSeenMs = new Date(device.lastSeen).getTime();
      const offlineMs = Date.now() - lastSeenMs;
      if (offlineMs > serverConfig.deviceOfflineMs) {
        const last = lastBroadcastOffline.get(device.deviceId);
        // Broadcast only on the transition (avoids noise every tick).
        if (!last) {
          wsBus.broadcastConnectionStatus({
            deviceId: device.deviceId,
            status: 'offline',
            message: 'ESP32 connection lost — no data received recently',
          });
          lastBroadcastOffline.set(device.deviceId, Date.now());
        }
      } else {
        lastBroadcastOffline.delete(device.deviceId);
      }
    }
  } catch (err) {
    console.error('[MONITOR] offline scan error:', err.message);
  }
}, 5000);

// ---------------------------------------------------------------------------
// 404 + error handlers
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: `Route not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error('[SERVER] Unhandled error:', err.message, err.stack);
  res.status(500).json({ status: 'error', message: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  try {
    await db.initialize();
    server.listen(serverConfig.port, serverConfig.host, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log('║   MOTOR INSPECTION BOT — IoT DASHBOARD                    ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`  Dashboard : http://localhost:${serverConfig.port}`);
      console.log(`  API       : http://localhost:${serverConfig.port}/api`);
      console.log(`  WebSocket : ws://localhost:${serverConfig.port}/ws`);
      console.log(`  Listening on ${serverConfig.host}:${serverConfig.port}`);
      console.log(`  Retention : ${serverConfig.retentionDays} days  |  DB: ${serverConfig.mongoUri}`);
      console.log('');
      console.log('  Simulate ESP32:');
      console.log('   curl -X POST http://localhost:5000/api/sensor/data \\');
      console.log('        -H "Content-Type: application/json" \\');
      console.log("        -d '{\"deviceId\":\"MOTOR_BOT_01\",\"temperature\":48.5,\"vibration\":320}'");
      console.log('');
    });
  } catch (err) {
    console.error('[SERVER] Failed to start:', err.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SERVER] Shutting down...');
  await db.close();
  process.exit(0);
});

if (require.main === module) {
  start();
}

module.exports = { app, server, start };