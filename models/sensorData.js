/**
 * models/sensorData.js
 * ------------------------------------------------------------------
 * Mongoose model + data-access layer for the `sensor_readings`
 * collection.  Every function is async so the route handlers can await
 * them and any driver errors bubble up as rejected promises.
 */
const mongoose = require('mongoose');
const { toPlain } = require('./helpers');

const sensorReadingSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    temperature: { type: Number, required: true },
    vibration: { type: Number, required: true },
    motorCondition: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    espSignalStrength: { type: Number, default: null },
    dataPointNumber: { type: Number, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'sensor_readings',
  }
);

// Indexes for fast time-series queries.
sensorReadingSchema.index({ deviceId: 1, timestamp: -1 });
sensorReadingSchema.index({ timestamp: -1 });
sensorReadingSchema.index({ motorCondition: 1 });

const SensorReading = mongoose.model('SensorReading', sensorReadingSchema);

async function ensureIndexes() {
  await SensorReading.syncIndexes();
}

// ---------------------------------------------------------------------------
// INSERT a new sensor reading.  Called every time the ESP32 POSTs data.
// Returns the new document id.
// ---------------------------------------------------------------------------
async function create({
  deviceId,
  temperature,
  vibration,
  motorCondition,
  timestamp,
  espSignalStrength,
  dataPointNumber,
}) {
  const doc = await SensorReading.create({
    deviceId,
    temperature,
    vibration,
    motorCondition,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
    espSignalStrength: espSignalStrength === undefined ? null : espSignalStrength,
    dataPointNumber: dataPointNumber === undefined ? null : dataPointNumber,
  });
  return doc._id.toString();
}

// ---------------------------------------------------------------------------
// GET the most recent reading for a device.
// ---------------------------------------------------------------------------
async function getLatest(deviceId) {
  const doc = await SensorReading.findOne({ deviceId }).sort({ timestamp: -1 }).lean();
  return toPlain(doc);
}

// ---------------------------------------------------------------------------
// GET historical readings for trend graphs.
//   `minutes`  — how far back to look (default 30)
//   `limit`    — max rows to return  (default 100)
// ---------------------------------------------------------------------------
async function getHistory(deviceId, minutes = 30, limit = 100) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const docs = await SensorReading.find({ deviceId, timestamp: { $gte: cutoff } })
    .sort({ timestamp: 1 })
    .limit(limit)
    .lean();
  return docs.map(toPlain);
}

// ---------------------------------------------------------------------------
// GET readings for CSV export within a time window.
// ---------------------------------------------------------------------------
async function getForExport(deviceId, startTime, endTime) {
  const filter = {};
  if (deviceId) filter.deviceId = deviceId;
  if (startTime || endTime) {
    filter.timestamp = {};
    if (startTime) filter.timestamp.$gte = new Date(startTime);
    if (endTime) filter.timestamp.$lte = new Date(endTime);
  }
  const docs = await SensorReading.find(filter).sort({ timestamp: 1 }).lean();
  return docs.map(toPlain);
}

// ---------------------------------------------------------------------------
// DELETE all readings for a device (used by clear endpoint).
// ---------------------------------------------------------------------------
async function clearAll(deviceId) {
  const filter = deviceId ? { deviceId } : {};
  const { deletedCount } = await SensorReading.deleteMany(filter);
  return deletedCount;
}

// ---------------------------------------------------------------------------
// DELETE readings older than a cutoff date (retention housekeeping).
// ---------------------------------------------------------------------------
async function deleteOlderThan(cutoff) {
  return SensorReading.deleteMany({ timestamp: { $lt: cutoff } });
}

module.exports = {
  SensorReading,
  ensureIndexes,
  create,
  getLatest,
  getHistory,
  getForExport,
  clearAll,
  deleteOlderThan,
};
