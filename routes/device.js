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
const serverConfig = require('../config/server');

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

    // Compute ONLINE/OFFLINE from the stored lastSeen date.
    let status = constants.DEVICE_STATUS.OFFLINE;
    if (device.lastSeen) {
      const lastSeenMs = new Date(device.lastSeen).getTime();
      if (!isNaN(lastSeenMs) && Date.now() - lastSeenMs < serverConfig.deviceOfflineMs) {
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
    const removed = await deviceModel.remove(req.params.deviceId);
    if (!removed) {
      return res.status(404).json({ status: 'error', message: 'Device not found' });
    }
    res.json({ status: 'success', message: `Removed device ${req.params.deviceId} and its data` });
  } catch (err) {
    console.error('[DEVICE] Delete error:', err.message);
    res.status(500).json({ status: 'error', message: 'Database error' });
  }
});

module.exports = router;