/**
 * models/device.js
 * ------------------------------------------------------------------
 * Mongoose model + data-access layer for the `devices` collection.
 * Stores metadata about each ESP32 that has ever sent data.
 */
const mongoose = require('mongoose');
const constants = require('../config/constants');
const { toPlain } = require('./helpers');

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true },
    deviceName: { type: String, default: null },
    ipAddress: { type: String, default: null },
    macAddress: { type: String, default: null },
    firmwareVersion: { type: String, default: null },
    lastSeen: { type: Date, default: null },
    status: { type: String, default: 'ONLINE' },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'devices',
  }
);

deviceSchema.index({ lastSeen: -1 });

const Device = mongoose.model('Device', deviceSchema);

async function ensureIndexes() {
  await Device.syncIndexes();
}

// ---------------------------------------------------------------------------
// UPSERT — register a device or update its info if it already exists.
// Metadata fields are only overwritten when a value is actually provided
// (COALESCE semantics, matching the previous SQLite implementation).
// ---------------------------------------------------------------------------
async function upsert({ deviceId, deviceName, ipAddress, macAddress, firmwareVersion }) {
  const update = {
    lastSeen: new Date(),
    status: constants.DEVICE_STATUS.ONLINE,
  };
  if (deviceName !== undefined && deviceName !== null) update.deviceName = deviceName;
  if (ipAddress !== undefined && ipAddress !== null) update.ipAddress = ipAddress;
  if (macAddress !== undefined && macAddress !== null) update.macAddress = macAddress;
  if (firmwareVersion !== undefined && firmwareVersion !== null) update.firmwareVersion = firmwareVersion;

  return Device.updateOne({ deviceId }, { $set: update }, { upsert: true });
}

// ---------------------------------------------------------------------------
// GET the latest data point number for a device (incremented each reading).
// ---------------------------------------------------------------------------
async function getLatestDataPointNumber(deviceId) {
  const { SensorReading } = require('./sensorData');
  const doc = await SensorReading.findOne({ deviceId })
    .sort({ dataPointNumber: -1 })
    .select('dataPointNumber')
    .lean();
  return doc && doc.dataPointNumber !== null && doc.dataPointNumber !== undefined
    ? doc.dataPointNumber
    : 0;
}

// ---------------------------------------------------------------------------
// GET device info.
// ---------------------------------------------------------------------------
async function getById(deviceId) {
  return toPlain(await Device.findOne({ deviceId }).lean());
}

// ---------------------------------------------------------------------------
// LIST all registered devices.
// ---------------------------------------------------------------------------
async function listAll() {
  const docs = await Device.find().sort({ lastSeen: -1 }).lean();
  return docs.map(toPlain);
}

// ---------------------------------------------------------------------------
// UPDATE device status (ONLINE/OFFLINE).
// ---------------------------------------------------------------------------
async function setStatus(deviceId, status) {
  return Device.updateOne(
    { deviceId },
    { $set: { status, lastSeen: new Date() } }
  );
}

// ---------------------------------------------------------------------------
// REMOVE a device and all of its related data.
// Children are deleted first (the previous SQLite schema enforced
// foreign keys), then the device itself. Returns 1 if it existed.
// ---------------------------------------------------------------------------
async function remove(deviceId) {
  const { SensorReading } = require('./sensorData');
  const { AlertLog } = require('./alert');
  await SensorReading.deleteMany({ deviceId });
  await AlertLog.deleteMany({ deviceId });
  const { deletedCount } = await Device.deleteOne({ deviceId });
  return deletedCount;
}

module.exports = {
  Device,
  ensureIndexes,
  upsert,
  getById,
  listAll,
  setStatus,
  getLatestDataPointNumber,
  remove,
};
