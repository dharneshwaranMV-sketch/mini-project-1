/**
 * routes/simulator.js
 * ------------------------------------------------------------------
 * "Simulate ESP32" master ON/OFF switch for the entire project:
 *
 *   1. START  → (re)starts the Python/Flask backend (app.py) if it
 *               isn't already running, then feeds realistic readings
 *               to it every SIM_FEED_INTERVAL_MS. app.py forwards each
 *               reading to the Node dashboard, which persists + live-
 *               broadcasts it. The dashboard also gets a "connected"
 *               wifi status message.
 *   2. STOP   → kills the spawned Python process (only the one we
 *               spawned), stops the feed, and broadcasts "disconnected".
 *
 * If an externally-run Flask on :FLASK_PORT is detected, START reuses
 * it and STOP only halts the feed (it never kills that external server).
 */
const express = require('express');
const router = express.Router();
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const constants = require('../config/constants');
const serverConfig = require('../config/server');

// Injected by server.js (avoids circular requires).
const injected = { bus: null };
function setWsBus(bus) { injected.bus = bus; }

const projectRoot = path.resolve(__dirname, '..');
const sim = constants.SIMULATOR;
const baseUrl = `http://127.0.0.1:${sim.flaskPort}`;

// Simulator runtime state.
let flaskChild = null;   // the Python process we spawned (null = reused external)
let feedTimer = null;    // interval feeding fake readings into app.py
let intervalState = 'off'; // 'off' | 'starting' | 'on'
let currentDeviceId = 'MOTOR_BOT_01';
let simTemp = 38;
let simVib = 1500;

// ---------------------------------------------------------------------------
// Tiny HTTP helpers (Node >=14: no global fetch, so use http module).
// ---------------------------------------------------------------------------
function httpRequest(method, url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body ? Buffer.byteLength(body) : 0,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
          resolve(parsed);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out (${method} ${url})`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function isFlaskUp() {
  try {
    await httpRequest('GET', baseUrl + '/');
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Python/Flask lifecycle
// ---------------------------------------------------------------------------
function spawnFlask() {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok) => { if (!settled) { settled = true; resolve(ok); } };

    try {
      const child = spawn(sim.pythonPath, [sim.flaskAppPath], {
        cwd: projectRoot,
        env: { ...process.env, NODE_DASHBOARD_URL: `http://127.0.0.1:${serverConfig.port}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      flaskChild = child;

      child.stdout.on('data', (buf) => process.stdout.write(`[FLASK] ${buf}`));
      child.stderr.on('data', (buf) => process.stderr.write(`[FLASK-ERR] ${buf}`));
      child.on('error', (err) => {
        console.error('[SIM] Failed to launch Python:', err.message);
        settle(false);
      });
      child.on('exit', (code) => {
        console.log(`[SIM] Python (app.py) exited with code ${code}`);
        if (flaskChild === child) flaskChild = null;
        if (intervalState === 'on') {
          intervalState = 'off';
          if (injected.bus) {
            injected.bus.broadcastConnectionStatus({
              deviceId: currentDeviceId,
              status: 'offline',
              message: 'Python (app.py) server stopped unexpectedly',
            });
          }
        }
        if (!settled) settle(false);
      });

      // Poll for Flask readiness (up to 12s).
      const deadline = Date.now() + 12000;
      const probe = setInterval(async () => {
        if (await isFlaskUp()) { clearInterval(probe); settle(true); }
        else if (Date.now() > deadline) { clearInterval(probe); settle(false); }
      }, 300);
    } catch (err) {
      console.error('[SIM] spawn error:', err.message);
      settle(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Feed loop — simulated ESP32 → app.py → Node → WebSocket
// ---------------------------------------------------------------------------
async function feedTick() {
  simTemp = Math.min(78, Math.max(30, simTemp + (Math.random() * 4 - 1.8)));
  simVib = Math.min(3900, Math.max(300, simVib + (Math.random() * 500 - 240)));
  try {
    await httpRequest('POST', baseUrl + '/motor-data', {
      deviceId: currentDeviceId,
      temperature: Math.round(simTemp * 10) / 10,
      vibration: Math.round(simVib),
      espSignalStrength: -45 + Math.round(Math.random() * 8 - 4),
      deviceName: 'Motor Bot #01',
      firmwareVersion: 'v1.0 (sim)',
      macAddress: 'SIM:AA:BB:CC:00:01',
    });
  } catch (err) {
    console.error('[SIM] feed error:', err.message);
  }
}

function stopFeed(broadcast = true) {
  if (feedTimer) { clearInterval(feedTimer); feedTimer = null; }
  const deviceId = currentDeviceId;
  if (flaskChild && flaskChild.exitCode === null) {
    flaskChild.kill();
  }
  flaskChild = null;
  intervalState = 'off';
  if (broadcast && injected.bus) {
    injected.bus.broadcastConnectionStatus({
      deviceId,
      status: 'offline',
      message: 'Simulated ESP32 disconnected — all systems off',
    });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
router.get('/status', (req, res) => {
  res.json({ status: 'success', state: intervalState, deviceId: currentDeviceId, flaskPort: sim.flaskPort });
});

router.post('/start', async (req, res) => {
  if (intervalState === 'on') {
    return res.json({ status: 'success', message: 'Simulator already running', state: 'on', deviceId: currentDeviceId });
  }
  if (intervalState === 'starting') {
    return res.status(409).json({ status: 'error', message: 'Simulator is still starting, try again', state: 'starting' });
  }

  currentDeviceId = (req.body && req.body.deviceId) || 'MOTOR_BOT_01';
  intervalState = 'starting';

  try {
    const alreadyUp = await isFlaskUp();
    if (alreadyUp) {
      console.log('[SIM] Flask already running on ' + baseUrl + ' — reusing it');
      flaskChild = null; // external instance; STOP must not kill it
    } else {
      const started = await spawnFlask();
      if (!started) {
        intervalState = 'off';
        return res.status(500).json({
          status: 'error',
          message: `Could not start Python backend (${sim.pythonPath} ${sim.flaskAppPath}). Check PYTHON_PATH / .venv.`,
        });
      }
    }

    simTemp = 38;
    simVib = 1500;
    feedTimer = setInterval(feedTick, sim.intervalMs);
    intervalState = 'on';

    if (injected.bus) {
      injected.bus.broadcastConnectionStatus({
        deviceId: currentDeviceId,
        status: 'online',
        message: 'Simulated ESP32 connected to Wi-Fi — streaming',
      });
    }

    res.json({ status: 'success', message: 'Simulator started', state: 'on', deviceId: currentDeviceId });
  } catch (err) {
    intervalState = 'off';
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/stop', (req, res) => {
  stopFeed(true);
  res.json({ status: 'success', message: 'Simulator stopped — all systems off', state: 'off' });
});

module.exports = router;
module.exports.setWsBus = setWsBus;