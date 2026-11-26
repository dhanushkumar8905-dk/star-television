// src/db.js - the "database": reads/writes data/data.json, upgrades old data,
// and keeps automatic backups. To move to PostgreSQL/SQLite later, only this
// file (plus the routes that call load()/save()) needs to change.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { newAdmin } = require('./passwords');

function seed() {
  return {
    secret: crypto.randomBytes(32).toString('hex'),
    admin: newAdmin(config.INITIAL_ADMIN_PASSWORD),
    packages: [
      { id: 1, name: 'Silver Pack', channels: 80, price: 250, active: true },
      { id: 2, name: 'Gold Pack', channels: 150, price: 350, active: true },
      { id: 3, name: 'Platinum Pack', channels: 250, price: 500, active: true }
    ],
    customers: [
      { id: 1, name: 'Ramesh Kumar', mobile: '9876543210', address: '12 Main Street, Salem', packageId: 2, status: 'Active' },
      { id: 2, name: 'Priya Devi', mobile: '9876543211', address: '45 Lake Road, Salem', packageId: 1, status: 'Active' }
    ],
    bills: [
      { id: 1, customerId: 1, amount: 350, month: 'September 2026', status: 'Unpaid' },
      { id: 2, customerId: 1, amount: 350, month: 'August 2026', status: 'Paid', paidDate: '2026-08-05' },
      { id: 3, customerId: 2, amount: 250, month: 'September 2026', status: 'Unpaid' }
    ],
    payments: [
      { id: 1, billId: 2, customerId: 1, amount: 350, method: 'Cash', date: '2026-08-05', txnId: 'ST-SEED-1', source: 'Operator' }
    ],
    complaints: [
      { id: 1, customerId: 1, text: 'No signal since morning', status: 'Pending', date: '2026-09-28' }
    ],
    nextCustomerId: 3, nextBillId: 4, nextComplaintId: 2, nextPaymentId: 2, nextPackageId: 4
  };
}

// Upgrades an older data file (v1) to the current shape. Safe to run every start.
function migrate(d) {
  let changed = false;
  if (!d.secret) { d.secret = crypto.randomBytes(32).toString('hex'); changed = true; }
  if (!d.admin) { d.admin = newAdmin(config.INITIAL_ADMIN_PASSWORD); changed = true; }
  if (!d.payments) { d.payments = []; changed = true; }
  if (!d.nextPaymentId) { d.nextPaymentId = d.payments.reduce((m, p) => Math.max(m, p.id), 0) + 1; changed = true; }
  if (!d.packages) {
    d.packages = []; d.nextPackageId = 1; changed = true;
    for (const c of d.customers) {
      if (c.packageId || !c.package) continue;
      const name = String(c.package).split(' - ')[0].trim() || 'Basic Pack';
      const channels = parseInt((String(c.package).match(/(\d+)\+?\s*Channels/i) || [])[1], 10) || 0;
      let p = d.packages.find(x => x.name === name);
      if (!p) {
        const bills = d.bills.filter(b => b.customerId === c.id);
        const price = bills.length ? bills[bills.length - 1].amount : 0;
        p = { id: d.nextPackageId++, name, channels, price, active: true };
        d.packages.push(p);
      }
      c.packageId = p.id;
    }
  }
  if (!d.nextPackageId) { d.nextPackageId = d.packages.reduce((m, p) => Math.max(m, p.id), 0) + 1; changed = true; }
  for (const c of d.customers) {
    if ('package' in c) { delete c.package; changed = true; }
  }
  for (const b of d.bills) {
    if (b.status === 'Paid' && !d.payments.some(p => p.billId === b.id)) {
      d.payments.push({
        id: d.nextPaymentId++, billId: b.id, customerId: b.customerId, amount: b.amount,
        method: 'Recorded earlier', date: b.paidDate || '', txnId: 'ST-OLD-' + b.id, source: 'Operator'
      });
      changed = true;
    }
  }
  return changed;
}

function load() { return JSON.parse(fs.readFileSync(config.DATA_FILE, 'utf8')); }

function save(d) {
  // write to a temp file first, then rename, so a crash can't leave a half-written file
  const tmp = config.DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, config.DATA_FILE);
}

// ---------------- backups ----------------
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

// backup()               -> data/backups/data-2026-10-10.json   (one per day, newest state wins)
// backup('before-upgrade') -> data/backups/data-before-upgrade-<time>.json (kept forever)
function backup(label) {
  if (!fs.existsSync(config.DATA_FILE)) return null;
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
  const name = label ? `data-${label}-${stamp()}.json` : `data-${new Date().toISOString().slice(0, 10)}.json`;
  const target = path.join(config.BACKUP_DIR, name);
  fs.copyFileSync(config.DATA_FILE, target);
  if (!label) pruneBackups();
  return target;
}

function pruneBackups() {
  const limit = Date.now() - config.BACKUP_KEEP_DAYS * 86400000;
  for (const f of fs.readdirSync(config.BACKUP_DIR)) {
    const m = f.match(/^data-(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && Date.parse(m[1]) < limit) fs.unlinkSync(path.join(config.BACKUP_DIR, f));
  }
}

// What the operator downloads: all business data, but NOT the login secret or password hash
function exportData() {
  const { secret, admin, ...rest } = load();
  return { exportedAt: new Date().toISOString(), version: config.VERSION, data: rest };
}

// Used by scripts/restore.js: replaces business data, keeps this server's secret + admin password
function restore(input) {
  const incoming = input && input.data ? input.data : input;
  for (const k of ['customers', 'packages', 'bills', 'payments', 'complaints']) {
    if (!incoming || !Array.isArray(incoming[k])) throw new Error('Not a valid backup file (missing "' + k + '")');
  }
  const current = fs.existsSync(config.DATA_FILE) ? load() : {};
  const next = { ...incoming };
  next.secret = current.secret || incoming.secret;
  next.admin = current.admin || incoming.admin;
  migrate(next);
  save(next);
}

function init() {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });

  if (!fs.existsSync(config.DATA_FILE)) {
    if (!config.USING_CUSTOM_DATA_DIR && fs.existsSync(config.LEGACY_DATA_FILE)) {
      fs.copyFileSync(config.LEGACY_DATA_FILE, config.DATA_FILE);
      console.log('Copied your existing data.json into the data/ folder (the old file is left untouched as an extra backup).');
    } else {
      save(seed());
      console.log('Created a new data file with sample customers.');
    }
  }
  const d = load();
  if (migrate(d)) {
    backup('before-upgrade');
    save(d);
    console.log('Data file upgraded to the latest format (a copy of the old one is in data/backups).');
  }
  backup();
}

function scheduleBackups() {
  setInterval(() => { try { backup(); } catch (e) { console.error('Backup failed:', e.message); } }, 6 * 3600 * 1000).unref();
}

module.exports = { init, load, save, backup, exportData, restore, scheduleBackups };
