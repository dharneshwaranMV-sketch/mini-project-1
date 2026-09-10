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