// src/routes/customer.js - everything the ANDROID APP calls  (/api/customer/...)
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const { today, isMobile, cleanText, withPackage, recordPayment } = require('../helpers');

const router = express.Router();

// ---------- OTP login ----------
const otps = new Map(); // mobile -> { otp, expires, tries, sentAt }

function sendOtpSms(mobile, otp) {
  // TODO (real SMS): call your SMS provider here (MSG91, Twilio, Fast2SMS, Firebase...),
  // then start the server with STAR_TV_SMS=1 so the OTP is no longer sent back to the app.
  console.log(`[OTP] ${mobile} -> ${otp}  (valid 5 minutes)`);
}

router.post('/request-otp', (req, res) => {
  const mobile = String((req.body || {}).mobile || '').trim();
  if (!isMobile(mobile)) return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number' });
  const d = db.load();
  const c = d.customers.find(x => x.mobile === mobile);
  if (!c) return res.status(404).json({ success: false, message: 'No account found for this mobile number' });
  if (c.status !== 'Active') return res.status(403).json({ success: false, message: 'Your account is inactive. Please contact Star Television.' });
  const old = otps.get(mobile);
  if (old && Date.now() - old.sentAt < 30000) return res.status(429).json({ success: false, message: 'Please wait 30 seconds before asking for another OTP' });
  const otp = String(crypto.randomInt(100000, 1000000));
  otps.set(mobile, { otp, expires: Date.now() + 5 * 60 * 1000, tries: 0, sentAt: Date.now() });
  sendOtpSms(mobile, otp);
  res.json({ success: true, message: 'OTP sent', devOtp: config.DEMO_OTP ? otp : undefined });
});

router.post('/verify-otp', (req, res) => {
  const { mobile, otp } = req.body || {};
  const key = String(mobile || '');
  const rec = otps.get(key);
  if (!rec || rec.expires < Date.now()) return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
  if (rec.tries >= 5) { otps.delete(key); return res.status(429).json({ success: false, message: 'Too many wrong attempts. Request a new OTP.' }); }
  rec.tries++;
  if (String(otp || '') !== rec.otp) return res.status(400).json({ success: false, message: 'Wrong OTP. Please try again.' });
  otps.delete(key);
  const d = db.load();
  const c = d.customers.find(x => x.mobile === key);
  if (!c) return res.status(404).json({ success: false, message: 'No account found' });
  if (c.status !== 'Active') return res.status(403).json({ success: false, message: 'Your account is inactive. Please contact Star Television.' });
  res.json({ success: true, token: auth.signToken({ role: 'customer', id: c.id }, 24 * 30), customer: withPackage(d, c) });
});

// ---------- Logged-in customer only, and only their OWN data ----------
router.use('/me', auth.customerAuth);

router.get('/me', (req, res) => res.json(withPackage(req.data, req.customer)));

router.get('/me/bills', (req, res) => {
  res.json(req.data.bills.filter(b => b.customerId === req.customer.id).reverse());
});

router.post('/me/bills/:id/pay', (req, res) => {
  const d = req.data;
  const bill = d.bills.find(b => b.id === Number(req.params.id) && b.customerId === req.customer.id);
  if (!bill) return res.status(404).json({ message: 'Bill not found' });
  if (bill.status === 'Paid') return res.status(400).json({ message: 'This bill is already paid' });
  const method = (req.body || {}).method;
  if (!['UPI', 'Card', 'Net Banking'].includes(method)) return res.status(400).json({ message: 'Choose a payment method' });
  // DEMO: the payment is simulated. With a real gateway (Razorpay etc.) call this
  // only AFTER the gateway confirms the payment on the server side.
  recordPayment(d, bill, method, 'Customer app');
  db.save(d);
  res.json(bill);
});

router.get('/me/payments', (req, res) => {
  const d = req.data;
  res.json(d.payments.filter(p => p.customerId === req.customer.id).reverse().map(p => {
    const b = d.bills.find(x => x.id === p.billId);
    return { ...p, billMonth: b ? b.month : '' };
  }));
});

router.get('/me/complaints', (req, res) => {
  res.json(req.data.complaints.filter(c => c.customerId === req.customer.id).reverse());
});

router.post('/me/complaints', (req, res) => {
  const d = req.data;
  const text = cleanText((req.body || {}).text, 500);
  if (text.length < 3) return res.status(400).json({ message: 'Please describe the problem' });
  const c = { id: d.nextComplaintId++, customerId: req.customer.id, text, status: 'Pending', date: today() };
  d.complaints.push(c);
  db.save(d);
  res.json(c);
});

module.exports = router;
