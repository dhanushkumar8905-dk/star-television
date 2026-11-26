// src/passwords.js - password hashing (never store plain-text passwords)
const crypto = require('crypto');

function newAdmin(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { username: 'admin', salt, hash, isDefault: true };
}

function checkPassword(password, admin) {
  const h = crypto.scryptSync(String(password), admin.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(admin.hash, 'hex'));
}

module.exports = { newAdmin, checkPassword };
