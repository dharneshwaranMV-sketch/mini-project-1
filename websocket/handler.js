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