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