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