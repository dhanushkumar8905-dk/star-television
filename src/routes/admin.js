// src/routes/admin.js - everything the OPERATOR DASHBOARD calls  (/api/admin/...)
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { newAdmin } = require('../passwords');
const { today, pkgLabel, isMobile, posInt, cleanText, MONTH_RE, withPackage, recordPayment } = require('../helpers');

const router = express.Router();

// ---------- Public: login ----------
router.post('/login', (req, res) => {
  const key = req.ip || 'unknown';
  if (auth.lockedOut(key)) return res.status(429).json({ success: false, message: 'Too many attempts. Try again in 10 minutes.' });
  const { username, password } = req.body || {};
  const a = db.load().admin;
  if (username === a.username && password && auth.checkPassword(password, a)) {
    auth.clearFails(key);
    return res.json({ success: true, token: auth.signToken({ role: 'admin' }, 12), mustChangePassword: !!a.isDefault });
  }
  auth.noteFail(key);
  res.status(401).json({ success: false, message: 'Invalid username or password' });
});

// ---------- Everything below needs the admin token ----------
router.use(auth.adminAuth);

router.post('/change-password', (req, res) => {
  const d = db.load();
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !auth.checkPassword(currentPassword, d.admin)) return res.status(400).json({ message: 'Current password is wrong' });
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });
  d.admin = { ...newAdmin(String(newPassword)), isDefault: false };
  db.save(d);
  res.json({ success: true });
});

router.get('/me', (req, res) => res.json({ isDefaultPassword: !!db.load().admin.isDefault }));

