/**
 * js/utils.js — shared helpers
 * ------------------------------------------------------------------
 * Small, dependency-free utilities used by every other module:
 * DOM shortcuts, formatting, and the motor-condition classifier
 * (mirrored on the backend so the UI is never caught off-guard).
 */
(function () {
  window.App = window.App || {};

  const Utils = {
    // ---- DOM helpers ---------------------------------------------------
    $: (sel, root) => (root || document).querySelector(sel),
    $$: (sel, root) => Array.from((root || document).querySelectorAll(sel)),

    /** Parse an ISO string safely; fall back to now. */
    parseDate: (iso) => {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? new Date() : d;
    },

    /** HH:MM:SS in the local timezone. */
    formatTime: (iso) => {
      const d = Utils.parseDate(iso);
      return d.toTimeString().slice(0, 8);
    },

    /** HH:MM:SS and DD/MM for chart axis labels. */
    formatChartTime: (iso) => Utils.formatTime(iso).slice(0, 5),

    /** Basic relative time like "12s ago". */
    timeAgo: (iso) => {
      const secs = Math.max(0, Math.floor((Date.now() - Utils.parseDate(iso).getTime()) / 1000));
      if (secs < 60) return `${secs}s ago`;
      if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
      return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ago`;
    },

    /** Format uptime seconds → "2h 34m 12s". */
    formatUptime: (seconds) => {
      const s = Math.max(0, Math.floor(seconds));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return `${h}h ${m}m ${s % 60}s`;
    },

    /**
     * Motor condition classifier (mirrors config/constants.js).
     * Returns the worst matching status for a given temperature/vibration.
     */
    determineCondition: (temperature, vibration, thresholds) => {
      const t = thresholds?.temperature || { healthyMax: 45, warningMax: 60 };
      const v = thresholds?.vibration   || { healthyMax: 300, warningMax: 600 };

      const tempBad  = temperature > t.healthyMax;
      const tempFault = temperature > t.warningMax;
      const vibBad   = vibration > v.healthyMax;
      const vibFault = vibration > v.warningMax;

      if (tempFault || vibFault) return 'FAULT';
      if (tempBad || vibBad) return 'WARNING';
      return 'HEALTHY';
    },

    /** Human-friendly status message for each condition. */
    conditionMessage: (condition) => {
      return {
        HEALTHY: 'Normal operation',
        WARNING: 'Check motor — reading outside safe range',
        FAULT: 'Immediate inspection required!',
      }[condition] || 'Unknown';
    },

    /** Status → CSS status class suffix. */
    statusClass: (condition) => (condition === 'HEALTHY' ? 'healthy' : condition === 'WARNING' ? 'warning' : 'fault'),

    /** Condition → emoji used in the alert icon column. */
    conditionEmoji: (condition) => ({
      HEALTHY: '🟢',
      WARNING: '🟠',
      FAULT: '🔴',
    }[condition] || '⚪'),

    /** Relative vibration level label. */
    vibrationLevel: (vib, thresholds) => {
      const v = thresholds?.vibration || { healthyMax: 300, warningMax: 600 };
      if (vib > v.warningMax) return 'VERY HIGH';
      if (vib > v.healthyMax) return 'HIGH';
      if (vib > v.healthyMax * 0.5) return 'NORMAL';
      return 'LOW';
    },

    /** Clamp helper. */
    clamp: (val, min, max) => Math.min(max, Math.max(min, val)),

    /** format number with locale separators. */
    num: (n) => (n === null || n === undefined || isNaN(n)) ? '--' : Number(n).toLocaleString('en-IN'),
  };

  App.Utils = Utils;
})();