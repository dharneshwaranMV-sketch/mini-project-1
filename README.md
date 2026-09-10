# ⚙️ Motor Inspection Bot — IoT Dashboard

Real-time web dashboard for a **Portable Motor Inspection Bot** (B.E. Mechatronics
project). An ESP32-based field device streams motor **temperature** and
**vibration** readings to this server; the browser dashboard displays them live
with trend graphs, an alert panel, and export functionality.

```
ESP32 (Wi-Fi) ──HTTP POST──▶ Express server ──WebSocket──▶ Browser dashboard
                                  │
                                  └──▶ SQLite (history / alerts)
```

---

## ✨ Features

| Area | What you get |
|------|--------------|
| **Live metrics** | Temperature °C (min/max), vibration (ADC 0–1023 + level bar), overall HEALTHY / WARNING / FAULT badge |
| **Trend graphs** | Smooth Chart.js line charts, rolling 30-min window, Warning/Fault threshold lines |
| **Alerts** | Real-time alerts on condition change, dismissed individually or "Clear All" |
| **Device panel** | Name, ID, IP, MAC, firmware, signal strength, uptime, data points |
| **Controls** | Refresh now, pause/resume stream, CSV export, settings, dark mode |
| **Demo mode** | "🧪 Simulate ESP32" button generates realistic data — no hardware needed |
| **Persistence** | SQLite stores 7 days of readings (configurable), auto-purges |
| **Responsive** | Mobile / tablet / desktop layouts, light + dark themes |

**Motor condition logic** (adjustable in `.env`):

```
Temperature:  HEALTHY ≤ 45°C    WARNING 45–60°C    FAULT > 60°C
Vibration:    HEALTHY ≤ 300     WARNING 300–600    FAULT > 600   (ADC)
Combined:     any FAULT → FAULT ; any WARNING → WARNING ; else HEALTHY
```

---

## 🚀 Quick Start (local network, 2 minutes)

