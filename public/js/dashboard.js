/**
 * js/dashboard.js — Main application logic (offline-first rebuild)
 * ------------------------------------------------------------------
 * Core principles:
 *   1. ConnectionState is the single source of truth
 *   2. UI stays ZEROED until first ESP32 packet arrives
 *   3. Charts render empty until data arrives
 *   4. Alerts only fire on FRESH, ONLINE data
 *   5. When offline: last values are greyed out, marked "last seen"
 *   6. Performance: DOM cached, write-only-on-change, rAF-coalesced charts
 */
(function () {
  const U = App.Utils;
  const Storage = App.Storage;
  const API = App.API;
  const Charts = App.Charts;
  const WS = App.Websocket;
  const CS = App.ConnectionState;

  const S = Storage.session;

  // ========================================================================
  // Global state (independent of connection state)
  // ========================================================================
  const state = {
    streamActive: true,
    simulating: false,
    simulateTimer: null,
    lastPointTs: null,     // de-dupe key
    lastSensorMs: 0,
    espConnected: false,   // Track ESP32 connection state
  };

  // ---- Thresholds (mirror backend) ----
  const THRESHOLDS = {
    temperature: { healthyMax: 45, warningMax: 60 },
    vibration: { healthyMax: 300, warningMax: 600 },
  };

  // ========================================================================
  // DOM CACHE
  // ========================================================================
  let el;
  function cacheDom() {
    el = {};
    const $ = U.$;
    const ids = [
      'tempCard', 'tempValue', 'tempMin', 'tempMax', 'tempStatus',
      'vibCard', 'vibValue', 'vibBar', 'vibLevel', 'vibAvg', 'vibStatus',
      'conditionBadge', 'conditionText', 'conditionMessage',
      'espConnection', 'lastUpdated', 'dataPoint',
      'wsPill', 'apiPill', 'ratePill', 'signalPill',
      'alertList', 'alertsEmpty', 'clearAlertsBtn',
      'infoName', 'infoId', 'infoIp', 'infoMac', 'infoFw', 'infoSignal',
      'infoUptime', 'infoPoints', 'infoConn',
      'refreshBtn', 'streamToggleBtn', 'exportBtn', 'settingsBtn',
      'darkModeBtn', 'simulateBtn', 'footerClock', 'globalStatus', 'globalStatusText',
      'settingsModal', 'closeSettingsBtn', 'saveSettingsBtn',
      'setDeviceId', 'setWindowMinutes', 'setMaxPoints', 'setDarkMode',
      'toastHost', 'metricsRow', 'chartsRow'
    ];
    ids.forEach((id) => { el[id] = $('#' + id); });
    el.connectBtn = U.$('connectBtn');
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  // ========================================================================
  // INITIALIZATION
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

    // Initialize charts (but they'll stay empty until data arrives)
    Charts.init({
      maxPoints: settings.maxPoints,
      isDark: Storage.getTheme() === 'dark',
      thresholds: THRESHOLDS
    });

    // ---- Subscribe to connection state changes ----
    CS.subscribe(onConnectionStateChange);

    // ---- Wire WebSocket events ----
    WS.on('sensor_update', onSensorUpdate);
    WS.on('alert', onAlert);
    WS.on('connection_status', onConnectionStatus);
    WS.on('device_info', onDeviceInfo);
    WS.connect({ onStatusChange: onWsStatus });

    // ---- Initial UI state: ZEROED, waiting ----
    renderZeroState();

    // ---- Delayed data load (non-blocking) ----
    // Don't wait for history on startup; load it in parallel
    setTimeout(() => {
      loadHistory(settings.deviceId);
      loadDeviceInfo(settings.deviceId);
    }, 100);

    bindControls();

    // ---- Single tick loop ----
    setInterval(tick, 1000);
  }

  // ========================================================================
  // ZERO STATE — Before first ESP32 connection
  // ========================================================================
  function renderZeroState() {
    // Metrics: all "--"
    setText(el.tempValue, '--');
    setText(el.tempMin, '--');
    setText(el.tempMax, '--');
    setText(el.tempStatus, '—');

    setText(el.vibValue, '--');
    setText(el.vibLevel, '--');
    setText(el.vibAvg, '--');
    setText(el.vibStatus, '—');

    if (el.vibBar) el.vibBar.style.width = '0%';

    // Condition badge: neutral, no alert
    if (el.conditionBadge) {
      el.conditionBadge.className = 'condition-badge condition-healthy';
      el.conditionBadge.querySelector('.condition-icon').textContent = '⚪';
    }
    setText(el.conditionText, 'WAITING');
    setText(el.conditionMessage, 'Awaiting first data point…');

    // ESP32 connection: OFFLINE with calm message
    if (el.espConnection) {
      el.espConnection.innerHTML = '<span class="dot dot-red"></span> OFFLINE';
    }
    setText(el.lastUpdated, '--:--:--');
    setText(el.dataPoint, '--');

    // Device info: all "--"
    setText(el.infoName, '--');
    setText(el.infoId, '--');
    setText(el.infoIp, '--');
    setText(el.infoMac, '--');
    setText(el.infoFw, '--');
    setText(el.infoSignal, '--');
    setText(el.infoPoints, '--');
    setText(el.infoConn, '🔴 OFFLINE');

    // Signal/rate: "--"
    setText(el.signalPill, '--');
    setText(el.ratePill, '0 /min');

    // Charts: empty (no data)
    Charts.render(null);

    // Alerts: show waiting message
    if (el.alertList) {
      el.alertList.innerHTML = `
        <div class="empty-state">
          ⏳ <b>Waiting for sensor data…</b><br>
          <small>Connect the ESP32 or click "Simulate ESP32" to begin.</small>
        </div>
      `;
    }

    // Disable non-essential controls (simulator always available)
    [el.refreshBtn, el.streamToggleBtn, el.exportBtn, el.settingsBtn].forEach(btn => {
      if (btn) btn.disabled = true;
    });

    // Fade metrics during waiting
    if (el.metricsRow) {
      el.metricsRow.style.opacity = '0.4';
      el.metricsRow.style.pointerEvents = 'none';
    }
    if (el.chartsRow) {
      el.chartsRow.style.display = 'none';
    }
  }

  // ========================================================================
  // CONNECTION HANDLER — Detect when ESP32 is first connected
  // ========================================================================
  function onConnectionStateChange(newStatus, oldStatus) {
    console.log(`[DASHBOARD] Connection: ${oldStatus} → ${newStatus}`);

    // Update simulate button state based on ESP32 connection
    if (newStatus === 'online') {
      state.espConnected = true;
      updateSimulateButtonState();
      // Transition to ONLINE: UI becomes live
      if (el.metricsRow) {
        el.metricsRow.style.opacity = '1';
        el.metricsRow.style.pointerEvents = 'auto';
      }
      if (el.chartsRow) {
        el.chartsRow.style.display = 'grid';
      }
      [el.refreshBtn, el.streamToggleBtn, el.exportBtn, el.settingsBtn].forEach(btn => {
        if (btn) btn.disabled = false;
      });
      updateGlobalConnectionBanner();
    } else if (newStatus === 'stale') {
      // Transition to STALE: values visible but greyed, marked "last seen"
      if (el.metricsRow) {
        el.metricsRow.style.opacity = '0.6';
      }
      if (el.lastUpdated) {
        el.lastUpdated.classList.add('stale');
      }
      updateGlobalConnectionBanner();
      toast('⚠️ ESP32 data stale (no recent packets)', 'warning');
    } else if (newStatus === 'offline') {
      // Transition to OFFLINE: grey everything, show "last seen"
      if (el.metricsRow) {
        el.metricsRow.style.opacity = '0.3';
      }
      if (el.lastUpdated) {
        el.lastUpdated.classList.add('stale');
      }
      if (el.conditionBadge) {
        el.conditionBadge.className = 'condition-badge condition-healthy';
      }
      if (el.espConnection) {
        el.espConnection.innerHTML = '<span class="dot dot-red"></span> OFFLINE';
      }
      setText(el.conditionMessage, 'Last received: ' + CS.getLastSeenText());
      updateGlobalConnectionBanner();
    }
  }

  function updateGlobalConnectionBanner() {
    const status = CS.getStatus();
    const pill = el.globalStatus;
    const text = el.globalStatusText;

    if (status === 'offline') {
      pill.className = 'status-pill status-offline';
      setText(text, '🔴 ESP32 Offline · ' + CS.getLastSeenText());
    } else if (status === 'stale') {
      pill.className = 'status-pill status-offline';
      setText(text, '🟠 ESP32 Stale · ' + CS.getLastSeenText());
    } else if (status === 'online') {
      pill.className = 'status-pill status-online';
      setText(text, '🟢 ESP32 Online');
    }
  }

  // ========================================================================
  // CHART FLUSH
  // ========================================================================
  let chartDirty = false;
  let rafId = 0;
  function scheduleChartFlush() {
    if (chartDirty) return;
    chartDirty = true;
    rafId = requestAnimationFrame(() => {
      chartDirty = false;
      Charts.render(S.buffer.labels.length > 0 ? S.buffer : null);
    });
  }

  // ========================================================================
  // DATA BUFFER
  // ========================================================================
  function pushPoint(timestamp, temp, vib) {
    if (!timestamp) return;
    const ts = timestamp;
    if (ts === state.lastPointTs) return; // de-dupe
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
    S.eventTimestamps.push(Date.now());
    if (S.eventTimestamps.length > 200) S.eventTimestamps.shift();
  }

  // ========================================================================
  // HTTP LOADERS
  // ========================================================================
  async function loadHistory(deviceId) {
    const settings = Storage.loadSettings();
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );
      const result = await Promise.race([
        API.getHistory(deviceId, settings.windowMinutes, settings.maxPoints),
        timeoutPromise
      ]);

      const rows = result.data || [];
      if (rows.length === 0) return;

      rows.forEach((r) => {
        pushPoint(r.timestamp, r.temperature, r.vibration);
        recordSessionStats(Number(r.temperature), Number(r.vibration));
      });
      scheduleChartFlush();
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
      });
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

    // Record this packet with the connection state machine
    CS.recordPacket(d.timestamp);
    state.lastSensorMs = Date.now();

    // Only render if stream is active AND we're in a live state
    if (state.streamActive && !isNaN(temp) && !isNaN(vib)) {
      const ts = new Date(d.timestamp || Date.now()).toISOString();
      pushPoint(ts, temp, vib);
      const condition = d.motorCondition || U.determineCondition(temp, vib, THRESHOLDS);
      updateMetrics(temp, vib, condition);
      recordSessionStats(temp, vib);
      S.lastCondition = condition;
    }

    setLastUpdated(d.timestamp);
    if (d.espSignalStrength !== undefined && d.espSignalStrength !== null) {
      updateSignal(d.espSignalStrength);
    }
    if (d.dataPointNumber !== undefined) {
      setText(el.dataPoint, U.num(d.dataPointNumber));
    }
  }

  function onAlert(msg) {
    // Only show alerts on LIVE data
    if (CS.getStatus() !== 'online') return;

    if (!S.activeAlerts) S.activeAlerts = [];
    const isDuplicate = S.activeAlerts.some(
      a => a.timestamp === msg.timestamp && a.message === msg.message
    );
    if (isDuplicate) return;

    S.activeAlerts.unshift(msg);
    S.activeAlerts = S.activeAlerts.slice(0, 20);

    renderAlerts(S.activeAlerts);

    if (msg.severity === 'high') {
      toast(`🔴 FAULT: ${msg.message}`, 'error');
    }
  }

  function renderAlerts(alerts) {
    const container = el.alertList;
    if (!container) return;

    if (CS.getStatus() === 'offline' && (!alerts || alerts.length === 0)) {
      container.innerHTML = `
        <div class="empty-state">
          ⏳ <b>Waiting for sensor data…</b><br>
          <small>Connect the ESP32 or click "Simulate ESP32".</small>
        </div>
      `;
      return;
    }

    if (!alerts || alerts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          ✅ <b>No active alerts</b><br>
          <small>Motor operating normally.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    alerts.slice(0, 10).forEach((alert) => {
      const isHigh = alert.severity === 'high';
      const item = document.createElement('div');
      item.className = `alert-item ${isHigh ? 'alert-fault' : 'alert-warning'}`;
      item.innerHTML = `
        <div class="alert-icon">${isHigh ? '🔴' : '🟠'}</div>
        <div class="alert-content">
          <div class="alert-type">${isHigh ? 'FAULT' : 'WARNING'}</div>
          <div class="alert-message">${escapeHtml(alert.message || 'Sensor reading outside range')}</div>
          <div class="alert-timestamp">${U.formatTime(alert.timestamp || Date.now())}</div>
        </div>
        <button class="alert-close" type="button" title="Dismiss" aria-label="Dismiss alert">✕</button>
      `;
      item.querySelector('.alert-close').addEventListener('click', () => {
        item.classList.add('out');
        setTimeout(() => item.remove(), 300);
      });
      container.appendChild(item);
    });

    if (alerts.length > 10) {
      const more = document.createElement('div');
      more.className = 'alert-item-more';
      more.textContent = `+${alerts.length - 10} more alerts`;
      container.appendChild(more);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function onConnectionStatus(msg) {
    if (msg.status === 'offline') {
      CS._setState('offline');
    } else if (msg.status === 'online' || msg.status === 'connected') {
      if (CS.getStatus() === 'offline') {
        CS._setState('online');
      }
    }
  }

  function onDeviceInfo(msg) {
    renderDeviceInfo(msg.data);
  }

  function onWsStatus(status, via) {
    if (status === 'connected') {
      el.globalStatus.className = 'status-pill status-online';
      setText(el.wsPill, '🟢 ONLINE');
    } else {
      el.globalStatus.className = 'status-pill status-offline';
      setText(el.wsPill, '🔴 OFFLINE');
    }
  }

  // ========================================================================
  // METRICS RENDERING
  // ========================================================================
  function updateMetrics(temp, vib, condition) {
    const tVal = temp.toFixed(1) + '°';
    setText(el.tempValue, tVal);
    setCardStatus(el.tempCard, tempStatusOf(temp), el.tempStatus, tempLabelOf(temp));
    setText(el.tempMin, S.minTemp === null ? '--' : S.minTemp.toFixed(1));
    setText(el.tempMax, S.maxTemp === null ? '--' : S.maxTemp.toFixed(1));

    const vVal = Math.round(vib);
    setText(el.vibValue, vVal);
    const pct = U.clamp(vib / 1023 * 100, 0, 100);
    if (el.vibBar && el.vibBar.style.width !== pct + '%') {
      el.vibBar.style.width = pct + '%';
    }
    setText(el.vibLevel, U.vibrationLevel(vib, THRESHOLDS));
    setText(el.vibAvg, S.readingCount ? Math.round(S.vibSum / S.readingCount) : '--');
    setCardStatus(el.vibCard, vibStatusOf(vib), el.vibStatus, vibLabelOf(vib));

    const cls = 'condition-badge condition-' + U.statusClass(condition);
    if (el.conditionBadge && el.conditionBadge.className !== cls) {
      el.conditionBadge.className = cls;
      const icon = el.conditionBadge.querySelector('.condition-icon');
      if (icon) icon.textContent = U.conditionEmoji(condition);
    }
    setText(el.conditionText, condition);
    setText(el.conditionMessage, U.conditionMessage(condition));
  }

  function tempStatusOf(v) {
    return v > THRESHOLDS.temperature.warningMax ? 'fault' :
           v > THRESHOLDS.temperature.healthyMax ? 'warning' : 'healthy';
  }
  function vibStatusOf(v) {
    return v > THRESHOLDS.vibration.warningMax ? 'fault' :
           v > THRESHOLDS.vibration.healthyMax ? 'warning' : 'healthy';
  }

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
    if (!card) return;
    card.classList.remove('status-healthy', 'status-warning', 'status-fault');
    card.classList.add('status-' + cls);
    if (statusNode) {
      statusNode.className = 'metric-status status-' + cls;
      setText(statusNode, label);
    }
  }

  function setLastUpdated(ts) {
    setText(el.lastUpdated, U.formatTime(ts));
    if (el.lastUpdated && CS.getStatus() === 'online') {
      el.lastUpdated.classList.remove('stale');
    }
  }

  function updateSignal(rssi) {
    if (rssi === undefined || rssi === null || isNaN(rssi)) return;
    S.lastSignal = rssi;
    setText(el.signalPill, rssi + ' dBm');
    setText(el.infoSignal, rssi + ' dBm');
  }

  function renderDeviceInfo(data) {
    if (!data) return;
    if (data.deviceName) setText(el.infoName, data.deviceName);
    if (data.deviceId) setText(el.infoId, data.deviceId);
    if (data.ipAddress) setText(el.infoIp, data.ipAddress);
    if (data.macAddress) setText(el.infoMac, data.macAddress);
    if (data.firmwareVersion) setText(el.infoFw, data.firmwareVersion);
  }

  // ========================================================================
  // TICK (1s loop)
  // ========================================================================
  function tick() {
    S.uptimeSeconds = (S.uptimeSeconds || 0) + 1;
    setText(el.infoUptime, U.formatUptime(S.uptimeSeconds));
    setText(el.footerClock, new Date().toTimeString().slice(0, 8));

    // readings/minute
    if (S.eventTimestamps.length) {
      const now = Date.now();
      while (S.eventTimestamps.length && now - S.eventTimestamps[0] > 60000) {
        S.eventTimestamps.shift();
      }
      setText(el.ratePill, S.eventTimestamps.length + ' /min');
    }

    // Update connection banner (changes with time as offline duration increases)
    if (CS.getStatus() !== 'online') {
      updateGlobalConnectionBanner();
    }
  }

  // ========================================================================
  // CONTROLS
  // ========================================================================
  function bindControls() {
    el.connectBtn?.addEventListener('click', connectEsp32);
    el.refreshBtn?.addEventListener('click', async () => {
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

    el.streamToggleBtn?.addEventListener('click', toggleStream);
    el.exportBtn?.addEventListener('click', exportData);

    el.settingsBtn?.addEventListener('click', () => {
      el.settingsModal?.classList.remove('hidden');
    });
    el.closeSettingsBtn?.addEventListener('click', () => {
      el.settingsModal?.classList.add('hidden');
    });
    el.settingsModal?.addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') el.settingsModal.classList.add('hidden');
    });
    el.saveSettingsBtn?.addEventListener('click', saveSettings);

    el.darkModeBtn?.addEventListener('click', () => {
      applyTheme(Storage.getTheme() === 'dark' ? 'light' : 'dark');
    });

    el.simulateBtn?.addEventListener('click', toggleSimulator);

    el.clearAlertsBtn?.addEventListener('click', () => {
      S.activeAlerts = [];
      renderAlerts([]);
      toast('Alerts cleared', 'success');
    });
  }

  // ========================================================================
  // ESP32 CONNECTION
  // ========================================================================
  async function connectEsp32() {
    const connectBtn = el.connectBtn;
    if (!connectBtn) return;

    try {
      connectBtn.disabled = true;
      setText(connectBtn, '🔗 Connecting…');

      // Try to fetch device info to verify ESP32 is reachable
      const settings = Storage.loadSettings();
      const result = await Promise.race([
        API.getDevice(settings.deviceId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
      ]);

      // Mark as connected
      state.espConnected = true;
      updateSimulateButtonState();

      toast('✅ ESP32 Connected! Simulator is now ready.', 'success');
      setText(connectBtn, '✅ ESP32 Connected');
      connectBtn.style.opacity = '0.6';
      connectBtn.style.cursor = 'default';

    } catch (err) {
      toast('❌ Connection failed: ' + err.message + '\n\nMake sure ESP32 is powered and nearby.', 'error');
      setText(connectBtn, '🔗 Connect ESP32');
      connectBtn.disabled = false;
      state.espConnected = false;
      updateSimulateButtonState();
    }
  }

  function updateSimulateButtonState() {
    if (!el.simulateBtn) return;

    if (state.espConnected || state.simulating) {
      el.simulateBtn.disabled = false;
      el.simulateBtn.style.cursor = 'pointer';
      if (!state.simulating) {
        const hintEl = U.$('simulateHintText');
        if (hintEl) {
          hintEl.textContent = 'Click "Simulate ESP32" to start generating realistic test data every 2 seconds.';
        }
      }
    } else {
      el.simulateBtn.disabled = true;
      el.simulateBtn.style.cursor = 'not-allowed';
      const hintEl = U.$('simulateHintText');
      if (hintEl) {
        hintEl.textContent = 'Connect ESP32 first, then click "Simulate ESP32" to start generating test data.';
      }
    }
  }

  function toggleStream() {
    state.streamActive = !state.streamActive;
    Storage.setStreamActive(state.streamActive);
    syncStreamButton();
    toast(state.streamActive ? '▶ Data stream resumed' : '⏹ Data stream paused',
      state.streamActive ? 'success' : 'warning');
    if (state.streamActive && !WS.isConnected()) {
      WS.connect({ onStatusChange: onWsStatus });
    }
  }

  function syncStreamButton() {
    setText(el.streamToggleBtn,
      state.streamActive ? '⏹ Stop Data Stream' : '▶ Resume Data Stream');
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

    Charts.init({
      maxPoints: settings.maxPoints,
      isDark: settings.darkMode,
      thresholds: THRESHOLDS
    });
    S.buffer = { labels: [], temps: [], vibs: [] };
    state.lastPointTs = null;
    loadHistory(settings.deviceId);

    el.settingsModal?.classList.add('hidden');
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
  // SIMULATOR
  // ========================================================================
  let simTemp = 38;
  let simVib = 160;
  function toggleSimulator() {
    state.simulating = !state.simulating;
    if (state.simulating) {
      setText(el.simulateBtn, '⏹ Stop Simulator');
      el.simulateBtn.classList.add('is-danger');
      toast('🧪 Simulated ESP32 started (posts every 2s)', 'warning');
      simTemp = 38;
      simVib = 160;
      updateSimulateButtonState();
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
      updateSimulateButtonState();
      toast('⏹ Simulator stopped', 'info');
    }
  }

  // ========================================================================
  // TOASTS
  // ========================================================================
  let lastToast = null;
  function toast(msg, type = 'info') {
    lastToast?.remove();
    lastToast = document.createElement('div');
    lastToast.className = 'toast toast-' + type;
    lastToast.textContent = msg;
    el.toastHost?.appendChild(lastToast);
    setTimeout(() => {
      lastToast?.classList.add('out');
      setTimeout(() => lastToast?.remove(), 350);
    }, 3200);
  }

  // ========================================================================
  // BOOT
  // ========================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
