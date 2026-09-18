/**
 * js/charts.js — Chart.js instances (performance-tuned)
 * ------------------------------------------------------------------
 * Performance choices (60 FPS on a demo laptop / tablet):
 *   1. `animation: false`  — Canvas redraws on live data are immediate
 *      instead of easing; the JS runtime cost drops dramatically.
 *   2. `pointRadius: 0`    — fewer pixels to rasterise per frame.
 *   3. `render(buffer)`    — copies only a *slice* of the rolling buffer
 *      into the chart arrays; O(n) with n ≤ maxPoints (≤500).
 *   4. `appendPoint()`     — cheap push/shift path used when a single
 *      reading arrives, avoiding a full array rebuild.
 *
 * The dashboard keeps one authoritative buffer and asks the charts to
 * draw it; the chart layer never owns data logic.
 */
(function () {
  window.App = window.App || {};

  // Cheap element lookup cache (avoids document.querySelector each frame).
  const elCache = {
    tempCanvas: null,
    vibCanvas: null,
    tempColor: null,
    vibColor: null,
  };

  const Charts = {
    tempChart: null,
    vibChart: null,
    maxPoints: 60,
    thresholds: { temperature: { healthyMax: 55, warningMax: 65 }, vibration: { healthyMax: 2500, warningMax: 3500 } },

    // ---- one-time theme resolution (avoids getComputedStyle per update) --
    _colors(isDark) {
      elCache.tempColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--graph-temp').trim() || (isDark ? '#64B5F6' : '#1976D2');
      elCache.vibColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--graph-vib').trim() || (isDark ? '#9CCC65' : '#7CB342');
    },

    // ---- initialisation -------------------------------------------------
    init({ maxPoints, isDark, thresholds }) {
      if (thresholds) this.thresholds = thresholds;
      this.maxPoints = maxPoints || 100;
      this._colors(!!isDark);

      const U = App.Utils;
      const tickColor = isDark ? '#BDBDBD' : '#757575';
      const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

      // Shared scale config — built once, reused by both charts.
      const scalesFactory = () => ({
        x: {
          ticks: { color: tickColor, maxTicksLimit: 8, maxRotation: 0, autoSkip: true },
          grid: { display: false },
        },
        y: {
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
      });

      // Per-chart base options: animation OFF, tiny points, cheap fill.
      const base = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,                     // KEY: instant redraws
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
        },
      };

      // ---- Temperature chart --------------------------------------------
      elCache.tempCanvas = U.$('#temperatureChart');
      if (elCache.tempCanvas && window.Chart) {
        if (this.tempChart) this.tempChart.destroy();
        this.tempChart = new Chart(elCache.tempCanvas, {
          type: 'line',
          data: {
            labels: [],
            datasets: [{
              label: 'Temperature (°C)',
              data: [],
              borderColor: elCache.tempColor,
              backgroundColor: elCache.tempColor + '14',   // ~8% alpha fill
              tension: 0.35,
              borderWidth: 2,
              pointRadius: 0,                              // fast draw
              pointHitRadius: 8,                           // easy hover target still
              pointHoverRadius: 4,
              fill: true,
            }],
          },
          options: {
            ...base,
            scales: {
              ...scalesFactory(),
              y: {
                ...scalesFactory().y,
                min: 0,
                max: 100,
                ticks: { color: tickColor, stepSize: 20, callback: (v) => v + '°C' },
              },
            },
          },
        });
      }

      // ---- Vibration chart + threshold bands -----------------------------
      elCache.vibCanvas = U.$('#vibrationChart');
      if (elCache.vibCanvas && window.Chart) {
        if (this.vibChart) this.vibChart.destroy();
        this.vibChart = new Chart(elCache.vibCanvas, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              {
                label: 'Vibration',
                data: [],
                borderColor: elCache.vibColor,
                backgroundColor: elCache.vibColor + '14',
                tension: 0.35,
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 8,
                pointHoverRadius: 4,
                fill: true,
              },
              { label: 'Warning', data: [], borderColor: '#FFA726', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, spanGaps: true },
              { label: 'Fault',   data: [], borderColor: '#E53935', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, spanGaps: true },
            ],
          },
          options: {
            ...base,
            scales: {
              ...scalesFactory(),
              y: {
                ...scalesFactory().y,
                min: 0,
                max: 4095,
                ticks: { color: tickColor, stepSize: 500 },
              },
            },
          },
        });
      }
    },

    // ---- full render from the rolling buffer -----------------------------
    /**
     * @param {{labels:string[],temps:number[],vibs:number[]}|null} buffer
     */
    render(buffer) {
      const n = this.maxPoints;
      const labels = buffer ? buffer.labels.slice(-n) : [];
      const temps  = buffer ? buffer.temps.slice(-n)  : [];
      const vibs   = buffer ? buffer.vibs.slice(-n)   : [];
      const t = this.thresholds.vibration;

      if (this.tempChart) {
        this.tempChart.data.labels = labels;
        this.tempChart.data.datasets[0].data = temps;
        this.tempChart.update('none');
      }
      if (this.vibChart) {
        this.vibChart.data.labels = labels;
        this.vibChart.data.datasets[0].data = vibs;
        // Threshold lines: flat arrays aligned to labels (reused arrays).
        const warn = labels.map(() => t.healthyMax);
        const fault = labels.map(() => t.warningMax);
        this.vibChart.data.datasets[1].data = warn;
        this.vibChart.data.datasets[2].data = fault;
        this.vibChart.update('none');
      }
    },

    // ---- incremental append (single live point) --------------------------
    /**
     * Fast path: push one reading onto both charts. Used by the WebSocket
     * handler when the buffer is the single source of truth and only the
     * newest point changed. O(1) push + shift.
     */
    appendPoint(label, temp, vib) {
      const n = this.maxPoints;

      if (this.tempChart) {
        this.tempChart.data.labels.push(label);
        this.tempChart.data.datasets[0].data.push(Number(temp));
        if (this.tempChart.data.labels.length > n) {
          this.tempChart.data.labels.shift();
          this.tempChart.data.datasets[0].data.shift();
        }
        this.tempChart.update('none');
      }
      if (this.vibChart) {
        this.vibChart.data.labels.push(label);
        this.vibChart.data.datasets[0].data.push(Number(vib));
        this.vibChart.data.datasets[1].data.push(this.thresholds.vibration.healthyMax);
        this.vibChart.data.datasets[2].data.push(this.thresholds.vibration.warningMax);
        if (this.vibChart.data.labels.length > n) {
          this.vibChart.data.labels.shift();
          this.vibChart.data.datasets[0].data.shift();
          this.vibChart.data.datasets[1].data.shift();
          this.vibChart.data.datasets[2].data.shift();
        }
        this.vibChart.update('none');
      }
    },

    /** Re-apply theme colours after a dark/light toggle. */
    refreshTheme() {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      this._colors(dark);
      const tickColor = dark ? '#BDBDBD' : '#757575';
      const gridColor = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

      [this.tempChart, this.vibChart].forEach((c) => {
        if (!c) return;
        c.options.scales.x.ticks.color = tickColor;
        c.options.scales.y.ticks.color = tickColor;
        c.options.scales.y.grid.color = gridColor;
        // Refresh line colours without a full rebuild.
        if (this.tempChart && c === this.tempChart) c.data.datasets[0].borderColor = elCache.tempColor;
        if (this.vibChart && c === this.vibChart) c.data.datasets[0].borderColor = elCache.vibColor;
        c.update('none');
      });
    },
  };

  App.Charts = Charts;
})();