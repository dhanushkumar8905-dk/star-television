// src/config.js - ALL settings live here. Change them in the .env file, not in code.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Tiny .env reader (no extra package needed): lines like  KEY=value
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v; // real environment wins over .env
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

module.exports = {
  VERSION: require('../package.json').version,
  ROOT,
  PORT: Number(process.env.PORT) || 3000,

  // true  = demo mode: the OTP is shown in the app and printed in the console
  // false = real SMS mode (set STAR_TV_SMS=1 after connecting an SMS provider)
  DEMO_OTP: process.env.STAR_TV_SMS !== '1',

  DATA_DIR,
  DATA_FILE: path.join(DATA_DIR, 'data.json'),
  BACKUP_DIR: path.join(DATA_DIR, 'backups'),
  BACKUP_KEEP_DAYS: Number(process.env.BACKUP_KEEP_DAYS) || 30,
  USING_CUSTOM_DATA_DIR: !!process.env.DATA_DIR,
  LEGACY_DATA_FILE: path.join(ROOT, 'data.json'), // where v1/v2.0 kept the data

  // Only used when a brand-new data file is created
  INITIAL_ADMIN_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD || 'star123'
};
