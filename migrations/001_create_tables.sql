-- =============================================================
-- 001_create_tables.sql — Motor Inspection Bot Dashboard schema
-- -------------------------------------------------------------
-- Three tables:
--   1. devices         — ESP32 metadata (name, IP, MAC, firmware)
--   2. sensor_readings — every temperature/vibration sample
--   3. alert_log       — WARNING/FAULT events with severity
-- =============================================================

-- ---- Devices --------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  deviceId        TEXT PRIMARY KEY,          -- e.g. MOTOR_BOT_01
  deviceName      TEXT,                      -- friendly name
  ipAddress       TEXT,                      -- last known IP
  macAddress      TEXT,                      -- ESP32 MAC (AA:BB:...)
  firmwareVersion TEXT,                      -- e.g. v1.0
  lastSeen        DATETIME,                  -- UTC timestamp of last POST
  status          TEXT DEFAULT 'ONLINE',     -- ONLINE / OFFLINE
  createdAt       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---- Sensor readings -------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_readings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId          TEXT NOT NULL,
  temperature       REAL NOT NULL,           -- °C
  vibration         REAL NOT NULL,           -- 12-bit ADC value (0-4095); ≥2500 WARNING, ≥3500 FAULT
  motorCondition    TEXT NOT NULL,           -- HEALTHY / WARNING / FAULT
  timestamp         DATETIME DEFAULT CURRENT_TIMESTAMP,
  espSignalStrength INTEGER,                 -- RSSI in dBm (optional)
  dataPointNumber   INTEGER,                 -- sequence number per device
  createdAt         DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deviceId) REFERENCES devices(deviceId)
);

-- ---- Alert log ------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId       TEXT NOT NULL,
  alertType      TEXT NOT NULL,              -- temperature / vibration / combined
  severity       TEXT NOT NULL,              -- medium (WARNING) / high (FAULT)
  message        TEXT,
  acknowledgedAt DATETIME,                   -- set when dismissed
  timestamp      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deviceId) REFERENCES devices(deviceId)
);

-- ---- Indexes for fast time-series queries -----------------------
CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON sensor_readings(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_readings_device    ON sensor_readings(deviceId);
CREATE INDEX IF NOT EXISTS idx_readings_condition ON sensor_readings(motorCondition);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp   ON alert_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_devices_lastSeen   ON devices(lastSeen);