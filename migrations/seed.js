/**
 * migrations/seed.js
 * ------------------------------------------------------------------
 * Inserts a batch of realistic historical readings so the dashboard
 * graphs have something to show during a demo / viva.
 *
 * Run with:  npm run seed
 *
 * Requires MongoDB to be running (see MONGODB_URI in .env).
 */
const db = require('../models/database');
const sensorDataModel = require('../models/sensorData');
const deviceModel = require('../models/device');
const { determineMotorCondition } = require('../websocket/motorLogic');

const DEVICE_ID = process.env.MOTOR_DEVICE_ID || 'MOTOR_BOT_01';
const POINTS = 90;
const INTERVAL_MS = 20000; // 20s apart -> 30 minutes of history

function round1(n) {
  return Math.round(n * 10) / 10;
}

(async () => {
  try {
    await db.initialize();

    const now = Date.now();
    let temp = 38;
    let vib = 1500;

    await deviceModel.upsert({
      deviceId: DEVICE_ID,
      deviceName: 'Motor Bot #01',
      ipAddress: '127.0.0.1',
      macAddress: 'AA:BB:CC:DD:00:01',
      firmwareVersion: 'v1.0 (seed)',
    });

    for (let i = POINTS - 1; i >= 0; i -= 1) {
      temp = Math.min(64, Math.max(32, temp + (Math.random() * 4 - 1.9)));
      vib = Math.min(3300, Math.max(600, vib + (Math.random() * 500 - 240)));

      const timestamp = new Date(now - i * INTERVAL_MS);
      const motorCondition = determineMotorCondition(round1(temp), Math.round(vib));

      await sensorDataModel.create({
        deviceId: DEVICE_ID,
        temperature: round1(temp),
        vibration: Math.round(vib),
        motorCondition,
        timestamp,
        espSignalStrength: -45 + Math.round(Math.random() * 8 - 4),
        dataPointNumber: POINTS - i,
      });
    }

    console.log(`[SEED] Inserted ${POINTS} readings for ${DEVICE_ID}`);
    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('[SEED] Failed:', err.message);
    try { await db.close(); } catch (e) { /* noop */ }
    process.exit(1);
  }
})();
