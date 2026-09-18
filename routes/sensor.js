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

// Track if we've broadcast the first connection event to dashboards.
// This fires exactly once when ANY device POSTs its first reading.
let firstConnectionBroadcast = false;

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
  if (vibration < 0 || vibration > constants.VIBRATION_MAX) {
    return res.status(400).json({ status: 'error', code: 'INVALID_DATA', message: `Vibration outside valid range (0-${constants.VIBRATION_MAX})` });
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

    // Fire the writes sequentially: the reading row REFERENCES devices(deviceId),
    // so the device must exist BEFORE the reading is inserted (running both in
    // Promise.all races them and fails on a brand-new device with a FOREIGN KEY
    // constraint error).
    await deviceModel.upsert({
      deviceId,
      deviceName: req.body.deviceName,
      ipAddress: remoteAddr,
      macAddress: req.body.macAddress,
      firmwareVersion: req.body.firmwareVersion,
      espSignalStrength,
    });

    const dataId = await sensorDataModel.create({
      deviceId,
      temperature: Number(temperature),
      vibration: Number(vibration),
      motorCondition,
      timestamp,
      espSignalStrength,
      dataPointNumber,
    });

    // ---- 4. Broadcast FIRST CONNECTION event (if this is the very first reading) -----
    if (!firstConnectionBroadcast) {
      firstConnectionBroadcast = true;
      console.log('[SENSOR] First device connection detected — broadcasting to dashboards');
      if (wsBus) {
        wsBus.broadcastFirstConnection({
          deviceId,
          timestamp: new Date().toISOString(),
          message: 'First ESP32 reading received',
        });
      }
    }

    // ---- 5. Fire an alert on condition CHANGE -----------------------------
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

    // ---- 6. Broadcast to dashboards ---------------------------------------
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
    if (device && device.lastSeen &&
        Date.now() - new Date(device.lastSeen).getTime() < serverConfig.deviceOfflineMs) {
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