Requires **Node.js ≥ 14** ([nodejs.org](https://nodejs.org)).

```bash
# 1. Install dependencies
npm install

# 2. (Optional) create database + demo data
npm run migrate        # creates data/motor_inspection.db
npm run seed           # inserts 90 historical readings so graphs look alive

# 3. Start the server
npm start              # or: npm run dev (auto-reload with nodemon)
```

Open **http://localhost:5000** in a browser.

> ESP32 on the same Wi-Fi network reaches the server at
> **http://<your-laptop-ip>:5000** (find your IP with `ipconfig` on Windows
> or `ifconfig` on macOS/Linux). The server listens on all interfaces (`0.0.0.0`).

---

## 🧪 Test without hardware

Two ways:

**1. Dashboard button** — open the dashboard → *🧪 Simulate ESP32*.
The browser POSTs realistic readings to your own server every 2s.

**2. curl** — simulate a single ESP32 POST:

```bash
curl -X POST http://localhost:5000/api/sensor/data \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"MOTOR_BOT_01","temperature":48.5,"vibration":320}'
```

Expected response:

```json
{ "status": "success", "message": "Data received and processed",
  "motorCondition": "WARNING", "dataId": 1 }
```

---

## 🔌 ESP32 Firmware Integration

Send a JSON POST every 2–5 s from your ESP32 (any library works — Arduino
`HTTPClient`, ESP-IDF HTTP, etc.):

```json
POST /api/sensor/data
{
  "deviceId": "MOTOR_BOT_01",
  "temperature": 48.5,
  "vibration": 320,
  "timestamp": "2024-01-15T12:34:56Z",     // optional, server defaults to now
  "espSignalStrength": -45,                 // optional RSSI
  "deviceName": "Motor Bot #01",            // optional metadata
  "macAddress": "AA:BB:CC:DD:00:01",        // optional
  "firmwareVersion": "v1.0"                  // optional
}
```

A minimal Arduino/ESP32 sketch:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* SSID = "your-wifi";
const char* PASS = "your-password";
const char* HOST = "http://192.168.1.100:5000";  // your laptop IP

void sendReading(float temp, int vib) {
  HTTPClient http;
  http.begin(String(HOST) + "/api/sensor/data");
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["deviceId"]     = "MOTOR_BOT_01";
  doc["temperature"]  = temp;
  doc["vibration"]    = vib;
  doc["firmwareVersion"] = "v1.0";

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  Serial.printf("POST status: %d\n", code);
  http.end();
}
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sensor/data` | ESP32 push — validate, condition, save, broadcast |
| `GET`  | `/api/sensor/latest?deviceId=MOTOR_BOT_01` | Most recent reading + online/offline |
| `GET`  | `/api/sensor/history?deviceId=...&minutes=30&limit=100` | Readings for charts |
| `DELETE` | `/api/sensor/clear?deviceId=...` | Clear stored readings (testing) |
| `GET`  | `/api/device/list` | All registered devices |
| `GET`  | `/api/device/:deviceId` | Device details + current status |
| `DELETE` | `/api/device/:deviceId` | Remove a device and its data |
| `POST` | `/api/export/csv` | Download CSV `{deviceId, startTime, endTime}` |
| `GET`  | `/health` | Server heartbeat / uptime / ws client count |

### WebSocket (`ws://host:5000/ws`)

Server → browser messages:

```json
{ "type": "sensor_update", "deviceId": "MOTOR_BOT_01",
  "data": { "temperature": 48.5, "vibration": 320,
            "motorCondition": "HEALTHY", "timestamp": "...",
            "espSignalStrength": -45, "dataPointNumber": 1247 } }

{ "type": "alert", "severity": "high", "message": "...", "deviceId": "..." }

{ "type": "connection_status", "status": "offline", "deviceId": "..." }
```

Browser → server: `{ "type": "ping" }`, `{ "type": "get_state" }`.

---

## ⚙️ Configuration (`.env`)

```env
PORT=5000              # server port
HOST=0.0.0.0           # 0.0.0.0 = reachable by ESP32 on Wi-Fi
DB_PATH=./data/motor_inspection.db
DATA_RETENTION_DAYS=7  # purge readings older than this

# Motor thresholds (tune after experimental testing!)
TEMP_HEALTHY_MAX=45
TEMP_WARNING_MAX=60
VIB_HEALTHY_MAX=300
VIB_WARNING_MAX=600
```

---

## 🌍 Deployment

### Local network (demo / viva)

1. `npm install && npm start` on the laptop.
2. Dashboard: `http://localhost:5000` · ESP32: `http://<laptop-ip>:5000`.
3. All devices on the same Wi-Fi; allow port `5000` through the OS firewall.

### Cloud (Render, Railway, VPS)

```bash
# e.g. Render Web Service → build `npm install`, start `node server.js`
# `.env` lives in the dashboard UI on Render.
```
Set `HOST=0.0.0.0` and a fixed `PORT`, then point the ESP32 firmware at
`https://<your-app>.onrender.com` (change the URL scheme accordingly).

### Docker

A `Dockerfile` can be added trivially:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
```

```bash
docker build -t motor-dashboard .
docker run -p 5000:5000 -v "$PWD/data:/app/data" motor-dashboard
```

---

## 🧩 Project Structure

```
├── server.js                  # Express + WebSocket + offline monitor
├── config/                    # server.js, constants.js (thresholds)
├── models/                    # SQLite helpers + data layers
│   ├── database.js            #   connection, migrations, cleanup
│   ├── sensorData.js
│   ├── device.js
│   └── alert.js
├── routes/                    # sensor.js, device.js, export.js, health.js
├── websocket/                 # handler.js, manager.js, bus.js, motorLogic.js
├── migrations/                # 001_create_tables.sql, run.js, seed.js
├── public/                    # FRONTEND (served statically)
│   ├── index.html
│   ├── css/                   # styles, responsive, dark-mode, animations
│   └── js/                    # utils, storage, api, charts, websocket, dashboard
├── data/                      # SQLite database file (git-ignored)
└── .env / package.json
```

---

## 🛠 Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Dashboard won't load | `npm start` still running? Port 5000 free? Firewall allows it? |
| No live updates | Open DevTools → Network → WS tab; ensure `ws` shows connected; server logs show broadcasts |
| Graphs empty | Send data (Simulate ESP32 or curl) or run `npm run seed` |
| ESP32 can't reach server | Same Wi-Fi network? Use laptop IP not `localhost`? Firewall open? |
| Connection shows OFFLINE | No data for > 30 s (configurable in `.env`); device may be off |
| `sqlite3` install fails | Node version too old → upgrade to Node 16+; or `npm install --build-from-source` |

---

## 📋 Viva Talking Points

- **Architecture** — clean frontend/backend split, one shared condition engine
  (`websocket/motorLogic.js` mirrors the browser classifier).
- **Real-time** — WebSocket beats HTTP polling: single persistent connection,
  push not pull; 30 s heartbeat + exponential-backoff auto-reconnect.
- **Persistence** — SQLite (zero-config, file-based), indexed timestamp queries,
  auto-purge retention, CSV export.
- **Production touches** — input validation, error handling, CORS, WAL mode,
  graceful shutdown, WAI accessibility-reduced-motion.

---

## 📄 License

Educational use — part of a college mechatronics project. Thresholds are
placeholders; replace with calibrated values from your motor's datasheet.