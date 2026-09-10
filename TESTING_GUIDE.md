# Testing Guide — Offline-First Dashboard

## Pre-Test Checklist

✅ Server running on `localhost:5000`  
✅ `connectionState.js` loaded (checked syntax)  
✅ `dashboard.js` loaded (checked syntax)  
✅ API `/health` responding  
✅ API `/api/sensor/data` POST working  

---

## Test Scenarios

### Scenario 1: Cold Start (No Data Ever Received)

**Expected behavior:**
- Dashboard loads with all values showing `--`
- Condition badge shows ⚪ `WAITING` in neutral style
- Alert panel shows: *"⏳ Waiting for sensor data…"*
- Connection pill shows 🔴 `OFFLINE`
- Metrics panel is faded (opacity ~0.4)
- Controls disabled (refresh, stream, export, settings buttons greyed out)
- Charts remain empty (no grid, no lines)
- Simulator button is **enabled**

**How to test:**
1. Open `http://localhost:5000` in a fresh browser tab
2. Verify all above states are true
3. Do NOT click Simulate yet

**Pass criteria:** ✓ All zeroed, no fake data visible

---

### Scenario 2: First ESP32 Data Arrives

**Expected behavior:**
- UI springs to life (metrics become opaque, opacity 1.0)
- Charts populate with real data point
- Connection pill becomes 🟢 `ONLINE`
- Condition badge shows real status (🟢 HEALTHY / 🟠 WARNING / 🔴 FAULT)
- Alert panel shows active alerts (or "No active alerts" if condition is HEALTHY)
- Controls become **enabled**
- Last updated timestamp shows "Just now"
- Temperature/vibration show real values (not `--`)

**How to test:**
```bash
# From terminal (while dashboard is open):
curl -X POST http://localhost:5000/api/sensor/data \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"MOTOR_BOT_01","temperature":48.5,"vibration":320,"espSignalStrength":-45}'
```

Or click the **🧪 Simulate ESP32** button on the dashboard.

**Pass criteria:**
- ✓ All metrics update immediately
- ✓ Charts show data point
- ✓ Connection changes from 🔴 to 🟢
- ✓ Controls enabled
- ✓ No errors in browser console

---

### Scenario 3: Continuous Data (Every 2 Seconds)

**How to test:**
- Start simulator: Click **🧪 Simulate ESP32**
- Dashboard will automatically POST test data every 2s
- Watch values update in real-time
- Charts build up a curve

**Expected:**
- Temperature wanders between 30–78°C
- Vibration wanders between 60–900 ADC
- Conditions change to WARNING (temp > 45 or vib > 300) and FAULT (temp > 60 or vib > 600)
- Alerts fire when thresholds breach

**Pass criteria:**
- ✓ Values update smoothly
- ✓ Charts redraw instantly (no lag)
- ✓ Alerts appear on WARNING/FAULT
- ✓ Last updated stays current ("Just now", "2s ago", etc.)

---

### Scenario 4: Stop ESP32 → STALE Transition (12s)

**How to test:**
1. Let simulator run for 10+ seconds to populate data
2. Click **⏹ Stop Simulator**
3. Watch the connection status as time passes

**Expected timeline:**
- **t=0–11s**: Connection shows 🟢 `ONLINE`, values stay bright
- **t=12s**: Connection pill stays 🟢, but message changes to 🟠 `STALE`
  - Metrics fade to ~60% opacity
  - Last updated time greyed and italicized
  - "Last updated" field shows age ("12s ago")
- **t=15s+**: Connection becomes 🔴 `OFFLINE`, message shows "Last received: Xs ago"
  - Metrics fade to ~30% opacity
  - Condition badge becomes neutral ⚪
  - Alerts cleared

**Pass criteria:**
- ✓ Clean transition at 12s boundary
- ✓ Values don't jump to zero (stay visible as "last known")
- ✓ Visual distinction between online/stale/offline
- ✓ Timestamp shows age correctly ("12s ago", "15s ago", etc.)

---

### Scenario 5: Reconnect After Offline

**How to test:**
1. Stop simulator (data stops)
2. Wait until status shows 🔴 `OFFLINE` (15+ seconds)
3. Resume simulator: Click **🧪 Simulate ESP32** again

**Expected:**
- Connection immediately flips back to 🟢 `ONLINE`
- Metrics return to full opacity
- Last updated resets to "Just now"
- **Charts show a visible gap** where data was missing (NOT interpolated)
- New data starts plotting immediately after the gap

**Pass criteria:**
- ✓ Gap in chart (honest about downtime)
- ✓ No interpolated fake line filling the gap
- ✓ Metrics resume from current value (no jump)
- ✓ Alerts re-enable for new data

---

### Scenario 6: Alerts Behavior (Online vs. Offline)

**How to test:**

**Part A: Alerts on LIVE Data**
1. Start simulator
2. Watch for alerts: Simulator will occasionally spike temp/vib to trigger WARNING/FAULT
3. Verify alerts appear in the right-side panel with 🟠 or 🔴 icons
4. High-severity alerts should toast at bottom-right

**Part B: Alerts Cleared on Disconnect**
1. Continue simulator and generate an alert (trigger FAULT condition)
2. Stop simulator
3. Wait for status to go OFFLINE (15s)
4. Verify: Alert panel clears and shows waiting message

**Expected:**
- Alerts only display when `connectionState === 'online'`
- No stale alerts frozen from before disconnect
- Re-enable alerts automatically on reconnect

**Pass criteria:**
- ✓ Alerts appear/disappear with connection state
- ✓ No false "offline" alerts
- ✓ Alert list clears on disconnect

