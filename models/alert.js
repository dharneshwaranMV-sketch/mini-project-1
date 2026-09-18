/**
 * models/alert.js
 * ------------------------------------------------------------------
 * Mongoose model + data-access layer for the `alert_log` collection.
 * Every time the motor condition changes to WARNING or FAULT, the route
 * handler inserts an alert row here.
 */
const mongoose = require('mongoose');
const { toPlain } = require('./helpers');

const alertSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    alertType: { type: String, required: true },
    severity: { type: String, required: true },
    message: { type: String, default: null },
    acknowledgedAt: { type: Date, default: null },
    timestamp: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'alert_log',
  }
);

alertSchema.index({ timestamp: -1 });

const AlertLog = mongoose.model('AlertLog', alertSchema);

async function ensureIndexes() {
  await AlertLog.syncIndexes();
}

// ---------------------------------------------------------------------------
// INSERT a new alert record. Returns the new document id.
// ---------------------------------------------------------------------------
async function create({ deviceId, alertType, severity, message }) {
  const doc = await AlertLog.create({
    deviceId,
    alertType,
    severity,
    message: message === undefined ? null : message,
    timestamp: new Date(),
  });
  return doc._id.toString();
}

// ---------------------------------------------------------------------------
// GET the most recent alerts, optionally filtered by device.
// ---------------------------------------------------------------------------
async function getRecent(deviceId, limit = 50) {
  const filter = deviceId ? { deviceId } : {};
  const docs = await AlertLog.find(filter)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  return docs.map(toPlain);
}

// ---------------------------------------------------------------------------
// ACKNOWLEDGE (clear) a single alert.
// ---------------------------------------------------------------------------
async function acknowledge(id) {
  if (!mongoose.isValidObjectId(id)) return { acknowledged: false };
  return AlertLog.updateOne({ _id: id }, { $set: { acknowledgedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// CLEAR all alerts (optionally for one device).
// ---------------------------------------------------------------------------
async function clearAll(deviceId) {
  const filter = deviceId ? { deviceId } : {};
  const { deletedCount } = await AlertLog.deleteMany(filter);
  return deletedCount;
}

module.exports = { AlertLog, ensureIndexes, create, getRecent, acknowledge, clearAll };
