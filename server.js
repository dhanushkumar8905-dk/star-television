// server.js - the ENTRY POINT. It only wires things together.
//
//   src/config.js          settings (.env)
//   src/db.js              data file, upgrades, backups
//   src/auth.js            login tokens + who may enter
//   src/helpers.js         small shared functions
//   src/routes/admin.js    operator dashboard API   (/api/admin/...)
//   src/routes/customer.js Android app API          (/api/customer/...)
//   public/                the operator dashboard web pages
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./src/config');
const db = require('./src/db');

db.init();              // create/upgrade the data file and take a backup
db.scheduleBackups();   // and again every 6 hours while running

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(config.ROOT, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, version: config.VERSION }));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/customer', require('./src/routes/customer'));
app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }));

// Last safety net: bad JSON or an unexpected bug returns a clean error instead of crashing
app.use((err, req, res, next) => {
  if (err && err.status === 400) return res.status(400).json({ message: 'Bad request' });
  console.error(err);
  res.status(500).json({ message: 'Server error' });
});

app.listen(config.PORT, () => {
  console.log(`Star Television SERVER v${config.VERSION} running at http://localhost:${config.PORT}`);
  console.log(`Operator dashboard: http://localhost:${config.PORT}/login.html`);
  if (db.load().admin.isDefault) console.log('NOTE: admin password is still the default. Change it from the dashboard.');
});