// Download all business data as a file (no passwords/secrets inside)
router.get('/backup', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="star-tv-backup-${today()}.json"`);
  res.json(db.exportData());
});

// ---------- Overview ----------
router.get('/summary', (req, res) => {
  const d = db.load();
  const month = today().slice(0, 7);
  const unpaid = d.bills.filter(b => b.status === 'Unpaid');
  res.json({
    totalCustomers: d.customers.length,
    activeCustomers: d.customers.filter(c => c.status === 'Active').length,
    unpaidCount: unpaid.length,
    unpaidAmount: unpaid.reduce((s, b) => s + b.amount, 0),
    collectedThisMonth: d.payments.filter(p => String(p.date).startsWith(month)).reduce((s, p) => s + p.amount, 0),
    collectedTotal: d.payments.reduce((s, p) => s + p.amount, 0),
    pendingComplaints: d.complaints.filter(c => c.status === 'Pending').length
  });
});

// ---------- Packages ----------
router.get('/packages', (req, res) => {
  const d = db.load();
  res.json(d.packages.map(p => ({
    ...p, label: pkgLabel(p), customers: d.customers.filter(c => c.packageId === p.id).length
  })));
});

function readPackage(body) {
  const name = cleanText(body.name, 40);
  if (!name) return { error: 'Package name is required' };
  if (!posInt(body.channels)) return { error: 'Channels must be a whole number above 0' };
  if (!posInt(body.price)) return { error: 'Monthly price must be a whole number above 0' };
  return { name, channels: Number(body.channels), price: Number(body.price) };
}

router.post('/packages', (req, res) => {
  const d = db.load();
  const v = readPackage(req.body || {});
  if (v.error) return res.status(400).json({ message: v.error });
  const p = { id: d.nextPackageId++, ...v, active: true };
  d.packages.push(p);
  db.save(d);
  res.json(p);
});

router.put('/packages/:id', (req, res) => {
  const d = db.load();
  const p = d.packages.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ message: 'Package not found' });
  const v = readPackage(req.body || {});
  if (v.error) return res.status(400).json({ message: v.error });
  Object.assign(p, v);
  if (typeof req.body.active === 'boolean') p.active = req.body.active;
  db.save(d);
  res.json(p);
});

// ---------- Customers ----------
router.get('/customers', (req, res) => {
  const d = db.load();
  res.json(d.customers.map(c => ({
    ...withPackage(d, c),
    outstanding: d.bills.filter(b => b.customerId === c.id && b.status === 'Unpaid').reduce((s, b) => s + b.amount, 0)
  })));
});

function readCustomer(d, body, selfId) {
  const name = cleanText(body.name, 60);
  const mobile = String(body.mobile || '').trim();
  const address = cleanText(body.address, 160);
  const packageId = Number(body.packageId);
  if (!name) return { error: 'Name is required' };
  if (!isMobile(mobile)) return { error: 'Mobile must be exactly 10 digits' };
  if (d.customers.some(c => c.mobile === mobile && c.id !== selfId)) return { error: 'Another customer already uses this mobile number' };
  if (!d.packages.some(p => p.id === packageId)) return { error: 'Please choose a package' };
  return { name, mobile, address, packageId };
}

router.post('/customers', (req, res) => {
  const d = db.load();
  const v = readCustomer(d, req.body || {}, null);
  if (v.error) return res.status(400).json({ message: v.error });
  const c = { id: d.nextCustomerId++, ...v, status: 'Active' };
  d.customers.push(c);
  db.save(d);
  res.json(withPackage(d, c));
});

router.put('/customers/:id', (req, res) => {
  const d = db.load();
  const c = d.customers.find(x => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ message: 'Customer not found' });
  const v = readCustomer(d, req.body || {}, c.id);
  if (v.error) return res.status(400).json({ message: v.error });
  Object.assign(c, v);
  db.save(d);
  res.json(withPackage(d, c));
});

router.put('/customers/:id/status', (req, res) => {
  const d = db.load();
  const c = d.customers.find(x => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ message: 'Customer not found' });
  const status = req.body && req.body.status;
  if (status !== 'Active' && status !== 'Inactive') return res.status(400).json({ message: 'Status must be Active or Inactive' });
  c.status = status;
  db.save(d);
  res.json(withPackage(d, c));
});

// ---------- Bills ----------
router.get('/bills', (req, res) => {
  const d = db.load();
  res.json(d.bills.map(b => {
    const c = d.customers.find(x => x.id === b.customerId);
    return { ...b, customerName: c ? c.name : 'Unknown' };
  }));
});

router.post('/bills', (req, res) => {
  const d = db.load();
  const { customerId, month } = req.body || {};
  const c = d.customers.find(x => x.id === Number(customerId));
  if (!c) return res.status(400).json({ message: 'Choose a customer' });
  if (!MONTH_RE.test(String(month || ''))) return res.status(400).json({ message: 'Month looks like "October 2026"' });
  if (d.bills.some(b => b.customerId === c.id && b.month === month)) return res.status(400).json({ message: 'This customer already has a bill for ' + month });
  const pkg = d.packages.find(p => p.id === c.packageId);
  const amount = req.body.amount === '' || req.body.amount == null ? (pkg ? pkg.price : 0) : Number(req.body.amount);
  if (!posInt(amount)) return res.status(400).json({ message: 'Amount must be a whole number above 0' });
  const bill = { id: d.nextBillId++, customerId: c.id, amount, month, status: 'Unpaid' };
  d.bills.push(bill);
  db.save(d);
  res.json(bill);
});

// One bill for every ACTIVE customer at their package price
router.post('/bills/generate-all', (req, res) => {
  const d = db.load();
  const month = (req.body || {}).month;
  if (!MONTH_RE.test(String(month || ''))) return res.status(400).json({ message: 'Month looks like "October 2026"' });
  let created = 0, skipped = 0;
  for (const c of d.customers) {
    const pkg = d.packages.find(p => p.id === c.packageId);
    const exists = d.bills.some(b => b.customerId === c.id && b.month === month);
    if (c.status !== 'Active' || !pkg || exists) { skipped++; continue; }
    d.bills.push({ id: d.nextBillId++, customerId: c.id, amount: pkg.price, month, status: 'Unpaid' });
    created++;
  }
  db.save(d);
  res.json({ created, skipped });
});

// Operator records a payment received outside the app (cash at the counter etc.)
router.put('/bills/:id/pay', (req, res) => {
  const d = db.load();
  const bill = d.bills.find(b => b.id === Number(req.params.id));
  if (!bill) return res.status(404).json({ message: 'Bill not found' });
  if (bill.status === 'Paid') return res.status(400).json({ message: 'This bill is already paid' });
  const method = (req.body || {}).method;
  if (!['Cash', 'UPI', 'Card', 'Net Banking', 'Cheque'].includes(method)) return res.status(400).json({ message: 'Choose a payment method' });
  const payment = recordPayment(d, bill, method, 'Operator');
  db.save(d);
  res.json({ bill, payment });
});

router.delete('/bills/:id', (req, res) => {
  const d = db.load();
  const i = d.bills.findIndex(b => b.id === Number(req.params.id));
  if (i < 0) return res.status(404).json({ message: 'Bill not found' });
  if (d.bills[i].status === 'Paid') return res.status(400).json({ message: 'A paid bill cannot be cancelled' });
  d.bills.splice(i, 1);
  db.save(d);
  res.json({ success: true });
});

// ---------- Payments & reports ----------
router.get('/payments', (req, res) => {
  const d = db.load();
  res.json(d.payments.slice().reverse().map(p => {
    const c = d.customers.find(x => x.id === p.customerId);
    const b = d.bills.find(x => x.id === p.billId);
    return { ...p, customerName: c ? c.name : 'Unknown', billMonth: b ? b.month : '' };
  }));
});

const monthStamp = m => { const t = Date.parse('1 ' + m); return isNaN(t) ? 0 : t; };

router.get('/reports/collection', (req, res) => {
  const d = db.load();
  const rows = {};
  for (const b of d.bills) {
    const r = rows[b.month] || (rows[b.month] = { month: b.month, bills: 0, paidBills: 0, billed: 0, collected: 0, outstanding: 0 });
    r.bills++; r.billed += b.amount;
    if (b.status === 'Paid') { r.paidBills++; r.collected += b.amount; } else { r.outstanding += b.amount; }
  }
  const months = Object.values(rows).sort((a, b) => monthStamp(b.month) - monthStamp(a.month));
  const dues = d.customers
    .map(c => {
      const unpaid = d.bills.filter(b => b.customerId === c.id && b.status === 'Unpaid');
      return { id: c.id, name: c.name, mobile: c.mobile, status: c.status, unpaidBills: unpaid.length, outstanding: unpaid.reduce((s, b) => s + b.amount, 0) };
    })
    .filter(x => x.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
  res.json({ months, dues });
});

// ---------- Complaints ----------
router.get('/complaints', (req, res) => {
  const d = db.load();
  res.json(d.complaints.slice().reverse().map(c => {
    const cu = d.customers.find(x => x.id === c.customerId);
    return { ...c, customerName: cu ? cu.name : 'Unknown', customerMobile: cu ? cu.mobile : '' };
  }));
});

router.put('/complaints/:id/resolve', (req, res) => {
  const d = db.load();
  const c = d.complaints.find(x => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ message: 'Complaint not found' });
  c.status = 'Resolved';
  c.resolvedDate = today();
  db.save(d);
  res.json(c);
});

module.exports = router;
