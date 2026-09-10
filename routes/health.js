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