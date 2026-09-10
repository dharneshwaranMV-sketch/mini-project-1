/**
 * migrations/seed.js
 * ------------------------------------------------------------------
 * Optional demo seed: posts ~90 fake sensor readings (past 30 minutes)
 * plus device metadata so the dashboard graphs look alive immediately
 * after a fresh install. Run with:  npm run seed
 */
const db = require('../models/database');
const { determineMotorCondition, buildConditionMessage } = require('../websocket/motorLogic');

async function seed() {
  const deviceId = 'MOTOR_BOT_01';

  console.log('[SEED] Initialising database...');
  await db.initialize();

  console.log('[SEED] Registering device...');
  await db.run(`
    INSERT INTO devices (deviceId, deviceName, ipAddress, macAddress, firmwareVersion, lastSeen, status)
    VALUES (?, 'Motor Bot #01', '192.168.1.105', 'AA:BB:CC:DD:00:01', 'v1.0', datetime('now'), 'ONLINE')
    ON CONFLICT(deviceId) DO UPDATE SET lastSeen = datetime('now'), status = 'ONLINE'
  `, [deviceId]);

  console.log('[SEED] Generating 90 sample readings...');
  const now = Date.now();
  let temp = 38;
  let vib = 180;

  for (let i = 89; i >= 0; i--) {
    // Random walk so the graph looks organic.
    temp = Math.max(30, Math.min(75, temp + (Math.random() * 5 - 2.2)));
    vib  = Math.max(50, Math.min(1023, vib + (Math.random() * 80 - 38)));

    // Occasionally spike to demonstrate WARNING/FAULT states.
    if (i === 40) { temp = 52; vib = 420; }   // WARNING
    if (i === 18) { temp = 66; vib = 760; }   // FAULT

    const ts = new Date(now - (89 - i) * 20000).toISOString();
    const condition = determineMotorCondition(temp, vib);

    await db.run(`
      INSERT INTO sensor_readings (deviceId, temperature, vibration, motorCondition, timestamp, espSignalStrength, dataPointNumber)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [deviceId, Math.round(temp * 10) / 10, Math.round(vib), condition, ts, -45 + Math.round(Math.random() * 6 - 3), 90 - i]);

    if (condition !== 'HEALTHY') {
      await db.run(`
        INSERT INTO alert_log (deviceId, alertType, severity, message, timestamp)
        VALUES (?, 'combined', ?, ?, ?)
      `, [deviceId, condition === 'FAULT' ? 'high' : 'medium', buildConditionMessage(temp, vib, condition), ts]);
    }
  }

  console.log('[SEED] Done. Log in to the dashboard to view the demo data.');
  await db.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('[SEED] Failed:', err.message);
  process.exit(1);
});