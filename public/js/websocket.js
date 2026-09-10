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