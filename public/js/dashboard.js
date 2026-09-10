/**
 * js/dashboard.js — main application logic (performance-tuned)
 * ------------------------------------------------------------------
 * Optimisations applied for a snappy 60 FPS dashboard:
 *
 *   1. DOM element lookup cache      → one querySelector per element,
 *                                      never re-queried in the 2s loop.
 *   2. Write-only-on-change updates  → text nodes are only touched when
 *                                      their value actually changes.
 *   3. rAF-coalesced chart flushes   → sensor bursts and the initial
 *                                      history load share ONE canvas
 *                                      redraw per animation frame.
 *   4. Duplicate-point suppression   → the WS "latest" echo and the
 *                                      history fetch can't double-plot.
 *   5. Single 1 s tick loop          → clock / uptime / watchdog / rate
 *                                      share one interval.
 */
(function () {
  const U = App.Utils;
  const Storage = App.Storage;
  const API = App.API;
  const Charts = App.Charts;
  const WS = App.Websocket;

  const S = Storage.session;

  // ---- Global state ------------------------------------------------------
  const state = {
    lastSensorMs: 0,
    streamActive: true,
    simulating: false,
    simulateTimer: null,
    deviceOnline: false,
    lastPointTs: null,     // de-dupe key for live + history points
  };

  // ---- Thresholds (mirror backend `.env`) --------------------------------
  const THRESHOLDS = {
    temperature: { healthyMax: 45, warningMax: 60 },
    vibration: { healthyMax: 300, warningMax: 600 },
  };

  // ========================================================================
  // DOM CACHE — resolve every element ONCE at boot.
  // ========================================================================
  let el;
  function cacheDom() {
    el = {};
    const $ = U.$;
    (['tempCard', 'tempValue', 'tempMin', 'tempMax', 'tempStatus',
      'vibCard', 'vibValue', 'vibBar', 'vibLevel', 'vibAvg', 'vibStatus',
      'conditionBadge', 'conditionIcon', 'conditionText', 'conditionMessage',
      'espConnection', 'lastUpdated', 'dataPoint',
      'wsPill', 'apiPill', 'ratePill', 'signalPill',
      'alertList', 'alertsEmpty', 'clearAlertsBtn',
      'infoName', 'infoId', 'infoIp', 'infoMac', 'infoFw', 'infoSignal',
      'infoUptime', 'infoPoints', 'infoConn',
      'refreshBtn', 'streamToggleBtn', 'exportBtn', 'settingsBtn',
      'darkModeBtn', 'simulateBtn',
      'footerClock', 'globalStatus', 'globalStatusText',
      'settingsModal', 'closeSettingsBtn', 'saveSettingsBtn',
      'setDeviceId', 'setWindowMinutes', 'setMaxPoints', 'setDarkMode',
      'toastHost']).forEach((id) => { el[id] = $('#' + id); });
  }

  /** Set textContent only when the value changed (avoids layout/repaint). */
  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  // ========================================================================
  // INIT
  // ========================================================================
  function init() {
    cacheDom();
    applyTheme(Storage.getTheme());

    const settings = Storage.loadSettings();
    el.setDeviceId.value = settings.deviceId;
    el.setWindowMinutes.value = settings.windowMinutes;
    el.setMaxPoints.value = settings.maxPoints;
    el.setDarkMode.checked = settings.darkMode;

    state.streamActive = Storage.isStreamActive();
    syncStreamButton();

    // Charts init (theme resolved exactly once here).
    Charts.init({ maxPoints: settings.maxPoints, isDark: Storage.getTheme() === 'dark', thresholds: THRESHOLDS });

    // Wire WebSocket events.
    WS.on('sensor_update', onSensorUpdate);
    WS.on('alert', onAlert);
    WS.on('connection_status', onConnectionStatus);
    WS.on('device_info', onDeviceInfo);
    WS.connect({ onStatusChange: onWsStatus });

    // Initial data: history + device metadata.
    loadHistory();
    loadDeviceInfo(settings.deviceId);

    bindControls();

    // ONE tick loop for all periodic UI work.
    setInterval(tick, 1000);
  }

  // ========================================================================
  // CHART FLUSH — coalesce redraws to one per animation frame
  // ========================================================================
  let chartDirty = false;
  let rafId = 0;
  function scheduleChartFlush() {
    if (chartDirty) return;               // already a redraw queued this frame
    chartDirty = true;
    rafId = requestAnimationFrame(() => {
      chartDirty = false;
      Charts.render(S.buffer);            // one O(n) redraw per frame max
    });
  }

  // ========================================================================
  // BUFFER — single source of truth for chart data
  // ========================================================================
  function pushPoint(timestamp, temp, vib) {
    if (!timestamp) return;
    const ts = timestamp;
    // De-dupe: history rows and the WS "latest" echo may carry identical ts.
    if (ts === state.lastPointTs) return;
    state.lastPointTs = ts;

    const S2 = S.buffer;
    S2.labels.push(ts);
    S2.temps.push(Number(temp));
    S2.vibs.push(Number(vib));

    const max = Storage.loadSettings().maxPoints;
    if (S2.labels.length > max) {
      S2.labels.shift();
      S2.temps.shift();
      S2.vibs.shift();
    }
    scheduleChartFlush();
  }

  function recordSessionStats(temp, vib) {
    S.minTemp = S.minTemp === null ? temp : Math.min(S.minTemp, temp);
    S.maxTemp = S.maxTemp === null ? temp : Math.max(S.maxTemp, temp);
    S.vibSum = (S.vibSum || 0) + vib;
    S.readingCount = (S.readingCount || 0) + 1;
    // rolling 60 s window for readings/minute
    S.eventTimestamps.push(Date.now());
    if (S.eventTimestamps.length > 200) S.eventTimestamps.shift();
  }

  // ========================================================================
  // HTTP LOADERS
  // ========================================================================
  async function loadHistory() {
    const settings = Storage.loadSettings();
    try {
      const result = await API.getHistory(settings.deviceId, settings.windowMinutes, settings.maxPoints);
      const rows = result.data || [];
      if (!rows.length) {
        toast('No data yet — waiting for sensor updates (or use Simulate ESP32).', 'warning');
        return;
      }
      // Bulk ingest is cheap (single push loop), charts flushed on last rAF.
      rows.forEach((r) => {
        pushPoint(r.timestamp, r.temperature, r.vibration);
        recordSessionStats(Number(r.temperature), Number(r.vibration));
      });
      scheduleChartFlush();
      toast('Loaded ' + rows.length + ' historical readings', 'success');
    } catch (err) {
      console.error('[DASHBOARD] History load failed:', err.message);
    }
  }

  async function loadDeviceInfo(deviceId) {
    try {
      const res = await API.getDevice(deviceId);
      const d = res.data || {};
      renderDeviceInfo({
        deviceName: d.deviceName || 'Motor Bot #01',
        deviceId: d.deviceId,
        ipAddress: d.ipAddress,
        macAddress: d.macAddress,
        firmwareVersion: d.firmwareVersion,
        dataPointNumber: S.readingCount,
      });
      if (d.currentStatus) {
        state.deviceOnline = d.currentStatus === 'ONLINE';
        updateEspConnection(state.deviceOnline);
      }
    } catch (err) {
      console.log('[DASHBOARD] Device info unavailable:', err.message);
    }
  }

  // ========================================================================
  // WS EVENT HANDLERS
  // ========================================================================
  function onSensorUpdate(msg) {
    const d = msg.data || {};
    const temp = Number(d.temperature);
    const vib = Number(d.vibration);

    if (state.streamActive && !isNaN(temp) && !isNaN(vib) && temp !== undefined && vib !== undefined) {
      const ts = new Date(d.timestamp || Date.now()).toISOString();
      pushPoint(ts, temp, vib);
      const condition = d.motorCondition || U.determineCondition(temp, vib, THRESHOLDS);
      updateMetrics(temp, vib, condition);
      recordSessionStats(temp, vib);

      S.lastCondition = condition;
      state.lastSensorMs = Date.now();
      state.deviceOnline = true;
    } else if (!isNaN(temp) && temp !== undefined) {
      // Paused or pure status echo — keep the heartbeat alive.
      state.lastSensorMs = Date.now();
    }

    setLastUpdated(d.timestamp);
    if (d.espSignalStrength !== undefined && d.espSignalStrength !== null) updateSignal(d.espSignalStrength);
    if (d.dataPointNumber !== undefined) setText(el.dataPoint, U.num(d.dataPointNumber));
  }

  function onAlert(msg) {
    el.alertsEmpty?.remove();
    const high = msg.severity === 'high';
    const item = document.createElement('div');
    item.className = 'alert-item ' + (high ? 'alert-fault' : 'alert-warning');
    item.innerHTML = `
      <div class="alert-icon">${high ? '🔴' : '🟠'}</div>
      <div class="alert-content">
        <div class="alert-type">${high ? 'FAULT' : 'WARNING'}</div>
        <div class="alert-message"></div>
        <div class="alert-timestamp"></div>
      </div>
      <button class="alert-close" title="Dismiss">✕</button>`;
    item.querySelector('.alert-message').textContent = msg.message || 'Sensor reading outside safe range';
    item.querySelector('.alert-timestamp').textContent = U.formatTime(msg.timestamp || Date.now());
    item.querySelector('.alert-close').addEventListener('click', () => item.remove());
    el.alertList.prepend(item);
    if (high) toast('🔴 ' + (msg.message || 'Fault condition'), 'error');
  }

  function onConnectionStatus(msg) {
    if (msg.status === 'offline') {
      state.deviceOnline = false;
      updateEspConnection(false);
      toast('ESP32 went OFFLINE', 'error');
    } else if (msg.status === 'online' || msg.status === 'connected') {
      state.deviceOnline = true;
      updateEspConnection(true);
    }
  }

  function onDeviceInfo(msg) { renderDeviceInfo(msg.data); }

  function onWsStatus(status, via) {
    if (status === 'connected') {
      el.globalStatus.className = 'status-pill status-online';
      setText(el.globalStatusText, via === 'polling' ? 'SERVER ONLINE (REST)' : 'SERVER ONLINE (WS)');
      setText(el.wsPill, '🟢 ONLINE');
    } else {
      el.globalStatus.className = 'status-pill status-offline';
      setText(el.globalStatusText, 'SERVER OFFLINE');
      setText(el.wsPill, '🔴 OFFLINE');
    }
  }

  // ========================================================================
  // METRICS RENDERING (only touches changed DOM)
  // ========================================================================
  function updateMetrics(temp, vib, condition) {
    // --- Temperature ------------------------------------------------
    const tVal = temp.toFixed(1) + '°';
    setText(el.tempValue, tVal);
    setCardStatus(el.tempCard, tempStatusOf(temp), el.tempStatus, tempLabelOf(temp));
    setText(el.tempMin, S.minTemp === null ? '--' : S.minTemp.toFixed(1));
    setText(el.tempMax, S.maxTemp === null ? '--' : S.maxTemp.toFixed(1));

    // --- Vibration --------------------------------------------------
    const vVal = Math.round(vib);
    setText(el.vibValue, vVal);
    const pct = U.clamp(vib / 1023 * 100, 0, 100);
    if (el.vibBar.style.width !== pct + '%') el.vibBar.style.width = pct + '%';
    setText(el.vibLevel, U.vibrationLevel(vib, THRESHOLDS));
    setText(el.vibAvg, S.readingCount ? Math.round(S.vibSum / S.readingCount) : '--');
    setCardStatus(el.vibCard, vibStatusOf(vib), el.vibStatus, vibLabelOf(vib));

    // --- Condition badge --------------------------------------------
    const cls = 'condition-badge condition-' + U.statusClass(condition);
    if (el.conditionBadge.className !== cls) {
      el.conditionBadge.className = cls;
      el.conditionBadge.querySelector('.condition-icon').textContent = U.conditionEmoji(condition);
    }
    setText(el.conditionText, condition);
    setText(el.conditionMessage, U.conditionMessage(condition));
  }

  function tempStatusOf(v) { return v > THRESHOLDS.temperature.warningMax ? 'fault' : v > THRESHOLDS.temperature.healthyMax ? 'warning' : 'healthy'; }
  function vibStatusOf(v)  { return v > THRESHOLDS.vibration.warningMax ? 'fault' : v > THRESHOLDS.vibration.healthyMax ? 'warning' : 'healthy'; }

  function tempLabelOf(v) {
    if (v > THRESHOLDS.temperature.warningMax) return '🔴 FAULT — Excessive heat';
    if (v > THRESHOLDS.temperature.healthyMax) return '🟠 WARNING — Elevated';
    return '🟢 HEALTHY — Within range';
  }

  function vibLabelOf(v) {
    if (v > THRESHOLDS.vibration.warningMax) return '🔴 FAULT — High vibration';
    if (v > THRESHOLDS.vibration.healthyMax) return '🟠 WARNING — Elevated';
    return '🟢 HEALTHY — Within range';
  }

  function setCardStatus(card, cls, statusNode, label) {
    card.classList.remove('status-healthy', 'status-warning', 'status-fault');
    card.classList.add('status-' + cls);
    statusNode.className = 'metric-status status-' + cls;
    setText(statusNode, label);
  }

  function updateEspConnection(online) {
    if (online) {
      if (el.espConnection.getAttribute('data-on') !== '1') {
        el.espConnection.innerHTML = '<span class="dot dot-green pinging"></span> ONLINE';
        el.espConnection.setAttribute('data-on', '1');
      }
    } else {
      if (el.espConnection.getAttribute('data-on') !== '0') {
        el.espConnection.innerHTML = '<span class="dot dot-red"></span> OFFLINE';
        el.espConnection.setAttribute('data-on', '0');
      }
    }
    setText(el.infoConn, online ? '🟢 ONLINE' : '🔴 OFFLINE');
  }

  function setLastUpdated(ts) {
    setText(el.lastUpdated, U.formatTime(ts));
    el.lastUpdated.classList.remove('waiting');
  }

  function updateSignal(rssi) {
    if (rssi === undefined || rssi === null || isNaN(rssi)) return;
    S.lastSignal = rssi;
    setText(el.signalPill, rssi + ' dBm');
    setText(el.infoSignal, rssi + ' dBm');
  }

  // ---- One shared tick: clock, uptime, watchdog, rate --------------------
  function tick() {
    S.uptimeSeconds = (S.uptimeSeconds || 0) + 1;
    setText(el.infoUptime, U.formatUptime(S.uptimeSeconds));
    setText(el.footerClock, new Date().toTimeString().slice(0, 8));

    // ESP32 OFFLINE watchdog (>30s silence)
    const offlineMs = state.lastSensorMs ? Date.now() - state.lastSensorMs : Infinity;
    if (offlineMs > 30000) {
      if (state.deviceOnline) { state.deviceOnline = false; updateEspConnection(false); }
      if (!el.lastUpdated.classList.contains('waiting')) el.lastUpdated.classList.add('waiting');
    }

    // readings/minute (rolling 60 s)
    if (S.eventTimestamps.length) {
      const now = Date.now();
      while (S.eventTimestamps.length && now - S.eventTimestamps[0] > 60000) S.eventTimestamps.shift();
      setText(el.ratePill, S.eventTimestamps.length + ' /min');
    }
  }

  // ========================================================================
  // CONTROLS
  // ========================================================================
  function bindControls() {
    el.refreshBtn.addEventListener('click', async () => {
      setText(el.refreshBtn, '⟳ Loading…');
      el.refreshBtn.disabled = true;
      try {
        const settings = Storage.loadSettings();
        const hist = await API.getHistory(settings.deviceId, settings.windowMinutes, settings.maxPoints);
        S.buffer = { labels: [], temps: [], vibs: [] };
        state.lastPointTs = null;
        (hist.data || []).forEach((r) => {
          pushPoint(r.timestamp, r.temperature, r.vibration);
          recordSessionStats(Number(r.temperature), Number(r.vibration));
        });
        scheduleChartFlush();
        toast('Refreshed — loaded ' + (hist.data || []).length + ' points', 'success');
      } catch (err) {
        toast('Refresh failed: ' + err.message, 'error');
      } finally {
        setText(el.refreshBtn, '🔄 Refresh Now');
        el.refreshBtn.disabled = false;
      }
    });

    el.streamToggleBtn.addEventListener('click', toggleStream);

    el.exportBtn.addEventListener('click', exportData);

    el.settingsBtn.addEventListener('click', () => el.settingsModal.classList.remove('hidden'));
    el.closeSettingsBtn.addEventListener('click', () => el.settingsModal.classList.add('hidden'));
    el.settingsModal.addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') el.settingsModal.classList.add('hidden');
    });
    el.saveSettingsBtn.addEventListener('click', saveSettings);

    el.darkModeBtn.addEventListener('click', () => {
      applyTheme(Storage.getTheme() === 'dark' ? 'light' : 'dark');
    });

    el.simulateBtn.addEventListener('click', toggleSimulator);

    el.clearAlertsBtn.addEventListener('click', () => {
      el.alertList.innerHTML = '<div class="empty-state" id="alertsEmpty">No active alerts 🎉</div>';
      toast('Alerts cleared', 'success');
    });
  }

  function toggleStream() {
    state.streamActive = !state.streamActive;
    Storage.setStreamActive(state.streamActive);
    syncStreamButton();
    toast(state.streamActive ? 'Data stream resumed' : 'Data stream paused',
      state.streamActive ? 'success' : 'warning');
    if (state.streamActive && !WS.isConnected()) WS.connect({ onStatusChange: onWsStatus });
  }

  function syncStreamButton() {
    setText(el.streamToggleBtn, state.streamActive ? '⏹ Stop Data Stream' : '▶ Resume Data Stream');
  }

  async function exportData() {
    const settings = Storage.loadSettings();
    try {
      const r = await API.exportCsv(
        settings.deviceId,
        new Date(Date.now() - settings.windowMinutes * 60000).toISOString(),
        new Date().toISOString()
      );
      toast(`Exported ${r.rows} rows to CSV`, 'success');
    } catch (err) {
      toast('Export failed: ' + err.message, 'error');
    }
  }

  function saveSettings() {
    const settings = {
      deviceId: el.setDeviceId.value.trim() || 'MOTOR_BOT_01',
      windowMinutes: parseInt(el.setWindowMinutes.value, 10) || 30,
      maxPoints: parseInt(el.setMaxPoints.value, 10) || 100,
      darkMode: el.setDarkMode.checked,
    };
    Storage.saveSettings(settings);
    applyTheme(settings.darkMode ? 'dark' : 'light');

    // Rebuild charts with new sizing + clear stale data.
    Charts.init({ maxPoints: settings.maxPoints, isDark: settings.darkMode, thresholds: THRESHOLDS });
    S.buffer = { labels: [], temps: [], vibs: [] };
    state.lastPointTs = null;
    loadHistory();

    el.settingsModal.classList.add('hidden');
    toast('Settings saved', 'success');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Storage.setTheme(theme);
    setText(el.darkModeBtn, theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode');
    el.setDarkMode.checked = theme === 'dark';
    Charts.refreshTheme();
  }

  // ========================================================================
  // SIMULATED ESP32 (posts to the real backend, same 2s cadence)
  // ========================================================================
  let simTemp = 38;
  let simVib = 160;
  function toggleSimulator() {
    state.simulating = !state.simulating;
    if (state.simulating) {
      setText(el.simulateBtn, '⏹ Stop Simulator');
      el.simulateBtn.classList.add('is-danger');
      toast('Simulated ESP32 started (posts every 2s)', 'warning');
      simTemp = 38;
      simVib = 160;
      state.simulateTimer = setInterval(async () => {
        simTemp = U.clamp(simTemp + (Math.random() * 4 - 1.8), 30, 78);
        simVib = U.clamp(simVib + (Math.random() * 60 - 28), 60, 900);
        try {
          await API.postSensorData({
            deviceId: Storage.loadSettings().deviceId,
            temperature: Math.round(simTemp * 10) / 10,
            vibration: Math.round(simVib),
            espSignalStrength: -45 + Math.round(Math.random() * 8 - 4),
            firmwareVersion: 'v1.0',
            deviceName: 'Motor Bot #01',
          });
        } catch (err) {
          console.error('[SIM] POST failed:', err.message);
        }
      }, 2000);
    } else {
      setText(el.simulateBtn, '🧪 Simulate ESP32');
      el.simulateBtn.classList.remove('is-danger');
      clearInterval(state.simulateTimer);
      toast('Simulator stopped', 'info');
    }
  }

  // ========================================================================
  // DEVICE INFO PANEL + TOASTS
  // ========================================================================
  function renderDeviceInfo(data) {
    if (!data) return;
    if (data.deviceName) setText(el.infoName, data.deviceName);
    if (data.deviceId) setText(el.infoId, data.deviceId);
    if (data.ipAddress) setText(el.infoIp, data.ipAddress);
    if (data.macAddress) setText(el.infoMac, data.macAddress);
    if (data.firmwareVersion) setText(el.infoFw, data.firmwareVersion);
    if (data.espSignalStrength !== undefined && data.espSignalStrength !== null)
      setText(el.infoSignal, data.espSignalStrength + ' dBm');
    if (data.dataPointNumber !== undefined) setText(el.infoPoints, U.num(data.dataPointNumber));
  }

  let lastToast = null;
  function toast(msg, type = 'info') {
    lastToast?.remove();
    lastToast = document.createElement('div');
    lastToast.className = 'toast toast-' + type;
    lastToast.textContent = msg;
    el.toastHost.appendChild(lastToast);
    setTimeout(() => {
      lastToast?.classList.add('out');
      setTimeout(() => lastToast?.remove(), 350);
    }, 3200);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();