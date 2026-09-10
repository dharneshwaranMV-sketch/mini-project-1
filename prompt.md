# Motor Inspection Bot — IoT Dashboard · Full Project Prompt

This file is a **self-contained, code-complete context** for the entire project
(excluding `node_modules/`, `.env` secrets, bundled vendor libraries, logs and
SQLite data files). Paste it into an AI assistant to get full working context —
all source lives below, so no repo access is required.

---

## 1. Overview

Real-time web dashboard for a **Portable Motor Inspection Bot** (B.E. Mechatronics
college project). An ESP32 field device streams motor **temperature** (°C) and
**vibration** (ESP32 ADC 0–1023) readings over HTTP POST to an Express server;
the server validates, computes a motor condition, persists to SQLite and
broadcasts the update to every open browser dashboard over WebSocket.

```
ESP32 (Wi-Fi) ──HTTP POST──▶ Express server ──WebSocket──▶ Browser dashboard
                                  │
                                  └──▶ SQLite (history / alerts)
```

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 14 |
| Backend | Express 4 (`cors`, `body-parser`, `dotenv`) |
| Database | SQLite via `sqlite3`, WAL mode, promise-wrapped helpers |
| Real-time | `ws` (WebSocket server, `/ws` path, 30 s heartbeat) |
| Frontend | Vanilla HTML/CSS/JS + vendored Chart.js (`public/lib/chart.umd.min.js`) |
| Scripts | `npm start` (server), `npm run dev` (nodemon), `npm run migrate`, `npm run seed` |

## 3. Key Conventions (critical for modifying code)

- **Shared condition engine**: `websocket/motorLogic.js` (backend) is mirrored
  by `determineCondition` in `public/js/utils.js` (frontend). Keep both in sync
  if threshold logic changes.
- **Circular-require avoidance via DI**:
  - `routes/sensor.js` exposes `setWsBus(bus)`; `server.js` injects `websocket/bus.js`.
  - `websocket/handler.js` exposes `module.exports.hooks = { onGetStateRequest: null }`,
    which `server.js` populates.
- **DB layer**: `models/database.js` exports async `run/get/all/close` wrappers
  over `sqlite3` callbacks. All model files are async data-access helpers — no SQL
  outside `migrations/001_create_tables.sql` and the model/route layer.
- **Frontend module pattern**: each `public/js/*.js` file is an IIFE attaching a
  namespace object to `window.App` (`App.Utils`, `App.Storage`, `App.API`,
  `App.Charts`, `App.Websocket`). Load order in `index.html` matters
  (`utils → storage → api → charts → websocket → dashboard`).
- **Dashboard performance rules** (`dashboard.js`): DOM elements are queried once
  and cached (`cacheDom`); text nodes are only touched when values change
  (`setText`); one 1 s `tick()` interval drives clock/uptime/watchdog/rate;
  chart redraws are rAF-coalesced from a single rolling buffer
  (`Storage.session.buffer`).
- **Time storage**: SQLite `datetime('now')` stores UTC; JS parses with `'Z'`
  appended (`lastSeen.replace(' ', 'T') + 'Z'`).

## 4. Directory Tree (runtime/source only)

```
├── server.js                  # Express + WebSocket + offline monitor
├── package.json
├── .gitignore
├── config/
│   ├── server.js              # host/port/dbPath/retention/offline window
│   └── constants.js           # thresholds, condition labels, messages
├── models/
│   ├── database.js            # sqlite3 wrapper + migrations + cleanup
│   ├── sensorData.js          # sensor_readings CRUD
│   ├── device.js              # devices UPSERT/query/status
│   └── alert.js               # alert_log CRUD
├── routes/
│   ├── sensor.js              # POST data, GET latest/history, DELETE clear
│   ├── device.js              # GET list/:id, DELETE :id
│   ├── export.js              # POST /csv
│   └── health.js              # GET /
├── websocket/
│   ├── handler.js             # WS server setup + heartbeat + hooks
│   ├── manager.js             # client registry + broadcast
│   ├── bus.js                 # message builders (sensor/status/alert/device)
│   └── motorLogic.js          # HEALTHY/WARNING/FAULT decision engine
├── migrations/
│   ├── 001_create_tables.sql  # schema + indexes
│   ├── run.js                 # runner (npm run migrate)
│   └── seed.js                # ~90 demo readings (npm run seed)
├── public/
│   ├── index.html
│   ├── css/ styles.css · responsive.css · dark-mode.css · animations.css
│   ├── js/  utils.js · storage.js · api.js · charts.js · websocket.js · dashboard.js
│   └── lib/ chart.umd.min.js  # vendored Chart.js (not embedded)
├── data/                      # SQLite db (git-ignored)
└── logs/                      # runtime logs (git-ignored)
```

## 5. Motor Condition Rules

```
Temperature:  HEALTHY ≤ 45°C    WARNING 45–60°C    FAULT > 60°C
Vibration:    HEALTHY ≤ 300     WARNING 300–600    FAULT > 600   (ADC 0–1023)
Combined:     any FAULT → FAULT ; any WARNING → WARNING ; else HEALTHY
```

Thresholds live in `config/constants.js` and are overridable via `.env`
(`TEMP_HEALTHY_MAX`, `TEMP_WARNING_MAX`, `VIB_HEALTHY_MAX`, `VIB_WARNING_MAX`).

## 6. API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sensor/data` | ESP32 push — validate, compute condition, save, broadcast |
| `GET`  | `/api/sensor/latest?deviceId=MOTOR_BOT_01` | Most recent reading + online/offline |
| `GET`  | `/api/sensor/history?deviceId=...&minutes=30&limit=100` | Readings for charts |
| `DELETE` | `/api/sensor/clear?deviceId=...` | Clear stored readings (testing) |
| `GET`  | `/api/device/list` | All registered devices |
| `GET`  | `/api/device/:deviceId` | Device details + current status |
| `DELETE` | `/api/device/:deviceId` | Remove a device and its data |
| `POST` | `/api/export/csv` | CSV download `{deviceId, startTime?, endTime?}` |
| `GET`  | `/health` | Status / uptime / ws client count |

### WebSocket (`ws://host:5000/ws`)

Server → browser:

```json
{ "type": "sensor_update", "deviceId": "MOTOR_BOT_01",
  "data": { "temperature": 48.5, "vibration": 320, "motorCondition": "HEALTHY",
            "timestamp": "...", "espSignalStrength": -45, "dataPointNumber": 1247 } }

{ "type": "alert", "severity": "high", "message": "...", "deviceId": "..." }

{ "type": "connection_status", "status": "offline", "deviceId": "..." }

{ "type": "device_info", "data": { ... } }
```

Browser → server: `{ "type": "ping" }`, `{ "type": "get_state" }`.

## 7. Database Schema

**devices** — `deviceId` PK, `deviceName`, `ipAddress`, `macAddress`,
`firmwareVersion`, `lastSeen` (UTC DATETIME), `status` (ONLINE/OFFLINE), `createdAt`.

**sensor_readings** — `id` PK AUTOINCREMENT, `deviceId` FK, `temperature` REAL,
`vibration` REAL, `motorCondition`, `timestamp`, `espSignalStrength`,
`dataPointNumber`, `createdAt`. Indexed on timestamp/device/condition.

**alert_log** — `id` PK AUTOINCREMENT, `deviceId` FK, `alertType`, `severity`
(medium/high), `message`, `acknowledgedAt`, `timestamp`.

Retention: readings older than `DATA_RETENTION_DAYS` (default 7) are purged every
6 h and on startup. Offline window: `DEVICE_OFFLINE_MS` (default 30000 ms).

---

## 8. Embedded Source

### package.json

