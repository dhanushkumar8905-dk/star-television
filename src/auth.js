// src/auth.js - login tokens, password checks, and the "who is allowed in" middleware
const crypto = require('crypto');
const db = require('./db');
const { checkPassword } = require('./passwords');

let secretCache = null;
const secret = () => secretCache || (secretCache = db.load().secret);

function signToken(payload, hours) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + hours * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

function adminAuth(req, res, next) {
  const p = readToken(bearer(req));
  if (!p || p.role !== 'admin') return res.status(401).json({ message: 'Please log in again' });
  next();
}

function customerAuth(req, res, next) {
  const p = readToken(bearer(req));
  if (!p || p.role !== 'customer') return res.status(401).json({ message: 'Please log in again' });
  const d = db.load();
  const c = d.customers.find(x => x.id === p.id);
  if (!c) return res.status(401).json({ message: 'Please log in again' });
  if (c.status !== 'Active') return res.status(403).json({ message: 'Your account is inactive. Please contact Star Television.' });
  req.data = d;
  req.customer = c;
  next();
}

// 5 wrong password tries => 10 minute lock (per IP address)
const failedLogins = new Map();
const lockedOut = key => { const f = failedLogins.get(key); return !!f && f.count >= 5 && f.until > Date.now(); };
function noteFail(key) {
  const f = failedLogins.get(key);
  if (!f || f.until < Date.now()) failedLogins.set(key, { count: 1, until: Date.now() + 10 * 60 * 1000 });
  else f.count++;
}
const clearFails = key => failedLogins.delete(key);

module.exports = { signToken, readToken, adminAuth, customerAuth, checkPassword, lockedOut, noteFail, clearFails };