---

### Scenario 7: Manual Data Entry (No Simulator)

**How to test:**
```bash
# Send a single reading
curl -X POST http://localhost:5000/api/sensor/data \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"MOTOR_BOT_01","temperature":52.3,"vibration":450}'

# Wait 13 seconds, then send another
sleep 13
curl -X POST http://localhost:5000/api/sensor/data \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"MOTOR_BOT_01","temperature":51.8,"vibration":460}'
```

**Expected:**
- First POST: Dashboard goes ONLINE, shows 52.3°C, 450 ADC
- Wait 12s: Status transitions to STALE (🟠), values fade
- Second POST: Status back to ONLINE (🟢), new value plots with gap visible

**Pass criteria:**
- ✓ Single data points render correctly
- ✓ State transitions happen on time
- ✓ Gap visible in chart between posts

---

### Scenario 8: Data Stream Toggle

**How to test:**
1. Start simulator
2. Click **⏹ Stop Data Stream**
3. Verify: Dashboard still receives WebSocket data (last updated updates)
   - BUT metrics, charts, alerts do NOT update
4. Click **▶ Resume Data Stream**
5. Verify: Metrics resume updating immediately

**Expected:**
- Toggle pauses UI rendering of new data (doesn't disconnect server)
- Last packet time still updates (connection is alive)
- Charts don't grow while paused
- Stream can be resumed without refresh

**Pass criteria:**
- ✓ Stream pause works (metrics freeze, connection stays alive)
- ✓ Stream resume works (metrics update again)
- ✓ No data loss or error on toggle

---

### Scenario 9: Refresh Button (Load Historical Data)

**How to test:**
1. Start simulator, let it run for 30+ seconds
2. Click **🔄 Refresh Now**
3. Watch as historical data reloads

**Expected:**
- Button shows "⟳ Loading…" during fetch
- Chart repopulates with history (likely 30+ points if running long)
- Session min/max/avg recalculated
- Button returns to "🔄 Refresh Now"

**Pass criteria:**
- ✓ History loads without errors
- ✓ Chart repopulates
- ✓ Toast shows count of loaded rows

---

### Scenario 10: Dark Mode Toggle

**How to test:**
1. Click **🌙 Dark Mode** (or use Settings)
2. Verify entire dashboard switches to dark theme
3. Click again to return to light mode

**Expected:**
- All colors invert properly
- No glitches or missed elements
- Charts redraw with new colors
- Settings persist on reload

**Pass criteria:**
- ✓ Theme toggles smoothly
- ✓ All UI elements properly themed
- ✓ No console errors

---

### Scenario 11: Settings Modal

**How to test:**
1. Click **🔧 Settings**
2. Change Device ID from `MOTOR_BOT_01` to `TEST_BOT_02` (or any value)
3. Change graph window to 60 minutes
4. Change max data points to 50
5. Click **Save**

**Expected:**
- Modal closes
- Toast shows "Settings saved"
- Charts reinitialize (will be empty momentarily, then reload data)
- New device ID is used for all subsequent API calls

**Pass criteria:**
- ✓ Settings persist (check localStorage)
- ✓ Charts rebuild with new limits
- ✓ Device ID changes affect data loaded

---

### Scenario 12: Export CSV

**How to test:**
1. Generate some data (simulator or manual POSTs)
2. Click **📊 Export Data (CSV)**

**Expected:**
- Browser downloads `motor_data_MOTOR_BOT_01_<timestamp>.csv`
- File contains columns: `id, deviceId, temperature, vibration, motorCondition, timestamp, espSignalStrength`
- Data matches what's shown on dashboard

**Pass criteria:**
- ✓ CSV downloads
- ✓ Filename includes device ID and timestamp
- ✓ Data is valid and matches UI

---

## Performance Tests

### Bundle Size
```bash
du -h public/js/dashboard.js public/js/connectionState.js
# Should be ~15 KB combined (before gzip)
```

### Idle CPU (Watchdog)
- Open DevTools → Performance tab
- With zero new data arriving:
  - Old version: ~2–4 fps (fake data polling)
  - New version: <1 fps (watchdog only every 2s)

### Memory (Session Buffer)
- Start simulator for 10 minutes
- Check DevTools → Memory
- With `maxPoints: 100`, buffer should stay at ~100 rows (capped)
- Memory should NOT grow unbounded

---

## Browser Console Checklist

After each scenario, verify **zero console errors**:
- ✓ No `NaN` parsing errors
- ✓ No undefined variables
- ✓ No failed WebSocket connects (unless intentional)
- ✓ No timezone parsing issues

---

## Cleanup

```bash
# Stop the simulator (if running)
# Click "⏹ Stop Simulator" on dashboard

# Stop the server
# Ctrl+C in the terminal where npm start is running

# Optional: Clear test data from database
rm data/motor_inspection.db*
```

---

## Final Verification Checklist

- [ ] Fresh load shows zero state (no fake data)
- [ ] First ESP32 data triggers ONLINE state
- [ ] 12s timeout → STALE (values fade, marked "last seen")
- [ ] 15s timeout → OFFLINE (full fade, condition shows age)
- [ ] Reconnect shows gap in chart (honest downtime)
- [ ] Alerts only on LIVE data, clear on disconnect
- [ ] Simulator always available (testing without hardware)
- [ ] No console errors at state transitions
- [ ] Bundle smaller, idle CPU lower, memory capped
- [ ] All controls work (refresh, export, settings, toggle, dark mode)

---

**Ready to demo!** 🎉
