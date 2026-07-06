'use strict';
process.chdir('/var/www/ecommerce');
const db = require('../server.js/db');
const fs = require('fs');
const path = require('path');

const r = db.resetWebsiteData();
const dirs = [
  'server.js/uploads/receipts',
  'server.js/uploads/report-proofs',
  'server.js/uploads/avatars'
];
for (const d of dirs) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (f === '.gitkeep') continue;
    try { fs.unlinkSync(path.join(d, f)); } catch (_) { /* ignore */ }
  }
}
console.log(JSON.stringify({ ok: true, adminEmail: r.adminEmail }));
