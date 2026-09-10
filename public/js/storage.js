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