```json
{
  "name": "motor-inspection-dashboard",
  "version": "1.0.0",
  "description": "IoT Dashboard for Portable Motor Inspection Bot (ESP32) - monitors motor temperature and vibration in real-time",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "migrate": "node migrations/run.js",
    "seed": "node migrations/seed.js"
  },
  "engines": {
    "node": ">=14.0.0"
  },
  "dependencies": {
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "ws": "^8.14.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

### server.js

```js
/**
 * server.js — Motor Inspection Bot IoT Dashboard
 * ------------------------------------------------------------------
 * Main entry point. Zeroes in on:
 *   1. Express app + static serving of the dashboard
 *   2. REST API for sensor data (ESP32 → server)
 *   3. WebSocket live updates (server → browser)
 *   4. SQLite persistence
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
      const lastSeenMs = new Date(device.lastSeen.replace(' ', 'T') + 'Z').getTime();
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
      console.log(`  Retention : ${serverConfig.retentionDays} days  |  DB: ${serverConfig.dbPath}`);
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
```

### .gitignore

```
# Dependencies
node_modules/

# Environment (contains secrets - never commit real values)
.env

# SQLite database files
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm

# Logs
logs/
*.log

# OS files
.DS_Store
Thumbs.db

# IDE
.idea/
.vscode/
```

### config/server.js

```js
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
```

### config/constants.js

```js
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
```

### models/database.js

```js
/**
 * models/database.js
 * ------------------------------------------------------------------
 * SQLite connection singleton. On startup the application calls
 * `initialize()` which:
 *   1. Ensures the data/ directory exists
 *   2. Opens (or creates) the SQLite file
 *   3. Enables WAL mode for better concurrent read performance
 *   4. Runs all migration SQL statements to create/update tables
 *
 * The module exports a promise-based wrapper around sqlite3 so
 * every other file can simply:  const db = require('../models/database');
 *                                const row = await db.get(...);
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const serverConfig = require('../config/server');

// ---------------------------------------------------------------------------
// Ensure data directory exists before opening the database file.
// ---------------------------------------------------------------------------
const dataDir = path.dirname(serverConfig.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Open (or create) the SQLite database.
// ---------------------------------------------------------------------------
let _db = null;

function getDb() {
  if (!_db) {
    _db = new sqlite3.Database(serverConfig.dbPath, (err) => {
      if (err) {
        console.error('[DB] Failed to open database:', err.message);
      } else {
        console.log('[DB] Opened:', serverConfig.dbPath);
      }
    });
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Promisified helpers — sqlite3 callbacks → async/await.
// ---------------------------------------------------------------------------

/**
 * Run a SQL statement (INSERT/UPDATE/DELETE/CREATE).
 */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) return reject(err);
      // `this` contains lastID and changes for INSERT/UPDATE/DELETE
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * Get a single row.
 */
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Get all matching rows.
 */
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ---------------------------------------------------------------------------
// Initialization — enable WAL mode, run migrations, schedule cleanup.
// ---------------------------------------------------------------------------
async function initialize() {
  try {
    // Enable WAL journal mode for better concurrent performance.
    await run('PRAGMA journal_mode = WAL');
    // Enable foreign key support (off by default in SQLite).
    await run('PRAGMA foreign_keys = ON');

    // Load and execute migration SQL.
    const migrationPath = path.resolve(__dirname, '../migrations/001_create_tables.sql');
    if (fs.existsSync(migrationPath)) {
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      // Split on semicolons to execute statements individually.
      const statements = migrationSQL
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        await run(stmt);
      }
      console.log('[DB] Migrations executed successfully');
    }

    // Schedule periodic cleanup of old data (every 6 hours).
    setInterval(cleanupOldData, 6 * 60 * 60 * 1000);
    // Run cleanup once on startup.
    await cleanupOldData();

    console.log('[DB] Initialised');
  } catch (err) {
    console.error('[DB] Initialisation error:', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Housekeeping — delete readings older than the configured retention period.
// ---------------------------------------------------------------------------
async function cleanupOldData() {
  try {
    const cutoff = new Date(Date.now() - serverConfig.retentionDays * 86400000).toISOString();
    const { changes } = await run(
      'DELETE FROM sensor_readings WHERE timestamp < ?',
      [cutoff]
    );
    if (changes > 0) {
      console.log(`[DB] Purged ${changes} old sensor readings (before ${cutoff})`);
    }
  } catch (err) {
    console.error('[DB] Cleanup error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown.
// ---------------------------------------------------------------------------
function close() {
  return new Promise((resolve) => {
    if (_db) {
      _db.close((err) => {
        if (err) console.error('[DB] Close error:', err.message);
        _db = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = { initialize, run, get, all, close, getDb };
```

### models/sensorData.js

```js
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
```

### models/device.js

```js
/**
 * models/device.js
 * ------------------------------------------------------------------
 * Data-access layer for the `devices` table.
 * Stores metadata about each ESP32 that has ever sent data.
 */
const db = require('./database');
const constants = require('../config/constants');

// ---------------------------------------------------------------------------
// UPSERT — register a device or update its info if it already exists.
// The `replace()` semantics of SQLite make this simple: INSERT OR REPLACE.
// ---------------------------------------------------------------------------
async function upsert({ deviceId, deviceName, ipAddress, macAddress, firmwareVersion, espSignalStrength }) {
  const sql = `
    INSERT INTO devices (deviceId, deviceName, ipAddress, macAddress, firmwareVersion, lastSeen, status)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(deviceId) DO UPDATE SET
      deviceName      = COALESCE(excluded.deviceName, devices.deviceName),
      ipAddress       = COALESCE(excluded.ipAddress, devices.ipAddress),
      macAddress      = COALESCE(excluded.macAddress, devices.macAddress),
      firmwareVersion = COALESCE(excluded.firmwareVersion, devices.firmwareVersion),
      lastSeen        = datetime('now'),
      status          = ?
  `;
  const online = constants.DEVICE_STATUS.ONLINE;
  return db.run(sql, [deviceId, deviceName, ipAddress, macAddress, firmwareVersion, online, online]);
}

// ---------------------------------------------------------------------------
// GET the latest data point number for a device (incremented each reading).
// ---------------------------------------------------------------------------
async function getLatestDataPointNumber(deviceId) {
  const row = await db.get(
    'SELECT dataPointNumber FROM sensor_readings WHERE deviceId = ? ORDER BY id DESC LIMIT 1',
    [deviceId]
  );
  return row ? row.dataPointNumber : 0;
}

// ---------------------------------------------------------------------------
// GET device info.
// ---------------------------------------------------------------------------
async function getById(deviceId) {
  return db.get('SELECT * FROM devices WHERE deviceId = ?', [deviceId]);
}

// ---------------------------------------------------------------------------
// LIST all registered devices.
// ---------------------------------------------------------------------------
async function listAll() {
  return db.all('SELECT * FROM devices ORDER BY lastSeen DESC');
}

// ---------------------------------------------------------------------------
// UPDATE device status (ONLINE/OFFLINE).
// ---------------------------------------------------------------------------
async function setStatus(deviceId, status) {
  return db.run('UPDATE devices SET status = ?, lastSeen = datetime(\'now\') WHERE deviceId = ?', [status, deviceId]);
}

module.exports = { upsert, getById, listAll, setStatus, getLatestDataPointNumber };
```

### models/alert.js

```js
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
```

### routes/sensor.js

```js
/**
 * routes/sensor.js
 * ------------------------------------------------------------------
 * Sensor-data endpoints. The ESP32 POSTs a reading here every 2-5s;
 * the server validates it, computes the motor condition, persists the
 * reading and then broadcasts the update to all connected dashboards
 * over WebSocket.
 */
const express = require('express');
const router = express.Router();
const sensorDataModel = require('../models/sensorData');
const deviceModel = require('../models/device');
const alertModel = require('../models/alert');
const constants = require('../config/constants');
const { determineMotorCondition, buildConditionMessage } = require('../websocket/motorLogic');
const serverConfig = require('../config/server');

// Injected by server.js to avoid a circular require. Holds latest-state
// broadcast logic + the WebSocket manager.
let wsBus = null;
function setWsBus(bus) { wsBus = bus; }

// Track last emitted condition + point counter per device so we only fire
// an alert on a state CHANGE and avoid a DB round-trip to count points on
// every 2 s POST (the counter is seeded from the DB on first contact).
const lastCondition = new Map();

// ---------------------------------------------------------------------------
// POST /api/sensor/data
// Body: { deviceId, temperature, vibration, timestamp?, espSignalStrength? }
// ---------------------------------------------------------------------------
router.post('/data', async (req, res) => {
  // ---- 1. Validate required fields --------------------------------------
  const { deviceId, temperature, vibration } = req.body || {};
  const timestamp  = req.body.timestamp  || new Date().toISOString();
  const espSignalStrength = req.body.espSignalStrength;

  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATA', message: 'Missing or invalid deviceId' });
  }
  if (temperature === undefined || !Number.isFinite(Number(temperature))) {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATA', message: 'Missing or invalid temperature' });
  }
  if (vibration === undefined || !Number.isFinite(Number(vibration))) {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATA', message: 'Missing or invalid vibration' });
  }
  if (vibration < 0 || vibration > constants.VIBRATION_MAX_ADC) {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATA', message: 'Vibration outside ADC range (0-1023)' });
  }

  // ---- 2. Compute motor condition ----------------------------------------
  const motorCondition = determineMotorCondition(temperature, vibration);

  // ---- 3. Persist reading + keep device metadata fresh --------------------
  try {
    const remoteAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;

    // In-memory point counter — seed once from the DB, then increment.
    let meta = lastCondition.get(deviceId);
    if (!meta) {
      const lastNum = await deviceModel.getLatestDataPointNumber(deviceId);
      meta = { condition: null, num: lastNum };
      lastCondition.set(deviceId, meta);
    }
    const dataPointNumber = meta.num + 1;
    meta.num = dataPointNumber;

    // Fire both writes concurrently (SQLite serialises internally anyway,
    // but this trims one round of await latency off the request).
    const [dataId] = await Promise.all([
      sensorDataModel.create({
        deviceId,
        temperature: Number(temperature),
        vibration: Number(vibration),
        motorCondition,
        timestamp,
        espSignalStrength,
        dataPointNumber,
      }),
      deviceModel.upsert({
        deviceId,
        deviceName: req.body.deviceName,
        ipAddress: remoteAddr,
        macAddress: req.body.macAddress,
        firmwareVersion: req.body.firmwareVersion,
        espSignalStrength,
      }),
    ]);

    // ---- 4. Fire an alert on condition CHANGE -----------------------------
    const prev = meta.condition;
    if ((motorCondition === 'WARNING' || motorCondition === 'FAULT') && prev !== motorCondition) {
      await alertModel.create({
        deviceId,
        alertType: motorCondition === 'FAULT' ? 'temp_vibration' : motorCondition,
        severity: motorCondition === 'FAULT' ? 'high' : 'medium',
        message: buildConditionMessage(Number(temperature), Number(vibration), motorCondition),
      });
    }
    meta.condition = motorCondition;

    // ---- 5. Broadcast to dashboards ---------------------------------------
    if (wsBus) {
      wsBus.broadcastSensorUpdate({
        deviceId,
        data: {
          temperature: Number(temperature),
          vibration: Number(vibration),
          motorCondition,
          timestamp,
          espSignalStrength,
          dataPointNumber,
        },
      });
    }

    res.status(201).json({
      status: 'success',
      message: 'Data received and processed',
      motorCondition,
      dataId,
    });
  } catch (err) {
    console.error('[SENSOR] Database error:', err.message);
    res.status(500).json({ status: 'error', code: 'DB_ERROR', message: 'Database error, please retry' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sensor/latest?deviceId=...
// Most recent reading for a device.
// ---------------------------------------------------------------------------
router.get('/latest', async (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATA', message: 'deviceId query parameter required' });
  }
  try {
    const latest = await sensorDataModel.getLatest(deviceId);
    const device = await deviceModel.getById(deviceId);

    // Determine current connection state (OFFLINE if stale).
    let onlineStatus = constants.DEVICE_STATUS.OFFLINE;
    if (device && Date.now() - new Date(device.lastSeen + 'Z').getTime() < serverConfig.deviceOfflineMs) {
      onlineStatus = constants.DEVICE_STATUS.ONLINE;
    }

    res.json({ status: 'success', data: latest, connectionStatus: onlineStatus });
  } catch (err) {
    console.error('[SENSOR] Latest error:', err.message);
    res.status(500).json({ status: 'error', message: 'Database error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sensor/history?deviceId=...&minutes=30&limit=100
// Historical readings for trend graphs.
// ---------------------------------------------------------------------------
router.get('/history', async (req, res) => {
  const deviceId = req.query.deviceId;
  const minutes = parseInt(req.query.minutes, 10) || 30;
  const limit   = Math.min(parseInt(req.query.limit, 10) || 100, 500);

  if (!deviceId) {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATA', message: 'deviceId query parameter required' });
  }
  try {
    const data = await sensorDataModel.getHistory(deviceId, minutes, limit);
    res.json({ status: 'success', data, count: data.length, deviceId, minutes, limit });
  } catch (err) {
    console.error('[SENSOR] History error:', err.message);
    res.status(500).json({ status: 'error', message: 'Database error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/sensor/clear?deviceId=... (optional device filter)
// Clears stored readings.  Useful during testing.
// ---------------------------------------------------------------------------
router.delete('/clear', async (req, res) => {
  try {
    const changes = await sensorDataModel.clearAll(req.query.deviceId || null);
    res.json({ status: 'success', message: `Deleted ${changes} readings` });
  } catch (err) {
    console.error('[SENSOR] Clear error:', err.message);
    res.status(500).json({ status: 'error', message: 'Database error' });
  }
});

router.setWsBus = setWsBus;
module.exports = router;
```

### routes/device.js

```js
/**
 * routes/device.js
 * ------------------------------------------------------------------
 * Endpoints for reading/updating device metadata (name, IP, MAC,
 * firmware, connection status).
 */
const express = require('express');
const router = express.Router();
const deviceModel = require('../models/device');
const constants = require('../config/constants');

// ---------------------------------------------------------------------------
// GET /api/device/list — all registered devices.
// ---------------------------------------------------------------------------
router.get('/list', async (req, res) => {
  try {
    const devices = await deviceModel.listAll();
    res.json({ status: 'success', count: devices.length, data: devices });
  } catch (err) {
    console.error('[DEVICE] List error:', err.message);
    res.status(500).json({ status: 'error', message: 'Database error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/device/:deviceId — single device with online/offline status.
// ---------------------------------------------------------------------------
router.get('/:deviceId', async (req, res) => {
  try {
    const device = await deviceModel.getById(req.params.deviceId);
    if (!device) {
      return res.status(404).json({ status: 'error', message: 'Device not found' });
    }

    // Compute ONLINE/OFFLINE from stored lastSeen timestamp
    // (SQLite datetime('now') stores UTC; we append 'Z' to parse it as UTC).
    let status = constants.DEVICE_STATUS.OFFLINE;
    if (device.lastSeen) {
      const lastSeenMs = new Date(device.lastSeen.replace(' ', 'T') + 'Z').getTime();
      if (!isNaN(lastSeenMs) && Date.now() - lastSeenMs < 30000) {
        status = constants.DEVICE_STATUS.ONLINE;
      }
    }

    res.json({ status: 'success', data: { ...device, currentStatus: status } });
  } catch (err) {
    console.error('[DEVICE] Get error:', err.message);
    res.status(500).json({ status: 'error', message: 'Database error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/device/:deviceId — remove a device and its data.
// ---------------------------------------------------------------------------
router.delete('/:deviceId', async (req, res) => {
  try {
    const db = require('../models/database');
    const result = await db.run('DELETE FROM devices WHERE deviceId = ?', [req.params.deviceId]);
    await db.run('DELETE FROM sensor_readings WHERE deviceId = ?', [req.params.deviceId]);
    res.json({ status: 'success', message: `Removed device (cascade ${result.changes})` });
  } catch (err) {
    console.error('[DEVICE] Delete error:', err.message);
    res.status(500).json({ status: 'error', message: 'Database error' });
  }
});

module.exports = router;
```

### routes/export.js

```js
/**
 * routes/export.js
 * ------------------------------------------------------------------
 * CSV export. The dashboard POSTs the device id (+ optional time
 * window) and receives a ready-to-download CSV file with headers:
 *   id, deviceId, temperature, vibration, motorCondition, timestamp,
 *   espSignalStrength
 */
const express = require('express');
const router = express.Router();
const sensorDataModel = require('../models/sensorData');

// ---------------------------------------------------------------------------
// POST /api/export/csv
// Body: { deviceId, startTime?, endTime? }
// ---------------------------------------------------------------------------
router.post('/csv', async (req, res) => {
  const { deviceId, startTime, endTime } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATA', message: 'deviceId is required' });
  }

  try {
    const rows = await sensorDataModel.getForExport(deviceId, startTime, endTime);

    // ---- Build CSV manually (no heavy library needed) ---------------------
    const header = ['id', 'deviceId', 'temperature', 'vibration', 'motorCondition', 'timestamp', 'espSignalStrength'];
    const escape = (value) => {
      const str = value === null || value === undefined ? '' : String(value);
      // Escape quotes and wrap with quotes only when necessary.
      return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    };

    const lines = rows.map((row) =>
      [row.id, row.deviceId, row.temperature, row.vibration, row.motorCondition, row.timestamp, row.espSignalStrength]
        .map(escape)
        .join(',')
    );

    const csv = [header.join(','), ...lines].join('\r\n');

    // ---- Stream to client as a download -----------------------------------
    const filename = `motor_data_${deviceId}_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[EXPORT] CSV error:', err.message);
    res.status(500).json({ status: 'error', message: 'Database error during export' });
  }
});

module.exports = router;
```

### routes/health.js

```js
/**
 * routes/health.js
 * ------------------------------------------------------------------
 * Simple health/status endpoint. Used by operators and by the
 * dashboard on load to confirm the server is reachable.
 */
const express = require('express');
const router = express.Router();
const manager = require('../websocket/manager');
const serverConfig = require('../config/server');

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'motor-inspection-dashboard',
    uptime: process.uptime(),
    wsClients: manager.count,
    retentionDays: serverConfig.retentionDays,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
```

### websocket/motorLogic.js

```js
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
```

### websocket/handler.js

```js
/**
 * websocket/handler.js
 * ------------------------------------------------------------------
 * Initialises the WebSocket server, registers connection listeners and
 * exposes a heartbeat task so we can detect dead connections.
 */
const WebSocket = require('ws');
const manager = require('./manager');

/**
 * Set up WebSocket support on the shared HTTP server.
 * @param {http.Server} server - Express HTTP server instance
 */
function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });
  manager.attach(wss);

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.upgradeReq = req;
    const info = manager.register(ws);

    // Greet the dashboard with connection + latest state info
    ws.send(JSON.stringify({
      type: 'connection_status',
      status: 'connected',
      message: 'Connected to dashboard server',
      clientId: info.id,
      timestamp: new Date().toISOString(),
    }));

    // Handle incoming messages from the browser (e.g. "ping" keep-alive,
    // or requests for the latest state).
    ws.on('message', (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        // ignore binary / malformed messages
        return;
      }
      if (msg.type === 'ping') {
        ws.isAlive = true;
        manager.send(ws, { type: 'pong', timestamp: new Date().toISOString() });
      } else if (msg.type === 'get_state') {
        // Dashboard asks for a fresh broadcast of latest data.
        // The callback is registered in server.js via module.exports.hooks.
        const { onGetStateRequest } = module.exports.hooks;
        if (onGetStateRequest) onGetStateRequest();
      }
    });

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => manager.unregister(ws));
    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
    });
  });

  return wss;
}

/**
 * Start the periodic heartbeat: every 30s terminate clients that have
 * not responded to the ping within that window.
 */
function startHeartbeat(wss) {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        console.log('[WS] Terminating dead connection');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Don't keep the node process alive purely for the interval.
  wss.on('close', () => clearInterval(interval));
}

// Hook object so server.js can register the "get_state" handler
// without circular imports.
module.exports.hooks = {
  onGetStateRequest: null,
};

module.exports.setupWebSocket = setupWebSocket;
module.exports.startHeartbeat = startHeartbeat;
```

### websocket/manager.js

```js
/**
 * websocket/manager.js
 * ------------------------------------------------------------------
 * Tracks all connected browser clients so the server can broadcast
 * real-time updates to every open dashboard.
 */
class WebSocketManager {
  constructor() {
    this.clients = new Map(); // ws -> { id, browser, connectedAt }
    this.wss = null;
  }

  /** Attach to a WebSocket.Server instance. */
  attach(wss) {
    this.wss = wss;
  }

  /** Assign a client an id and remember the browser user-agent. */
  register(client) {
    const info = {
      id: `client-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      browser: client.upgradeReq ? (client.upgradeReq.headers['user-agent'] || 'unknown') : 'unknown',
      connectedAt: new Date().toISOString(),
    };
    this.clients.set(client, info);
    console.log(`[WS] Client connected: ${info.id} (${this.clients.size} connected)`);
    return info;
  }

  /** Remove a client. */
  unregister(client) {
    this.clients.delete(client);
    console.log(`[WS] Client disconnected (${this.clients.size} remaining)`);
  }

  /** Number of connected clients. */
  get count() {
    return this.clients.size;
  }

  /** Send a JSON message to ALL connected clients. */
  broadcast(message) {
    if (!this.wss) return;
    const payload = JSON.stringify(message);
    let sent = 0;
    this.wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(payload);
        sent += 1;
      }
    });
    if (sent > 0) console.log(`[WS] Broadcast to ${sent} client(s): ${message.type}`);
  }

  /** Send a JSON message to a single client (used for ping/pong). */
  send(client, message) {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}

module.exports = new WebSocketManager();
```

### websocket/bus.js

```js
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
```

### migrations/001_create_tables.sql

```sql
-- =============================================================
-- 001_create_tables.sql — Motor Inspection Bot Dashboard schema
-- -------------------------------------------------------------
-- Three tables:
--   1. devices         — ESP32 metadata (name, IP, MAC, firmware)
--   2. sensor_readings — every temperature/vibration sample
--   3. alert_log       — WARNING/FAULT events with severity
-- =============================================================

-- ---- Devices --------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  deviceId        TEXT PRIMARY KEY,          -- e.g. MOTOR_BOT_01
  deviceName      TEXT,                      -- friendly name
  ipAddress       TEXT,                      -- last known IP
  macAddress      TEXT,                      -- ESP32 MAC (AA:BB:...)
  firmwareVersion TEXT,                      -- e.g. v1.0
  lastSeen        DATETIME,                  -- UTC timestamp of last POST
  status          TEXT DEFAULT 'ONLINE',     -- ONLINE / OFFLINE
  createdAt       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---- Sensor readings -------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_readings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId          TEXT NOT NULL,
  temperature       REAL NOT NULL,           -- °C
  vibration         REAL NOT NULL,           -- ADC value (0-1023)
  motorCondition    TEXT NOT NULL,           -- HEALTHY / WARNING / FAULT
  timestamp         DATETIME DEFAULT CURRENT_TIMESTAMP,
  espSignalStrength INTEGER,                 -- RSSI in dBm (optional)
  dataPointNumber   INTEGER,                 -- sequence number per device
  createdAt         DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deviceId) REFERENCES devices(deviceId)
);

-- ---- Alert log ------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId       TEXT NOT NULL,
  alertType      TEXT NOT NULL,              -- temperature / vibration / combined
  severity       TEXT NOT NULL,              -- medium (WARNING) / high (FAULT)
  message        TEXT,
  acknowledgedAt DATETIME,                   -- set when dismissed
  timestamp      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deviceId) REFERENCES devices(deviceId)
);

-- ---- Indexes for fast time-series queries -----------------------
CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON sensor_readings(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_readings_device    ON sensor_readings(deviceId);
CREATE INDEX IF NOT EXISTS idx_readings_condition ON sensor_readings(motorCondition);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp   ON alert_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_devices_lastSeen   ON devices(lastSeen);
```

### migrations/run.js

```js
/**
 * migrations/run.js
 * ------------------------------------------------------------------
 * Migration runner.  Simply initialises the database module which
 * executes every *.sql migration in order (currently just the schema
 * file).  Run with:  npm run migrate
 *
 * Usage:
 *   node migrations/run.js
 */
const db = require('../models/database');

(async () => {
  try {
    console.log('[MIGRATE] Starting database migration...');
    await db.initialize();
    console.log('[MIGRATE] Done. Schema is ready.');
    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('[MIGRATE] Failed:', err.message);
    process.exit(1);
  }
})();
```

### migrations/seed.js

```js
/**
 * migrations/seed.js
 * ------------------------------------------------------------------
 * Optional demo seed: posts ~90 fake sensor readings (past 30 minutes)
 * plus device metadata so the dashboard graphs look alive immediately
 * after a fresh install. Run with:  npm run seed
 */
const db = require('../models/database');
const { determineMotorCondition, buildConditionMessage } = require('../websocket/motorLogic');

async function seed() {
  const deviceId = 'MOTOR_BOT_01';

  console.log('[SEED] Initialising database...');
  await db.initialize();

  console.log('[SEED] Registering device...');
  await db.run(`
    INSERT INTO devices (deviceId, deviceName, ipAddress, macAddress, firmwareVersion, lastSeen, status)
    VALUES (?, 'Motor Bot #01', '192.168.1.105', 'AA:BB:CC:DD:00:01', 'v1.0', datetime('now'), 'ONLINE')
    ON CONFLICT(deviceId) DO UPDATE SET lastSeen = datetime('now'), status = 'ONLINE'
  `, [deviceId]);

  console.log('[SEED] Generating 90 sample readings...');
  const now = Date.now();
  let temp = 38;
  let vib = 180;

  for (let i = 89; i >= 0; i--) {
    // Random walk so the graph looks organic.
    temp = Math.max(30, Math.min(75, temp + (Math.random() * 5 - 2.2)));
    vib  = Math.max(50, Math.min(1023, vib + (Math.random() * 80 - 38)));

    // Occasionally spike to demonstrate WARNING/FAULT states.
    if (i === 40) { temp = 52; vib = 420; }   // WARNING
    if (i === 18) { temp = 66; vib = 760; }   // FAULT

    const ts = new Date(now - (89 - i) * 20000).toISOString();
    const condition = determineMotorCondition(temp, vib);

    await db.run(`
      INSERT INTO sensor_readings (deviceId, temperature, vibration, motorCondition, timestamp, espSignalStrength, dataPointNumber)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [deviceId, Math.round(temp * 10) / 10, Math.round(vib), condition, ts, -45 + Math.round(Math.random() * 6 - 3), 90 - i]);

    if (condition !== 'HEALTHY') {
      await db.run(`
        INSERT INTO alert_log (deviceId, alertType, severity, message, timestamp)
        VALUES (?, 'combined', ?, ?, ?)
      `, [deviceId, condition === 'FAULT' ? 'high' : 'medium', buildConditionMessage(temp, vib, condition), ts]);
    }
  }

  console.log('[SEED] Done. Log in to the dashboard to view the demo data.');
  await db.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('[SEED] Failed:', err.message);
  process.exit(1);
});
```

### public/index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!--
    index.html — Motor Inspection Bot · Real-Time IoT Dashboard
    ------------------------------------------------------------
    Vanilla HTML/CSS/JS + Chart.js (CDN). Chart.js is the ONLY
    external dependency; everything else is hand-rolled so the
    project is easy to explain during the viva presentation.
  -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Motor Inspection Bot — Real-Time Dashboard</title>

  <meta name="description" content="IoT dashboard monitoring motor temperature and vibration from an ESP32-based portable inspection bot">

  <!-- Fonts: Roboto (UI) + Roboto Mono (metrics/timestamps) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">

  <!-- Stylesheets -->
  <link rel="stylesheet" href="css/styles.css">
  <link rel="stylesheet" href="css/responsive.css">
  <link rel="stylesheet" href="css/animations.css">
  <link rel="stylesheet" href="css/dark-mode.css">

  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%2300C853'/%3E%3C/svg%3E">
</head>
<body>

  <!-- ============================================================
       HEADER — title + global connection pill
       ============================================================ -->
  <header class="app-header">
    <div class="header-inner">
      <div class="title-block">
        <h1 class="app-title">⚙️ Motor Inspection Bot — Real-Time Dashboard</h1>
        <p class="app-subtitle">Portable mechatronics inspection · ESP32 field device</p>
      </div>

      <!-- Global connectivity (WebSocket <-> server) indicator -->
      <div id="globalStatus" class="status-pill status-offline" title="Server connection status">
        <span class="dot"></span>
        <span id="globalStatusText">CONNECTING…</span>
      </div>
    </div>
  </header>

  <!-- ============================================================
       MAIN GRID
       Left column : metrics + charts
       Right column: alerts + device info + controls
       ============================================================ -->
  <main class="dashboard-grid">

    <!-- ============== LEFT COLUMN ============== -->
    <section class="col-main">

      <!-- ---- Real-time metric cards ---- -->
      <div class="row metrics-row">

        <!-- Temperature card -->
        <article class="card metric-card" id="tempCard">
          <div class="metric-label">Temperature</div>
          <div class="metric-value temp-value" id="tempValue">--</div>
          <div class="metric-unit">° Celsius</div>
          <div class="metric-range">
            <span class="range-min">Min <b id="tempMin">--</b> °C</span>
            <span class="range-max">Max <b id="tempMax">--</b> °C</span>
          </div>
          <div class="metric-status" id="tempStatus">—</div>
        </article>

        <!-- Vibration card -->
        <article class="card metric-card" id="vibCard">
          <div class="metric-label">Vibration</div>
          <div class="metric-value vib-value" id="vibValue">--</div>
          <div class="metric-unit">ADC 0–1023</div>

          <!-- Visual level bar -->
          <div class="vib-bar">
            <div class="vib-bar-fill" id="vibBar" style="width:0%"></div>
          </div>
          <div class="vib-scale"><span>0</span><span>300</span><span>600</span><span>1023</span></div>

          <div class="metric-range">
            <span class="range-min">Level <b id="vibLevel">--</b></span>
            <span class="range-max">Avg <b id="vibAvg">--</b></span>
          </div>
          <div class="metric-status" id="vibStatus">—</div>
        </article>

        <!-- Overall condition badge -->
        <article class="card condition-card">
          <div class="metric-label">Motor Condition</div>
          <div class="condition-badge condition-healthy" id="conditionBadge">
            <div class="condition-icon">🟢</div>
            <div class="condition-text" id="conditionText">HEALTHY</div>
          </div>
          <div class="condition-message" id="conditionMessage">Normal operation</div>

          <!-- ESP32 connection + last update -->
          <div class="device-net">
            <div class="net-row">
              <span>ESP32 Connection</span>
              <span class="net-value" id="espConnection">
                <span class="dot dot-green"></span> ONLINE
              </span>
            </div>
            <div class="net-row">
              <span>Last Updated</span>
              <span class="net-value mono" id="lastUpdated">--:--:--</span>
            </div>
            <div class="net-row">
              <span>Data Point</span>
              <span class="net-value mono" id="dataPoint">--</span>
            </div>
          </div>
        </article>

        <!-- Connection stats mini-card -->
        <article class="card connection-card">
          <div class="metric-label">Server &amp; Stream</div>
          <div class="net-row"><span>WebSocket</span><span class="net-value" id="wsPill">—</span></div>
          <div class="net-row"><span>Server API</span><span class="net-value" id="apiPill">—</span></div>
          <div class="net-row"><span>Readings / min</span><span class="net-value mono" id="ratePill">0</span></div>
          <div class="net-row"><span>Signal Strength</span><span class="net-value mono" id="signalPill">--</span></div>
        </article>
      </div>

      <!-- ---- Trend graphs ---- -->
      <div class="row charts-row">
        <article class="card chart-card">
          <div class="chart-header">
            <h3 class="chart-title">Temperature Trend <span class="chart-hint">last 30 min</span></h3>
            <!-- Threshold legend -->
            <div class="legend">
              <span class="legend-item"><i class="swatch swatch-temp"></i> Temp °C</span>
              <span class="legend-item"><i class="swatch swatch-warn"></i> Warning 45°C</span>
              <span class="legend-item"><i class="swatch swatch-fault"></i> Fault 60°C</span>
            </div>
          </div>
          <div class="chart-wrap"><canvas id="temperatureChart"></canvas></div>
        </article>

        <article class="card chart-card">
          <div class="chart-header">
            <h3 class="chart-title">Vibration Trend <span class="chart-hint">ADC 0–1023</span></h3>
            <div class="legend">
              <span class="legend-item"><i class="swatch swatch-vib"></i> Vibration</span>
              <span class="legend-item"><i class="swatch swatch-warn"></i> Warning 300</span>
              <span class="legend-item"><i class="swatch swatch-fault"></i> Fault 600</span>
            </div>
          </div>
          <div class="chart-wrap"><canvas id="vibrationChart"></canvas></div>
        </article>
      </div>
    </section>

    <!-- ============== RIGHT COLUMN ============== -->
    <aside class="col-side">

      <!-- Alerts & warnings -->
      <article class="card">
        <div class="panel-header">
          <h3 class="panel-title">⚠️ Alerts &amp; Warnings</h3>
          <button id="clearAlertsBtn" class="btn btn-link btn-sm">Clear All</button>
        </div>

        <div class="alert-list" id="alertList">
          <!-- Alerts injected by dashboard.js -->
          <div class="empty-state" id="alertsEmpty">No active alerts 🎉</div>
        </div>
      </article>

      <!-- Device information -->
      <article class="card">
        <div class="panel-header"><h3 class="panel-title">🖥️ Device Information</h3></div>
        <div class="info-list">
          <div class="info-row"><span class="info-label">Device Name</span><span class="info-value" id="infoName">--</span></div>
          <div class="info-row"><span class="info-label">Device ID</span><span class="info-value mono" id="infoId">--</span></div>
          <div class="info-row"><span class="info-label">IP Address</span><span class="info-value mono" id="infoIp">--</span></div>
          <div class="info-row"><span class="info-label">MAC Address</span><span class="info-value mono" id="infoMac">--</span></div>
          <div class="info-row"><span class="info-label">Firmware</span><span class="info-value mono" id="infoFw">--</span></div>
          <div class="info-row"><span class="info-label">Signal</span><span class="info-value mono" id="infoSignal">--</span></div>
          <div class="info-row"><span class="info-label">Uptime</span><span class="info-value mono" id="infoUptime">--</span></div>
          <div class="info-row"><span class="info-label">Data Points Logged</span><span class="info-value mono" id="infoPoints">--</span></div>
          <div class="info-row"><span class="info-label">Connection</span><span class="info-value" id="infoConn">--</span></div>
        </div>
      </article>

      <!-- Dashboard controls -->
      <article class="card">
        <div class="panel-header"><h3 class="panel-title">🎛️ Dashboard Controls</h3></div>
        <div class="controls-grid">
          <button id="refreshBtn" class="btn">🔄 Refresh Now</button>
          <!-- Data stream toggle: starts as "RUNNING" mode button -->
          <button id="streamToggleBtn" class="btn is-danger">⏹ Stop Data Stream</button>
          <button id="exportBtn" class="btn">📊 Export Data (CSV)</button>
          <button id="settingsBtn" class="btn">🔧 Settings</button>
          <button id="darkModeBtn" class="btn">🌙 Dark Mode</button>
          <button id="simulateBtn" class="btn is-accent">🧪 Simulate ESP32</button>
        </div>
        <p class="help-text" id="simulateHint">
          No ESP32 handy? Click <b>Simulate ESP32</b> — the dashboard will generate
          realistic test data locally every 2 seconds.
        </p>
      </article>
    </aside>
  </main>

  <!-- ============================================================
       FOOTER
       ============================================================ -->
  <footer class="app-footer">
    <span>Motor Inspection Bot v1.0</span>
    <span>·</span>
    <span>B.E. Mechatronics Project</span>
    <span>·</span>
    <span id="footerClock" class="mono">--:--:--</span>
  </footer>

  <!-- ============================================================
       OVERLAYS — settings modal + toast notifications
       ============================================================ -->
  <div id="settingsModal" class="modal-backdrop hidden">
    <div class="modal">
      <div class="modal-header">
        <h3>🔧 Dashboard Settings</h3>
        <button id="closeSettingsBtn" class="btn-icon">✕</button>
      </div>
      <div class="modal-body">
        <label class="field">
          <span>Device ID (for live data)</span>
          <input type="text" id="setDeviceId" value="MOTOR_BOT_01">
        </label>
        <label class="field">
          <span>Graph window (minutes)</span>
          <input type="number" id="setWindowMinutes" value="30" min="5" max="1440">
        </label>
        <label class="field">
          <span>Max data points on chart</span>
          <input type="number" id="setMaxPoints" value="100" min="20" max="500">
        </label>
        <label class="field toggle-field">
          <span>Dark mode</span>
          <input type="checkbox" id="setDarkMode">
        </label>
      </div>
      <div class="modal-footer">
        <button id="saveSettingsBtn" class="btn is-accent">Save</button>
      </div>
    </div>
  </div>

  <div id="toastHost" class="toast-host"></div>

  <!-- Chart.js — vendored locally (no CDN dependency, works offline) -->
  <script src="lib/chart.umd.min.js"></script>

  <!-- App modules (order matters: utils → storage → api → charts →
       websocket → dashboard) -->
  <script src="js/utils.js"></script>
  <script src="js/storage.js"></script>
  <script src="js/api.js"></script>
  <script src="js/charts.js"></script>
  <script src="js/websocket.js"></script>
  <script src="js/dashboard.js"></script>
</body>
</html>
```

### public/js/utils.js

```js
/**
 * js/utils.js — shared helpers
 * ------------------------------------------------------------------
 * Small, dependency-free utilities used by every other module:
 * DOM shortcuts, formatting, and the motor-condition classifier
 * (mirrored on the backend so the UI is never caught off-guard).
 */
(function () {
  window.App = window.App || {};

  const Utils = {
    // ---- DOM helpers ---------------------------------------------------
    $: (sel, root) => (root || document).querySelector(sel),
    $$: (sel, root) => Array.from((root || document).querySelectorAll(sel)),

    /** Parse an ISO string safely; fall back to now. */
    parseDate: (iso) => {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? new Date() : d;
    },

    /** HH:MM:SS in the local timezone. */
    formatTime: (iso) => {
      const d = Utils.parseDate(iso);
      return d.toTimeString().slice(0, 8);
    },

    /** HH:MM:SS and DD/MM for chart axis labels. */
    formatChartTime: (iso) => Utils.formatTime(iso).slice(0, 5),

    /** Basic relative time like "12s ago". */
    timeAgo: (iso) => {
      const secs = Math.max(0, Math.floor((Date.now() - Utils.parseDate(iso).getTime()) / 1000));
      if (secs < 60) return `${secs}s ago`;
      if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
      return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ago`;
    },

    /** Format uptime seconds → "2h 34m 12s". */
    formatUptime: (seconds) => {
      const s = Math.max(0, Math.floor(seconds));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return `${h}h ${m}m ${s % 60}s`;
    },

    /**
     * Motor condition classifier (mirrors config/constants.js).
     * Returns the worst matching status for a given temperature/vibration.
     */
    determineCondition: (temperature, vibration, thresholds) => {
      const t = thresholds?.temperature || { healthyMax: 45, warningMax: 60 };
      const v = thresholds?.vibration   || { healthyMax: 300, warningMax: 600 };

      const tempBad  = temperature > t.healthyMax;
      const tempFault = temperature > t.warningMax;
      const vibBad   = vibration > v.healthyMax;
      const vibFault = vibration > v.warningMax;

      if (tempFault || vibFault) return 'FAULT';
      if (tempBad || vibBad) return 'WARNING';
      return 'HEALTHY';
    },

    /** Human-friendly status message for each condition. */
    conditionMessage: (condition) => {
      return {
        HEALTHY: 'Normal operation',
        WARNING: 'Check motor — reading outside safe range',
        FAULT: 'Immediate inspection required!',
      }[condition] || 'Unknown';
    },

    /** Status → CSS status class suffix. */
    statusClass: (condition) => (condition === 'HEALTHY' ? 'healthy' : condition === 'WARNING' ? 'warning' : 'fault'),

    /** Condition → emoji used in the alert icon column. */
    conditionEmoji: (condition) => ({
      HEALTHY: '🟢',
      WARNING: '🟠',
      FAULT: '🔴',
    }[condition] || '⚪'),

    /** Relative vibration level label. */
    vibrationLevel: (vib, thresholds) => {
      const v = thresholds?.vibration || { healthyMax: 300, warningMax: 600 };
      if (vib > v.warningMax) return 'VERY HIGH';
      if (vib > v.healthyMax) return 'HIGH';
      if (vib > v.healthyMax * 0.5) return 'NORMAL';
      return 'LOW';
    },

    /** Clamp helper. */
    clamp: (val, min, max) => Math.min(max, Math.max(min, val)),

    /** format number with locale separators. */
    num: (n) => (n === null || n === undefined || isNaN(n)) ? '--' : Number(n).toLocaleString('en-IN'),
  };

  App.Utils = Utils;
})();
```

### public/js/storage.js

```js
/**
 * js/storage.js — localStorage persistence
 * ------------------------------------------------------------------
 * Stores user preferences:
 *   - theme        : 'light' | 'dark'
 *   - settings     : { deviceId, windowMinutes, maxPoints, darkMode }
 *   - streamActive : whether the live stream is paused
 *
 * Also holds the session's running min/max desaturated values and
 * the in-memory data buffer used by the charts.
 */
(function () {
  window.App = window.App || {};

  const KEYS = {
    theme: 'mbi.theme',
    settings: 'mbi.settings',
    stream: 'mbi.streamActive',
  };

  // Defaults
  const DEFAULT_SETTINGS = {
    deviceId: 'MOTOR_BOT_01',
    windowMinutes: 30,
    maxPoints: 100,
    darkMode: false,
  };

  const Storage = {
    // ---- Generic get/set with JSON safety -----------------------------
    get(key) {
      try {
        const raw = localStorage.getItem(KEYS[key] || key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    set(key, value) {
      try {
        localStorage.setItem(KEYS[key] || key, JSON.stringify(value));
      } catch (e) { /* storage may be unavailable (private mode) — ignore */ }
    },

    remove(key) {
      try { localStorage.removeItem(KEYS[key] || key); } catch (e) { /* noop */ }
    },

    // ---- Theme ---------------------------------------------------------
    getTheme: () => Storage.get('theme') || 'light',
    setTheme: (t) => Storage.set('theme', t),

    // ---- Settings ------------------------------------------------------
    loadSettings: () => ({ ...DEFAULT_SETTINGS, ...(Storage.get('settings') || {}) }),
    saveSettings: (s) => Storage.set('settings', s),

    // ---- Stream toggle -------------------------------------------------
    isStreamActive: () => Storage.get('stream') !== false,
    setStreamActive: (active) => Storage.set('stream', !!active),

    // ---- In-memory session state (not persisted) -----------------------
    session: {
      // Rolling arrays mirroring the chart datasets:
      // { labels: [iso strings], temps: [], vibs: [] }
      buffer: { labels: [], temps: [], vibs: [] },
      minTemp: null,
      maxTemp: null,
      vibSum: 0,
      readingCount: 0,
      lastTemp: null,
      lastVib: null,
      lastCondition: null,
      lastSignal: null,
      lastTimestamp: null,
      events: [],            // recent sensor readings per minute counter
      eventTimestamps: [],   // rolling 60s window for readings/minute
    },
  };

  App.Storage = Storage;
})();
```

### public/js/api.js

```js
/**
 * js/api.js — REST API helpers
 * ------------------------------------------------------------------
 * Thin wrappers over fetch() for the backend endpoints. Every helper
 * returns Promises and normalises error responses so callers don't
 * need to repeat try/catch boilerplate.
 */
(function () {
  window.App = window.App || {};

  const API = {
    // ---- shared request helper ----------------------------------------
    async request(path, options = {}) {
      const cfg = {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      };
      const res = await fetch(path, cfg);

      // CSV etc. may not be JSON — let caller decide by content-type.
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return res.json();

      if (!res.ok) {
        let body = {};
        try { body = await res.json(); } catch (e) { /* non-JSON error */ }
        throw new Error(body.message || `Request failed (${res.status})`);
      }
      return res;
    },

    // ---- Sensor endpoints ----------------------------------------------
    /** POST a reading (used by the "Simulate ESP32" mode). */
    postSensorData(payload) {
      return API.request('/api/sensor/data', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    /** GET the latest reading for a device. */
    getLatest(deviceId) {
      return API.request(`/api/sensor/latest?deviceId=${encodeURIComponent(deviceId)}`);
    },

    /** GET historical readings for the charts. */
    getHistory(deviceId, minutes = 30, limit = 100) {
      return API.request(`/api/sensor/history?deviceId=${encodeURIComponent(deviceId)}&minutes=${minutes}&limit=${limit}`);
    },

    // ---- Devices --------------------------------------------------------
    getDeviceList() {
      return API.request('/api/device/list');
    },

    getDevice(deviceId) {
      return API.request(`/api/device/${encodeURIComponent(deviceId)}`);
    },

    // ---- Alerts ---------------------------------------------------------
    getAlerts() {
      return API.request('/api/device/list'); // alerts delivered live via WS; this is reserved
    },

    // ---- Export ---------------------------------------------------------
    /** Trigger CSV download in the browser. */
    async exportCsv(deviceId, startTime, endTime) {
      const res = await fetch('/api/export/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, startTime, endTime }),
      });
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try { const j = await res.json(); msg = j.message || msg; } catch (e) { /* noop */ }
        throw new Error(msg);
      }
      // Build a Blob from the raw text and trigger a download.
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `motor_data_${deviceId}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return { rows: text.trim() ? text.trim().split('\n').length - 1 : 0 };
    },

    // ---- Health ---------------------------------------------------------
    getHealth() {
      return API.request('/health');
    },
  };

  App.API = API;
})();
```

### public/js/charts.js

```js
/**
 * js/charts.js — Chart.js instances (performance-tuned)
 * ------------------------------------------------------------------
 * Performance choices (60 FPS on a demo laptop / tablet):
 *   1. `animation: false`  — Canvas redraws on live data are immediate
 *      instead of easing; the JS runtime cost drops dramatically.
 *   2. `pointRadius: 0`    — fewer pixels to rasterise per frame.
 *   3. `render(buffer)`    — copies only a *slice* of the rolling buffer
 *      into the chart arrays; O(n) with n ≤ maxPoints (≤500).
 *   4. `appendPoint()`     — cheap push/shift path used when a single
 *      reading arrives, avoiding a full array rebuild.
 *
 * The dashboard keeps one authoritative buffer and asks the charts to
 * draw it; the chart layer never owns data logic.
 */
(function () {
  window.App = window.App || {};

  // Cheap element lookup cache (avoids document.querySelector each frame).
  const elCache = {
    tempCanvas: null,
    vibCanvas: null,
    tempColor: null,
    vibColor: null,
  };

  const Charts = {
    tempChart: null,
    vibChart: null,
    maxPoints: 100,
    thresholds: { temperature: { healthyMax: 45, warningMax: 60 }, vibration: { healthyMax: 300, warningMax: 600 } },

    // ---- one-time theme resolution (avoids getComputedStyle per update) --
    _colors(isDark) {
      elCache.tempColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--graph-temp').trim() || (isDark ? '#64B5F6' : '#1976D2');
      elCache.vibColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--graph-vib').trim() || (isDark ? '#9CCC65' : '#7CB342');
    },

    // ---- initialisation -------------------------------------------------
    init({ maxPoints, isDark, thresholds }) {
      if (thresholds) this.thresholds = thresholds;
      this.maxPoints = maxPoints || 100;
      this._colors(!!isDark);

      const U = App.Utils;
      const tickColor = isDark ? '#BDBDBD' : '#757575';
      const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

      // Shared scale config — built once, reused by both charts.
      const scalesFactory = () => ({
        x: {
          ticks: { color: tickColor, maxTicksLimit: 8, maxRotation: 0, autoSkip: true },
          grid: { display: false },
        },
        y: {
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
      });

      // Per-chart base options: animation OFF, tiny points, cheap fill.
      const base = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,                     // KEY: instant redraws
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
        },
      };

      // ---- Temperature chart --------------------------------------------
      elCache.tempCanvas = U.$('#temperatureChart');
      if (elCache.tempCanvas && window.Chart) {
        if (this.tempChart) this.tempChart.destroy();
        this.tempChart = new Chart(elCache.tempCanvas, {
          type: 'line',
          data: {
            labels: [],
            datasets: [{
              label: 'Temperature (°C)',
              data: [],
              borderColor: elCache.tempColor,
              backgroundColor: elCache.tempColor + '14',   // ~8% alpha fill
              tension: 0.35,
              borderWidth: 2,
              pointRadius: 0,                              // fast draw
              pointHitRadius: 8,                           // easy hover target still
              pointHoverRadius: 4,
              fill: true,
            }],
          },
          options: {
            ...base,
            scales: {
              ...scalesFactory(),
              y: {
                ...scalesFactory().y,
                min: 0,
                max: 100,
                ticks: { color: tickColor, stepSize: 20, callback: (v) => v + '°C' },
              },
            },
          },
        });
      }

      // ---- Vibration chart + threshold bands -----------------------------
      elCache.vibCanvas = U.$('#vibrationChart');
      if (elCache.vibCanvas && window.Chart) {
        if (this.vibChart) this.vibChart.destroy();
        this.vibChart = new Chart(elCache.vibCanvas, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              {
                label: 'Vibration',
                data: [],
                borderColor: elCache.vibColor,
                backgroundColor: elCache.vibColor + '14',
                tension: 0.35,
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 8,
                pointHoverRadius: 4,
                fill: true,
              },
              { label: 'Warning', data: [], borderColor: '#FFA726', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, spanGaps: true },
              { label: 'Fault',   data: [], borderColor: '#E53935', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, spanGaps: true },
            ],
          },
          options: {
            ...base,
            scales: {
              ...scalesFactory(),
              y: {
                ...scalesFactory().y,
                min: 0,
                max: 1023,
                ticks: { color: tickColor, stepSize: 200 },
              },
            },
          },
        });
      }
    },

    // ---- full render from the rolling buffer -----------------------------
    /**
     * @param {{labels:string[],temps:number[],vibs:number[]}|null} buffer
     */
    render(buffer) {
      const n = this.maxPoints;
      const labels = buffer ? buffer.labels.slice(-n) : [];
      const temps  = buffer ? buffer.temps.slice(-n)  : [];
      const vibs   = buffer ? buffer.vibs.slice(-n)   : [];
      const t = this.thresholds.vibration;

      if (this.tempChart) {
        this.tempChart.data.labels = labels;
        this.tempChart.data.datasets[0].data = temps;
        this.tempChart.update('none');
      }
      if (this.vibChart) {
        this.vibChart.data.labels = labels;
        this.vibChart.data.datasets[0].data = vibs;
        // Threshold lines: flat arrays aligned to labels (reused arrays).
        const warn = labels.map(() => t.healthyMax);
        const fault = labels.map(() => t.warningMax);
        this.vibChart.data.datasets[1].data = warn;
        this.vibChart.data.datasets[2].data = fault;
        this.vibChart.update('none');
      }
    },

    // ---- incremental append (single live point) --------------------------
    /**
     * Fast path: push one reading onto both charts. Used by the WebSocket
     * handler when the buffer is the single source of truth and only the
     * newest point changed. O(1) push + shift.
     */
    appendPoint(label, temp, vib) {
      const n = this.maxPoints;

      if (this.tempChart) {
        this.tempChart.data.labels.push(label);
        this.tempChart.data.datasets[0].data.push(Number(temp));
        if (this.tempChart.data.labels.length > n) {
          this.tempChart.data.labels.shift();
          this.tempChart.data.datasets[0].data.shift();
        }
        this.tempChart.update('none');
      }
      if (this.vibChart) {
        this.vibChart.data.labels.push(label);
        this.vibChart.data.datasets[0].data.push(Number(vib));
        this.vibChart.data.datasets[1].data.push(this.thresholds.vibration.healthyMax);
        this.vibChart.data.datasets[2].data.push(this.thresholds.vibration.warningMax);
        if (this.vibChart.data.labels.length > n) {
          this.vibChart.data.labels.shift();
          this.vibChart.data.datasets[0].data.shift();
          this.vibChart.data.datasets[1].data.shift();
          this.vibChart.data.datasets[2].data.shift();
        }
        this.vibChart.update('none');
      }
    },

    /** Re-apply theme colours after a dark/light toggle. */
    refreshTheme() {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      this._colors(dark);
      const tickColor = dark ? '#BDBDBD' : '#757575';
      const gridColor = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

      [this.tempChart, this.vibChart].forEach((c) => {
        if (!c) return;
        c.options.scales.x.ticks.color = tickColor;
        c.options.scales.y.ticks.color = tickColor;
        c.options.scales.y.grid.color = gridColor;
        // Refresh line colours without a full rebuild.
        if (this.tempChart && c === this.tempChart) c.data.datasets[0].borderColor = elCache.tempColor;
        if (this.vibChart && c === this.vibChart) c.data.datasets[0].borderColor = elCache.vibColor;
        c.update('none');
      });
    },
  };

  App.Charts = Charts;
})();
```

### public/js/websocket.js

```js
/**
 * js/websocket.js — live data channel
 * ------------------------------------------------------------------
 * 1. Opens a WebSocket to /ws (same host, upgrades automatically).
 * 2. Keeps a heartbeat (ping) so the connection stays alive.
 * 3. Auto-reconnects with exponential backoff when it drops.
 * 4. Dispatches incoming messages to dashboard.js via callbacks.
 *
 * Also exposes REST-based "polling fallback" — if WebSocket isn't
 * available, the dashboard can switch to 2s HTTP polling.
 */
(function () {
  window.App = window.App || {};

  const DEFAULT_HOST = ''; // empty = same origin
  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let pollingTimer = null;
  let usePolling = false;

  const Websocket = {
    listeners: {},  // { type: [handlerFn] }
    status: 'connecting',

    // ---- subscriptions ---------------------------------------------------
    on(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },

    _emit(type, payload) {
      (this.listeners[type] || []).forEach((fn) => fn(payload));
    },

    /** Are we currently connected? */
    isConnected() {
      return !!ws && ws.readyState === WebSocket.OPEN;
    },

    getTransport() {
      return usePolling ? 'polling' : 'websocket';
    },

    // ---- bootstrapping ---------------------------------------------------
    connect({ onStatusChange } = {}) {
      this.onStatusChange = onStatusChange;
      this._updateStatus('connecting');

      try {
        usePolling = typeof WebSocket === 'undefined';
      } catch (e) {
        usePolling = true;
      }

      if (usePolling) {
        this._startPolling();
        return;
      }

      const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const url = `${protocol}${location.host}/ws`;

      try {
        ws = new WebSocket(url);
      } catch (e) {
        console.error('[WS] Construction failed:', e.message);
        this._scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        console.log('[WS] Connected to', url);
        reconnectAttempts = 0;
        this._updateStatus('connected');
        this._startHeartbeat();
        // Ask the server to re-broadcast the latest reading so a freshly
        // opened dashboard instantly sees current values.
        this.send({ type: 'get_state' });
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          return; // ignore non-JSON
        }
        if (msg.type === 'pong') return; // heartbeat ack, no UI impact

        // Forward sensor_update / alert / connection_status / device_info
        if (msg.type && this.listeners[msg.type]) {
          this._emit(msg.type, msg);
        } else if (msg.type) {
          this._emit('*', msg);
        }
      };

      ws.onclose = () => {
        console.warn('[WS] Connection closed');
        this._updateStatus('disconnected');
        this._stopHeartbeat();
        ws = null;
        this._scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will follow and trigger the reconnect logic.
      };
    },

    /** Send a JSON message (safe when connection is down). */
    send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    },

    // ---- heartbeat --------------------------------------------------------
    _startHeartbeat() {
      this._stopHeartbeat();
      // Ping the server every 25s; the server's pong keeps the socket alive
      // and lets the backend detect a dead browser tab.
      heartbeatTimer = setInterval(() => this.send({ type: 'ping' }), 25000);
    },

    _stopHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    },

    // ---- reconnect with backoff ------------------------------------------
    _scheduleReconnect() {
      if (reconnectTimer) return;
      const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
      reconnectAttempts += 1;
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        this.connect({ onStatusChange: this.onStatusChange });
      }, delay);
    },

    // ---- polling fallback -------------------------------------------------
    /** Poll latest state every 2s using REST instead of WS. */
    _startPolling() {
      this._stopPolling();
      this._updateStatus('connected', 'polling');
      pollingTimer = setInterval(async () => {
        try {
          const deviceId = App.Storage.loadSettings().deviceId;
          const latest = (await App.API.getLatest(deviceId)).data;
          if (latest) {
            this._emit('sensor_update', {
              type: 'sensor_update',
              deviceId,
              data: latest,
            });
          }
          this._updateStatus('connected', 'polling');
        } catch (e) {
          this._updateStatus('disconnected', 'polling');
        }
      }, 2000);
    },

    _stopPolling() {
      if (pollingTimer) clearInterval(pollingTimer);
      pollingTimer = null;
    },

    _updateStatus(newStatus, via) {
      this.status = newStatus;
      if (this.onStatusChange) this.onStatusChange(newStatus, via || (usePolling ? 'polling' : 'websocket'));
    },

    /** Manual stop/resume of the live stream (from the control button). */
    dispose() {
      this._stopHeartbeat();
      this._stopPolling();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
      this._updateStatus('disconnected');
    },
  };

  App.Websocket = Websocket;
})();
```

### public/js/dashboard.js

```js
/**
 * js/dashboard.js — main application logic (performance-tuned)
 * ------------------------------------------------------------------
 * Optimisations applied for a snappy 60 FPS dashboard:
 *
 *   1. DOM element lookup cache      → one querySelector per element,
 *                                      never re-queried in the 2s loop.
 *   2. Write-only-on-change updates  → text nodes are only touched when
 *                                      their value actually changes.
 *   3. rAF-coalesced chart flushes   → sensor bursts and the initial
 *                                      history load share ONE canvas
 *                                      redraw per animation frame.
 *   4. Duplicate-point suppression   → the WS "latest" echo and the
 *                                      history fetch can't double-plot.
 *   5. Single 1 s tick loop          → clock / uptime / watchdog / rate
 *                                      share one interval.
 */
(function () {
  const U = App.Utils;
  const Storage = App.Storage;
  const API = App.API;
  const Charts = App.Charts;
  const WS = App.Websocket;

  const S = Storage.session;

  // ---- Global state ------------------------------------------------------
  const state = {
    lastSensorMs: 0,
    streamActive: true,
    simulating: false,
    simulateTimer: null,
    deviceOnline: false,
    lastPointTs: null,     // de-dupe key for live + history points
  };

  // ---- Thresholds (mirror backend `.env`) --------------------------------
  const THRESHOLDS = {
    temperature: { healthyMax: 45, warningMax: 60 },
    vibration: { healthyMax: 300, warningMax: 600 },
  };

  // ========================================================================
  // DOM CACHE — resolve every element ONCE at boot.
  // ========================================================================
  let el;
  function cacheDom() {
    el = {};
    const $ = U.$;
    (['tempCard', 'tempValue', 'tempMin', 'tempMax', 'tempStatus',
      'vibCard', 'vibValue', 'vibBar', 'vibLevel', 'vibAvg', 'vibStatus',
      'conditionBadge', 'conditionIcon', 'conditionText', 'conditionMessage',
      'espConnection', 'lastUpdated', 'dataPoint',
      'wsPill', 'apiPill', 'ratePill', 'signalPill',
      'alertList', 'alertsEmpty', 'clearAlertsBtn',
      'infoName', 'infoId', 'infoIp', 'infoMac', 'infoFw', 'infoSignal',
      'infoUptime', 'infoPoints', 'infoConn',
      'refreshBtn', 'streamToggleBtn', 'exportBtn', 'settingsBtn',
      'darkModeBtn', 'simulateBtn',
      'footerClock', 'globalStatus', 'globalStatusText',
      'settingsModal', 'closeSettingsBtn', 'saveSettingsBtn',
      'setDeviceId', 'setWindowMinutes', 'setMaxPoints', 'setDarkMode',
      'toastHost']).forEach((id) => { el[id] = $('#' + id); });
  }

  /** Set textContent only when the value changed (avoids layout/repaint). */
  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  // ========================================================================
  // INIT
  // ========================================================================
  function init() {
    cacheDom();
    applyTheme(Storage.getTheme());

    const settings = Storage.loadSettings();
    el.setDeviceId.value = settings.deviceId;
    el.setWindowMinutes.value = settings.windowMinutes;
    el.setMaxPoints.value = settings.maxPoints;
    el.setDarkMode.checked = settings.darkMode;

    state.streamActive = Storage.isStreamActive();
    syncStreamButton();

    // Charts init (theme resolved exactly once here).
    Charts.init({ maxPoints: settings.maxPoints, isDark: Storage.getTheme() === 'dark', thresholds: THRESHOLDS });

    // Wire WebSocket events.
    WS.on('sensor_update', onSensorUpdate);
    WS.on('alert', onAlert);
    WS.on('connection_status', onConnectionStatus);
    WS.on('device_info', onDeviceInfo);
    WS.connect({ onStatusChange: onWsStatus });

    // Initial data: history + device metadata.
    loadHistory();
    loadDeviceInfo(settings.deviceId);

    bindControls();

    // ONE tick loop for all periodic UI work.
    setInterval(tick, 1000);
  }

  // ========================================================================
  // CHART FLUSH — coalesce redraws to one per animation frame
  // ========================================================================
  let chartDirty = false;
  let rafId = 0;
  function scheduleChartFlush() {
    if (chartDirty) return;               // already a redraw queued this frame
    chartDirty = true;
    rafId = requestAnimationFrame(() => {
      chartDirty = false;
      Charts.render(S.buffer);            // one O(n) redraw per frame max
    });
  }

  // ========================================================================
  // BUFFER — single source of truth for chart data
  // ========================================================================
  function pushPoint(timestamp, temp, vib) {
    if (!timestamp) return;
    const ts = timestamp;
    // De-dupe: history rows and the WS "latest" echo may carry identical ts.
    if (ts === state.lastPointTs) return;
    state.lastPointTs = ts;

    const S2 = S.buffer;
    S2.labels.push(ts);
    S2.temps.push(Number(temp));
    S2.vibs.push(Number(vib));

    const max = Storage.loadSettings().maxPoints;
    if (S2.labels.length > max) {
      S2.labels.shift();
      S2.temps.shift();
      S2.vibs.shift();
    }
    scheduleChartFlush();
  }

  function recordSessionStats(temp, vib) {
    S.minTemp = S.minTemp === null ? temp : Math.min(S.minTemp, temp);
    S.maxTemp = S.maxTemp === null ? temp : Math.max(S.maxTemp, temp);
    S.vibSum = (S.vibSum || 0) + vib;
    S.readingCount = (S.readingCount || 0) + 1;
    // rolling 60 s window for readings/minute
    S.eventTimestamps.push(Date.now());
    if (S.eventTimestamps.length > 200) S.eventTimestamps.shift();
  }

  // ========================================================================
  // HTTP LOADERS
  // ========================================================================
  async function loadHistory() {
    const settings = Storage.loadSettings();
    try {
      const result = await API.getHistory(settings.deviceId, settings.windowMinutes, settings.maxPoints);
      const rows = result.data || [];
      if (!rows.length) {
        toast('No data yet — waiting for sensor updates (or use Simulate ESP32).', 'warning');
        return;
      }
      // Bulk ingest is cheap (single push loop), charts flushed on last rAF.
      rows.forEach((r) => {
        pushPoint(r.timestamp, r.temperature, r.vibration);
        recordSessionStats(Number(r.temperature), Number(r.vibration));
      });
      scheduleChartFlush();
      toast('Loaded ' + rows.length + ' historical readings', 'success');
    } catch (err) {
      console.error('[DASHBOARD] History load failed:', err.message);
    }
  }

  async function loadDeviceInfo(deviceId) {
    try {
      const res = await API.getDevice(deviceId);
      const d = res.data || {};
      renderDeviceInfo({
        deviceName: d.deviceName || 'Motor Bot #01',
        deviceId: d.deviceId,
        ipAddress: d.ipAddress,
        macAddress: d.macAddress,
        firmwareVersion: d.firmwareVersion,
        dataPointNumber: S.readingCount,
      });
      if (d.currentStatus) {
        state.deviceOnline = d.currentStatus === 'ONLINE';
        updateEspConnection(state.deviceOnline);
      }
    } catch (err) {
      console.log('[DASHBOARD] Device info unavailable:', err.message);
    }
  }

  // ========================================================================
  // WS EVENT HANDLERS
  // ========================================================================
  function onSensorUpdate(msg) {
    const d = msg.data || {};
    const temp = Number(d.temperature);
    const vib = Number(d.vibration);

    if (state.streamActive && !isNaN(temp) && !isNaN(vib) && temp !== undefined && vib !== undefined) {
      const ts = new Date(d.timestamp || Date.now()).toISOString();
      pushPoint(ts, temp, vib);
      const condition = d.motorCondition || U.determineCondition(temp, vib, THRESHOLDS);
      updateMetrics(temp, vib, condition);
      recordSessionStats(temp, vib);

      S.lastCondition = condition;
      state.lastSensorMs = Date.now();
      state.deviceOnline = true;
    } else if (!isNaN(temp) && temp !== undefined) {
      // Paused or pure status echo — keep the heartbeat alive.
      state.lastSensorMs = Date.now();
    }

    setLastUpdated(d.timestamp);
    if (d.espSignalStrength !== undefined && d.espSignalStrength !== null) updateSignal(d.espSignalStrength);
    if (d.dataPointNumber !== undefined) setText(el.dataPoint, U.num(d.dataPointNumber));
  }

  function onAlert(msg) {
    el.alertsEmpty?.remove();
    const high = msg.severity === 'high';
    const item = document.createElement('div');
    item.className = 'alert-item ' + (high ? 'alert-fault' : 'alert-warning');
    item.innerHTML = `
      <div class="alert-icon">${high ? '🔴' : '🟠'}</div>
      <div class="alert-content">
        <div class="alert-type">${high ? 'FAULT' : 'WARNING'}</div>
        <div class="alert-message"></div>
        <div class="alert-timestamp"></div>
      </div>
      <button class="alert-close" title="Dismiss">✕</button>`;
    item.querySelector('.alert-message').textContent = msg.message || 'Sensor reading outside safe range';
    item.querySelector('.alert-timestamp').textContent = U.formatTime(msg.timestamp || Date.now());
    item.querySelector('.alert-close').addEventListener('click', () => item.remove());
    el.alertList.prepend(item);
    if (high) toast('🔴 ' + (msg.message || 'Fault condition'), 'error');
  }

  function onConnectionStatus(msg) {
    if (msg.status === 'offline') {
      state.deviceOnline = false;
      updateEspConnection(false);
      toast('ESP32 went OFFLINE', 'error');
    } else if (msg.status === 'online' || msg.status === 'connected') {
      state.deviceOnline = true;
      updateEspConnection(true);
    }
  }

  function onDeviceInfo(msg) { renderDeviceInfo(msg.data); }

  function onWsStatus(status, via) {
    if (status === 'connected') {
      el.globalStatus.className = 'status-pill status-online';
      setText(el.globalStatusText, via === 'polling' ? 'SERVER ONLINE (REST)' : 'SERVER ONLINE (WS)');
      setText(el.wsPill, '🟢 ONLINE');
    } else {
      el.globalStatus.className = 'status-pill status-offline';
      setText(el.globalStatusText, 'SERVER OFFLINE');
      setText(el.wsPill, '🔴 OFFLINE');
    }
  }

  // ========================================================================
  // METRICS RENDERING (only touches changed DOM)
  // ========================================================================
  function updateMetrics(temp, vib, condition) {
    // --- Temperature ------------------------------------------------
    const tVal = temp.toFixed(1) + '°';
    setText(el.tempValue, tVal);
    setCardStatus(el.tempCard, tempStatusOf(temp), el.tempStatus, tempLabelOf(temp));
    setText(el.tempMin, S.minTemp === null ? '--' : S.minTemp.toFixed(1));
    setText(el.tempMax, S.maxTemp === null ? '--' : S.maxTemp.toFixed(1));

    // --- Vibration --------------------------------------------------
    const vVal = Math.round(vib);
    setText(el.vibValue, vVal);
    const pct = U.clamp(vib / 1023 * 100, 0, 100);
    if (el.vibBar.style.width !== pct + '%') el.vibBar.style.width = pct + '%';
    setText(el.vibLevel, U.vibrationLevel(vib, THRESHOLDS));
    setText(el.vibAvg, S.readingCount ? Math.round(S.vibSum / S.readingCount) : '--');
    setCardStatus(el.vibCard, vibStatusOf(vib), el.vibStatus, vibLabelOf(vib));

    // --- Condition badge --------------------------------------------
    const cls = 'condition-badge condition-' + U.statusClass(condition);
    if (el.conditionBadge.className !== cls) {
      el.conditionBadge.className = cls;
      el.conditionBadge.querySelector('.condition-icon').textContent = U.conditionEmoji(condition);
    }
    setText(el.conditionText, condition);
    setText(el.conditionMessage, U.conditionMessage(condition));
  }

  function tempStatusOf(v) { return v > THRESHOLDS.temperature.warningMax ? 'fault' : v > THRESHOLDS.temperature.healthyMax ? 'warning' : 'healthy'; }
  function vibStatusOf(v)  { return v > THRESHOLDS.vibration.warningMax ? 'fault' : v > THRESHOLDS.vibration.healthyMax ? 'warning' : 'healthy'; }

  function tempLabelOf(v) {
    if (v > THRESHOLDS.temperature.warningMax) return '🔴 FAULT — Excessive heat';
    if (v > THRESHOLDS.temperature.healthyMax) return '🟠 WARNING — Elevated';
    return '🟢 HEALTHY — Within range';
  }

  function vibLabelOf(v) {
    if (v > THRESHOLDS.vibration.warningMax) return '🔴 FAULT — High vibration';
    if (v > THRESHOLDS.vibration.healthyMax) return '🟠 WARNING — Elevated';
    return '🟢 HEALTHY — Within range';
  }

  function setCardStatus(card, cls, statusNode, label) {
    card.classList.remove('status-healthy', 'status-warning', 'status-fault');
    card.classList.add('status-' + cls);
    statusNode.className = 'metric-status status-' + cls;
    setText(statusNode, label);
  }

  function updateEspConnection(online) {
    if (online) {
      if (el.espConnection.getAttribute('data-on') !== '1') {
        el.espConnection.innerHTML = '<span class="dot dot-green pinging"></span> ONLINE';
        el.espConnection.setAttribute('data-on', '1');
      }
    } else {
      if (el.espConnection.getAttribute('data-on') !== '0') {
        el.espConnection.innerHTML = '<span class="dot dot-red"></span> OFFLINE';
        el.espConnection.setAttribute('data-on', '0');
      }
    }
    setText(el.infoConn, online ? '🟢 ONLINE' : '🔴 OFFLINE');
  }

  function setLastUpdated(ts) {
    setText(el.lastUpdated, U.formatTime(ts));
    el.lastUpdated.classList.remove('waiting');
  }

  function updateSignal(rssi) {
    if (rssi === undefined || rssi === null || isNaN(rssi)) return;
    S.lastSignal = rssi;
    setText(el.signalPill, rssi + ' dBm');
    setText(el.infoSignal, rssi + ' dBm');
  }

  // ---- One shared tick: clock, uptime, watchdog, rate --------------------
  function tick() {
    S.uptimeSeconds = (S.uptimeSeconds || 0) + 1;
    setText(el.infoUptime, U.formatUptime(S.uptimeSeconds));
    setText(el.footerClock, new Date().toTimeString().slice(0, 8));

    // ESP32 OFFLINE watchdog (>30s silence)
    const offlineMs = state.lastSensorMs ? Date.now() - state.lastSensorMs : Infinity;
    if (offlineMs > 30000) {
      if (state.deviceOnline) { state.deviceOnline = false; updateEspConnection(false); }
      if (!el.lastUpdated.classList.contains('waiting')) el.lastUpdated.classList.add('waiting');
    }

    // readings/minute (rolling 60 s)
    if (S.eventTimestamps.length) {
      const now = Date.now();
      while (S.eventTimestamps.length && now - S.eventTimestamps[0] > 60000) S.eventTimestamps.shift();
      setText(el.ratePill, S.eventTimestamps.length + ' /min');
    }
  }

  // ========================================================================
  // CONTROLS
  // ========================================================================
  function bindControls() {
    el.refreshBtn.addEventListener('click', async () => {
      setText(el.refreshBtn, '⟳ Loading…');
      el.refreshBtn.disabled = true;
      try {
        const settings = Storage.loadSettings();
        const hist = await API.getHistory(settings.deviceId, settings.windowMinutes, settings.maxPoints);
        S.buffer = { labels: [], temps: [], vibs: [] };
        state.lastPointTs = null;
        (hist.data || []).forEach((r) => {
          pushPoint(r.timestamp, r.temperature, r.vibration);
          recordSessionStats(Number(r.temperature), Number(r.vibration));
        });
        scheduleChartFlush();
        toast('Refreshed — loaded ' + (hist.data || []).length + ' points', 'success');
      } catch (err) {
        toast('Refresh failed: ' + err.message, 'error');
      } finally {
        setText(el.refreshBtn, '🔄 Refresh Now');
        el.refreshBtn.disabled = false;
      }
    });

    el.streamToggleBtn.addEventListener('click', toggleStream);

    el.exportBtn.addEventListener('click', exportData);

    el.settingsBtn.addEventListener('click', () => el.settingsModal.classList.remove('hidden'));
    el.closeSettingsBtn.addEventListener('click', () => el.settingsModal.classList.add('hidden'));
    el.settingsModal.addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') el.settingsModal.classList.add('hidden');
    });
    el.saveSettingsBtn.addEventListener('click', saveSettings);

    el.darkModeBtn.addEventListener('click', () => {
      applyTheme(Storage.getTheme() === 'dark' ? 'light' : 'dark');
    });

    el.simulateBtn.addEventListener('click', toggleSimulator);

    el.clearAlertsBtn.addEventListener('click', () => {
      el.alertList.innerHTML = '<div class="empty-state" id="alertsEmpty">No active alerts 🎉</div>';
      toast('Alerts cleared', 'success');
    });
  }

  function toggleStream() {
    state.streamActive = !state.streamActive;
    Storage.setStreamActive(state.streamActive);
    syncStreamButton();
    toast(state.streamActive ? 'Data stream resumed' : 'Data stream paused',
      state.streamActive ? 'success' : 'warning');
    if (state.streamActive && !WS.isConnected()) WS.connect({ onStatusChange: onWsStatus });
  }

  function syncStreamButton() {
    setText(el.streamToggleBtn, state.streamActive ? '⏹ Stop Data Stream' : '▶ Resume Data Stream');
  }

  async function exportData() {
    const settings = Storage.loadSettings();
    try {
      const r = await API.exportCsv(
        settings.deviceId,
        new Date(Date.now() - settings.windowMinutes * 60000).toISOString(),
        new Date().toISOString()
      );
      toast(`Exported ${r.rows} rows to CSV`, 'success');
    } catch (err) {
      toast('Export failed: ' + err.message, 'error');
    }
  }

  function saveSettings() {
    const settings = {
      deviceId: el.setDeviceId.value.trim() || 'MOTOR_BOT_01',
      windowMinutes: parseInt(el.setWindowMinutes.value, 10) || 30,
      maxPoints: parseInt(el.setMaxPoints.value, 10) || 100,
      darkMode: el.setDarkMode.checked,
    };
    Storage.saveSettings(settings);
    applyTheme(settings.darkMode ? 'dark' : 'light');

    // Rebuild charts with new sizing + clear stale data.
    Charts.init({ maxPoints: settings.maxPoints, isDark: settings.darkMode, thresholds: THRESHOLDS });
    S.buffer = { labels: [], temps: [], vibs: [] };
    state.lastPointTs = null;
    loadHistory();

    el.settingsModal.classList.add('hidden');
    toast('Settings saved', 'success');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Storage.setTheme(theme);
    setText(el.darkModeBtn, theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode');
    el.setDarkMode.checked = theme === 'dark';
    Charts.refreshTheme();
  }

  // ========================================================================
  // SIMULATED ESP32 (posts to the real backend, same 2s cadence)
  // ========================================================================
  let simTemp = 38;
  let simVib = 160;
  function toggleSimulator() {
    state.simulating = !state.simulating;
    if (state.simulating) {
      setText(el.simulateBtn, '⏹ Stop Simulator');
      el.simulateBtn.classList.add('is-danger');
      toast('Simulated ESP32 started (posts every 2s)', 'warning');
      simTemp = 38;
      simVib = 160;
      state.simulateTimer = setInterval(async () => {
        simTemp = U.clamp(simTemp + (Math.random() * 4 - 1.8), 30, 78);
        simVib = U.clamp(simVib + (Math.random() * 60 - 28), 60, 900);
        try {
          await API.postSensorData({
            deviceId: Storage.loadSettings().deviceId,
            temperature: Math.round(simTemp * 10) / 10,
            vibration: Math.round(simVib),
            espSignalStrength: -45 + Math.round(Math.random() * 8 - 4),
            firmwareVersion: 'v1.0',
            deviceName: 'Motor Bot #01',
          });
        } catch (err) {
          console.error('[SIM] POST failed:', err.message);
        }
      }, 2000);
    } else {
      setText(el.simulateBtn, '🧪 Simulate ESP32');
      el.simulateBtn.classList.remove('is-danger');
      clearInterval(state.simulateTimer);
      toast('Simulator stopped', 'info');
    }
  }

  // ========================================================================
  // DEVICE INFO PANEL + TOASTS
  // ========================================================================
  function renderDeviceInfo(data) {
    if (!data) return;
    if (data.deviceName) setText(el.infoName, data.deviceName);
    if (data.deviceId) setText(el.infoId, data.deviceId);
    if (data.ipAddress) setText(el.infoIp, data.ipAddress);
    if (data.macAddress) setText(el.infoMac, data.macAddress);
    if (data.firmwareVersion) setText(el.infoFw, data.firmwareVersion);
    if (data.espSignalStrength !== undefined && data.espSignalStrength !== null)
      setText(el.infoSignal, data.espSignalStrength + ' dBm');
    if (data.dataPointNumber !== undefined) setText(el.infoPoints, U.num(data.dataPointNumber));
  }

  let lastToast = null;
  function toast(msg, type = 'info') {
    lastToast?.remove();
    lastToast = document.createElement('div');
    lastToast.className = 'toast toast-' + type;
    lastToast.textContent = msg;
    el.toastHost.appendChild(lastToast);
    setTimeout(() => {
      lastToast?.classList.add('out');
      setTimeout(() => lastToast?.remove(), 350);
    }, 3200);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

### public/css/styles.css

```css
/* ==================================================================
   styles.css — Motor Inspection Bot Dashboard
   ----------------------------------------------------------------
   Theming is driven by CSS custom properties declared on :root
   (light theme) and overridden by `[data-theme="dark"]` in
   dark-mode.css.  Keeping every colour/token here makes the design
   easy to re-skin for the viva.
   ================================================================== */

/* ---- 1. THEME TOKENS (light) ---------------------------------- */
:root {
  /* Status colours */
  --color-healthy: #00C853;
  --color-warning: #FFA726;
  --color-fault:   #E53935;

  /* Surfaces & text */
  --bg:            #FAFAFA;
  --surface:       #FFFFFF;
  --surface-2:     #F2F2F2;
  --border:        #E0E0E0;
  --text:          #212121;
  --text-muted:    #757575;
  --shadow:        0 2px 4px rgba(0, 0, 0, 0.1);
  --shadow-lg:     0 8px 24px rgba(0, 0, 0, 0.14);

  /* Graph palettes */
  --graph-temp:    #1976D2;
  --graph-vib:     #7CB342;
  --graph-warn:    #FFA726;
  --graph-fault:   #E53935;

  /* Accent */
  --accent:        #1565C0;

  /* Typography */
  --font-ui: 'Roboto', system-ui, sans-serif;
  --font-mono: 'Roboto Mono', ui-monospace, monospace;

  /* Radii & spacing */
  --radius: 8px;
  --radius-sm: 4px;
  --pad: 16px;
}

/* ---- 2. RESET / BASE ------------------------------------------- */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { -webkit-text-size-adjust: 100%; }

body {
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: 1.5;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  transition: background 0.3s ease, color 0.3s ease;
}

button { font-family: inherit; cursor: pointer; }

.mono { font-family: var(--font-mono); }

/* ---- 3. LAYOUT --------------------------------------------------- */
.app-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  box-shadow: var(--shadow);
  position: sticky;
  top: 0;
  z-index: 20;
}

.header-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 14px var(--pad);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.app-title { font-size: 24px; font-weight: 700; letter-spacing: 0.4px; }
.app-subtitle { font-size: 13px; color: var(--text-muted); margin-top: 2px; }

.dashboard-grid {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--pad);
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: var(--pad);
}

.col-main  { display: flex; flex-direction: column; gap: var(--pad); min-width: 0; }
.col-side  { display: flex; flex-direction: column; gap: var(--pad); min-width: 0; }

.row { display: grid; gap: var(--pad); }
.metrics-row { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.charts-row  { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }

.app-footer {
  max-width: 1440px;
  margin: 8px auto 24px;
  padding: 0 var(--pad);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: 13px;
}

/* ---- 4. CARDS ---------------------------------------------------- */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: var(--pad);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

.card:hover { box-shadow: var(--shadow-lg); }

/* ---- 5. STATUS PILL (header / connection) ----------------------- */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  white-space: nowrap;
}

.dot {
  width: 9px; height: 9px;
  border-radius: 50%;
  background: var(--text-muted);
  display: inline-block;
}

.dot-green  { background: var(--color-healthy); box-shadow: 0 0 6px var(--color-healthy); }
.dot-orange { background: var(--color-warning); box-shadow: 0 0 6px var(--color-warning); }
.dot-red    { background: var(--color-fault);   box-shadow: 0 0 6px var(--color-fault);   }

.status-pill.status-online  { border-color: var(--color-healthy); color: #1b5e20; }
.status-pill.status-offline { border-color: var(--color-fault);   color: #b71c1c; }

/* ---- 6. METRIC CARDS --------------------------------------------- */
.metric-card { position: relative; display: flex; flex-direction: column; gap: 6px; }

.metric-label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.metric-value {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 44px;
  line-height: 1.1;
  word-break: break-word;
}

.metric-unit { font-size: 12px; color: var(--text-muted); margin-top: -4px; }

/* Status-dependent colouring (applied by JS via class names) */
.metric-card.status-healthy .metric-value { color: var(--color-healthy); }
.metric-card.status-warning .metric-value { color: var(--color-warning); }
.metric-card.status-fault   .metric-value { color: var(--color-fault);   }

.metric-range {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.metric-range b { color: var(--text); font-family: var(--font-mono); }

.metric-status {
  margin-top: 2px;
  font-size: 13px;
  font-weight: 500;
  align-self: flex-start;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.metric-status.status-healthy { color: var(--color-healthy); }
.metric-status.status-warning { color: var(--color-warning); }
.metric-status.status-fault   { color: var(--color-fault);   }

/* Vibration level bar */
.vib-bar {
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--color-healthy) 0%, var(--color-warning) 29%, var(--color-fault) 59%);
  overflow: hidden;
}

.vib-bar-fill {
  height: 100%;
  width: 0%;
  background: #37474f;
  opacity: 0.55;
  transition: width 0.35s ease;
}

.vib-scale {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* ---- 7. CONDITION BADGE ------------------------------------------ */
.condition-card { flex: 1; }

.condition-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 10px;
  border-radius: var(--radius);
  border: 2px solid transparent;
  margin: 8px 0;
  transition: all 0.3s ease;
}

.condition-icon { font-size: 38px; line-height: 1; }

.condition-text {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 26px;
  letter-spacing: 2px;
}

/* Condition state styles */
.condition-badge.condition-healthy {
  border-color: var(--color-healthy);
  background: rgba(0, 200, 83, 0.08);
  color: var(--color-healthy);
}
.condition-badge.condition-warning {
  border-color: var(--color-warning);
  background: rgba(255, 167, 38, 0.10);
  color: var(--color-warning);
}
.condition-badge.condition-fault {
  border-color: var(--color-fault);
  background: rgba(229, 57, 53, 0.10);
  color: var(--color-fault);
}

.condition-message {
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
  min-height: 19px;
}

/* Device network rows inside condition card */
.device-net { border-top: 1px dashed var(--border); margin-top: 10px; padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }

.net-row { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
.net-row > span:first-child { color: var(--text-muted); }
.net-value { font-weight: 500; }
.net-value.mono { font-family: var(--font-mono); font-size: 12.5px; }

/* ---- 8. CHARTS ---------------------------------------------------- */
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.chart-title { font-size: 15px; font-weight: 600; }
.chart-hint  { font-size: 12px; font-weight: 400; color: var(--text-muted); }

.legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11.5px; color: var(--text-muted); }
.legend-item { display: inline-flex; align-items: center; gap: 5px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.swatch-temp  { background: var(--graph-temp); }
.swatch-vib   { background: var(--graph-vib); }
.swatch-warn  { background: var(--graph-warn); }
.swatch-fault { background: var(--graph-fault); }

.chart-wrap { position: relative; height: 240px; }

/* ---- 9. SIDE PANEL ------------------------------------------------ */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.panel-title { font-size: 15px; font-weight: 600; }

.alert-list {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state { color: var(--text-muted); font-size: 13.5px; text-align: center; padding: 14px 0; }

/* Alert items */
.alert-item {
  border-radius: var(--radius);
  padding: 10px 12px;
  border-left: 4px solid var(--color-fault);
  background: var(--surface-2);
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: 8px;
  align-items: start;
  animation: slideIn 0.25s ease;
}

.alert-item.alert-warning { border-left-color: var(--color-warning); }

.alert-icon { font-size: 18px; line-height: 1.3; }

.alert-type { font-weight: 700; font-size: 12.5px; letter-spacing: 0.8px; }
.alert-item.alert-warning .alert-type { color: var(--color-warning); }
.alert-item.alert-fault   .alert-type { color: var(--color-fault); }

.alert-message { font-size: 13px; color: var(--text); margin-top: 2px; }
.alert-timestamp { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top: 4px; }

.alert-close {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  padding: 2px 4px;
}
.alert-close:hover { color: var(--text); }

/* Info rows */
.info-list { display: flex; flex-direction: column; gap: 7px; }
.info-row { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
.info-label { color: var(--text-muted); }
.info-value { font-weight: 500; text-align: right; word-break: break-word; }
.info-value.mono { font-family: var(--font-mono); }

/* Controls */
.controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.btn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  font-size: 13.5px;
  font-weight: 500;
  transition: all 0.15s ease;
  text-align: center;
}
.btn:hover { background: var(--border); box-shadow: var(--shadow); }
.btn:active { transform: translateY(1px); }

.btn.is-danger { color: var(--color-fault); border-color: rgba(229, 57, 53, 0.4); }
.btn.is-danger:hover { background: rgba(229, 57, 53, 0.08); }

.btn.is-accent { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.is-accent:hover { filter: brightness(1.1); background: var(--accent); }

.btn.btn-link { background: transparent; border: none; color: var(--accent); padding: 4px 6px; font-size: 13px; }
.btn-sm { font-size: 12.5px; }

.help-text { margin-top: 10px; font-size: 12.5px; color: var(--text-muted); line-height: 1.5; }

/* ---- 10. MODAL ------------------------------------------------------ */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}

.modal {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 440px;
  padding: 20px;
}

.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.modal-header h3 { font-size: 17px; }

.btn-icon {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  width: 30px; height: 30px;
  color: var(--text);
  font-size: 13px;
}
.btn-icon:hover { background: var(--border); }

.modal-body { display: flex; flex-direction: column; gap: 14px; }

.field { display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
.field input[type="text"], .field input[type="number"] {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--font-mono);
}
.field input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }

.toggle-field { flex-direction: row; align-items: center; justify-content: space-between; }
.toggle-field input { width: 20px; height: 20px; accent-color: var(--accent); }

.modal-footer { margin-top: 18px; display: flex; justify-content: flex-end; }

.hidden { display: none !important; }

/* ---- 11. TOASTS ----------------------------------------------------- */
.toast-host {
  position: fixed;
  bottom: 18px;
  right: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 120;
  max-width: 340px;
}

.toast {
  background: #323232;
  color: #fff;
  padding: 12px 16px;
  border-radius: var(--radius);
  font-size: 13.5px;
  box-shadow: var(--shadow-lg);
  animation: slideIn 0.25s ease;
  border-left: 4px solid var(--accent);
}

.toast.toast-success { border-left-color: var(--color-healthy); }
.toast.toast-warning { border-left-color: var(--color-warning); }
.toast.toast-error   { border-left-color: var(--color-fault); }

.toast.out { opacity: 0; transform: translateY(8px); transition: all 0.3s ease; }
```

### public/css/responsive.css

```css
/* ==================================================================
   responsive.css — mobile / tablet / desktop breakpoints
   ----------------------------------------------------------------
   Strategy: single-column by default, expanding to two columns on
   tablet and the full side-panel layout on desktop.
   ================================================================== */

/* ---- Tablet & up (>= 768px):       two columns ------------------- */
@media (min-width: 768px) {
  .dashboard-grid {
    grid-template-columns: 1fr 340px;
  }

  .metrics-row { grid-template-columns: repeat(2, 1fr); }
  .charts-row  { grid-template-columns: 1fr; }
}

/* ---- Desktop (>= 1024px):          full layout ------------------- */
@media (min-width: 1024px) {
  .dashboard-grid { grid-template-columns: 1fr 360px; }
  .metrics-row    { grid-template-columns: repeat(4, 1fr); }
  .charts-row     { grid-template-columns: repeat(2, 1fr); }
  .app-title      { font-size: 26px; }
}

/* ---- Mobile (< 768px):             stacked, touch-friendly ------- */
@media (max-width: 767px) {
  body { font-size: 14px; }

  .header-inner { padding: 12px; }
  .app-title    { font-size: 18px; }
  .app-subtitle { font-size: 12px; }

  .dashboard-grid { padding: 12px; grid-template-columns: 1fr; gap: 12px; }
  .col-side, .col-main { gap: 12px; }

  .metrics-row { grid-template-columns: 1fr 1fr; }
  .condition-card, .connection-card { grid-column: 1 / -1; }

  .metric-value { font-size: 32px; }
  .chart-wrap   { height: 200px; }

  /* Touch-target minimums for buttons */
  .btn { min-height: 44px; font-size: 14px; }
  .controls-grid { grid-template-columns: 1fr; }

  .alert-list { max-height: 220px; }

  .app-footer { justify-content: center; text-align: center; }
}

/* ---- Very small phones (< 480px):  single column metrics ---------- */
@media (max-width: 479px) {
  .metrics-row { grid-template-columns: 1fr; }

  .chart-header { flex-direction: column; }
  .legend { gap: 8px; }

  .metric-value { font-size: 40px; }
}
```

### public/css/dark-mode.css

```css
/* ==================================================================
   dark-mode.css — dark theme
   ----------------------------------------------------------------
   The `html[data-theme="dark"]` selector overrides the CSS tokens
   declared in styles.css.  Because every component uses tokens,
   flipping the theme is a single attribute change.
   ================================================================== */

html[data-theme="dark"] {
  --color-healthy: #4CAF50;
  --color-warning: #FF9800;
  --color-fault:   #F44336;

  --bg:         #121212;
  --surface:    #1E1E1E;
  --surface-2:  #2A2A2A;
  --border:     #424242;
  --text:       #FFFFFF;
  --text-muted: #BDBDBD;
  --shadow:     0 2px 6px rgba(0, 0, 0, 0.5);
  --shadow-lg:  0 10px 28px rgba(0, 0, 0, 0.55);

  --graph-temp:  #64B5F6;
  --graph-vib:   #9CCC65;
  --graph-warn:  #FFB74D;
  --graph-fault: #EF5350;

  --accent: #BB86FC;
}

/* Tone-specific text adjustments for contrast in dark mode */
html[data-theme="dark"] .status-pill { background: var(--surface-2); }
html[data-theme="dark"] .status-pill.status-online  { color: #81C784; }
html[data-theme="dark"] .status-pill.status-offline { color: #EF9A9A; }

html[data-theme="dark"] .condition-badge.condition-healthy { background: rgba(76, 175, 80, 0.14); }
html[data-theme="dark"] .condition-badge.condition-warning { background: rgba(255, 152, 0, 0.16); }
html[data-theme="dark"] .condition-badge.condition-fault   { background: rgba(244, 67, 54, 0.16); }

html[data-theme="dark"] .alert-item { background: var(--surface-2); }

html[data-theme="dark"] .btn { background: var(--surface-2); border-color: var(--border); }
html[data-theme="dark"] .btn:hover { background: #333; }
html[data-theme="dark"] .btn.is-accent { background: var(--accent); color: #121212; }

html[data-theme="dark"] .metric-bar-fill { background: #90a4ae; }

html[data-theme="dark"] .field input[type="text"],
html[data-theme="dark"] .field input[type="number"] { color-scheme: dark; }
```

### public/css/animations.css

```css
/* ==================================================================
   animations.css — keyframe animations used across the dashboard
   ================================================================== */

/* Alert items slide in from the right */
@keyframes slideIn {
  from { opacity: 0; transform: translateX(14px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Pulse on the "refresh"/'waiting for data' indicator */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

/* Soft ping ring for the online dot */
@keyframes ping {
  0%   { box-shadow: 0 0 0 0 rgba(0, 200, 83, 0.5); }
  100% { box-shadow: 0 0 0 8px rgba(0, 200, 83, 0); }
}

/* Spinner used while waiting for new data */
@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  display: inline-block;
  width: 14px; height: 14px;
  margin-right: 6px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  vertical-align: -2px;
}

/* Waiting (new data pending) state on the last-updated row */
.net-value.waiting { color: var(--text-muted); animation: pulse 1.2s infinite; }

/* Online dot gets a ping ring when freshly connected */
.dot.pinging { animation: ping 1.2s ease-out infinite; }

/* Reduced motion accessibility */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

---

*Generated from the checked-in source. Excludes: `node_modules/`, `.env`,
`data/` (SQLite files), `logs/`, and `public/lib/chart.umd.min.js` (vendored Chart.js).*