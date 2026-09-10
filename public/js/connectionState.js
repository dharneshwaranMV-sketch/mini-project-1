/**
 * js/connectionState.js — Single source of truth for ESP32 connection state
 * ------------------------------------------------------------------
 * Implements a strict state machine:
 *   OFFLINE → ONLINE → STALE → OFFLINE
 *
 * Core principle: Dashboard only renders data that arrived in the last
 * connection window (default 15s). Before first packet: everything is zeroed.
 * After timeout: values are greyed out, marked "last seen", never frozen
 * as current.
 *
 * This module exports:
 *   - ConnectionState (object with status, timestamps, watchdog)
 *   - subscribe(callback) — fires on any state change
 *   - recordPacket(timestamp) — call when ESP32 data arrives
 *   - getStatus() — 'offline' | 'online' | 'stale'
 *   - isLiveData(timestamp?) — whether data should be rendered live
 */
(function () {
  window.App = window.App || {};

  // ========================================================================
  // Configuration
  // ========================================================================
  const CONFIG = {
    // Time (ms) to consider device ONLINE after last packet
    ONLINE_TIMEOUT_MS: 15000,
    // After this time, transition from ONLINE → STALE
    STALE_THRESHOLD_MS: 12000,
    // Watchdog check interval
    WATCHDOG_INTERVAL_MS: 2000,
  };

  // ========================================================================
  // State machine
  // ========================================================================
  const ConnectionState = {
    status: 'offline',              // 'offline' | 'online' | 'stale'
    lastPacketTimestamp: null,      // ISO string or null
    lastPacketReceivedAt: null,     // Date.now() timestamp
    firstConnectionAt: null,        // When we first received a packet
    subscribers: [],

    // ---- State transitions ----
    _setState(newStatus) {
      if (this.status === newStatus) return; // no change
      const oldStatus = this.status;
      this.status = newStatus;
      console.log(`[CONNECTION] ${oldStatus.toUpperCase()} → ${newStatus.toUpperCase()}`);
      this._notifySubscribers(newStatus, oldStatus);
    },

    // ---- Public API ----
    /**
     * Register a callback fired on every state change.
     * Callback receives (newStatus, oldStatus)
     */
    subscribe(callback) {
      this.subscribers.push(callback);
      return () => {
        this.subscribers = this.subscribers.filter(c => c !== callback);
      };
    },

    _notifySubscribers(newStatus, oldStatus) {
      this.subscribers.forEach(cb => {
        try { cb(newStatus, oldStatus); } catch (e) {
          console.error('[CONNECTION] Subscriber error:', e.message);
        }
      });
    },

    /**
     * Call this when ESP32 data arrives. Updates the watchdog timer.
     */
    recordPacket(timestamp) {
      this.lastPacketTimestamp = timestamp || new Date().toISOString();
      this.lastPacketReceivedAt = Date.now();

      if (!this.firstConnectionAt) {
        this.firstConnectionAt = Date.now();
        this._setState('online');
      } else if (this.status === 'stale' || this.status === 'offline') {
        // Reconnect: go back to online
        this._setState('online');
      }
      // If already online, keep it
    },

    /**
     * Get current connection state.
     */
    getStatus() {
      return this.status;
    },

    /**
     * Is this data point "live" (not stale)? Used to decide whether
     * to render alerts, update metrics, show full color, etc.
     *
     * @param {string|null} timestamp - optional ISO timestamp to check age
     * @returns {boolean} true if data is within the online window
     */
    isLiveData(timestamp) {
      if (!this.lastPacketReceivedAt) return false;
      if (timestamp && typeof timestamp === 'string') {
        try {
          const ts = new Date(timestamp).getTime();
          const age = Date.now() - ts;
          return age < CONFIG.ONLINE_TIMEOUT_MS;
        } catch (e) {
          return false;
        }
      }
      // No timestamp provided: use last packet time
      return Date.now() - this.lastPacketReceivedAt < CONFIG.ONLINE_TIMEOUT_MS;
    },

    /**
     * Milliseconds since last packet (or -1 if never connected).
     */
    getOfflineMs() {
      if (!this.lastPacketReceivedAt) return -1;
      return Date.now() - this.lastPacketReceivedAt;
    },

    /**
     * Human-readable "last seen" string for the UI.
     */
    getLastSeenText() {
      if (!this.lastPacketReceivedAt) return 'Never';
      const ms = this.getOfflineMs();
      if (ms < 1000) return 'Just now';
      if (ms < 60000) return Math.floor(ms / 1000) + 's ago';
      if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
      return Math.floor(ms / 3600000) + 'h ago';
    },
  };

  // ========================================================================
  // Watchdog: auto-transition online → stale → offline
  // ========================================================================
  let watchdogHandle = null;

  function startWatchdog() {
    if (watchdogHandle) return;
    watchdogHandle = setInterval(() => {
      if (!ConnectionState.lastPacketReceivedAt) {
        // Never connected
        if (ConnectionState.status !== 'offline') {
          ConnectionState._setState('offline');
        }
        return;
      }

      const offlineMs = ConnectionState.getOfflineMs();

      // ONLINE → STALE
      if (offlineMs > CONFIG.STALE_THRESHOLD_MS && ConnectionState.status === 'online') {
        ConnectionState._setState('stale');
      }
      // STALE/ONLINE → OFFLINE
      else if (offlineMs > CONFIG.ONLINE_TIMEOUT_MS && ConnectionState.status !== 'offline') {
        ConnectionState._setState('offline');
      }
      // OFFLINE → back to online if we got a fresh packet
      // (handled by recordPacket, not here)
    }, CONFIG.WATCHDOG_INTERVAL_MS);
  }

  function stopWatchdog() {
    if (watchdogHandle) clearInterval(watchdogHandle);
    watchdogHandle = null;
  }

  // Start on first subscribe
  const origSubscribe = ConnectionState.subscribe;
  ConnectionState.subscribe = function(callback) {
    startWatchdog();
    return origSubscribe.call(this, callback);
  };

  App.ConnectionState = ConnectionState;
})();
