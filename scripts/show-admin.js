'use strict';

/** Show admin email(s) in DB — password cannot be recovered (hashed). */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function loadEnvFile() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] == null) process.env[key] = val;
  }
}

loadEnvFile();

const db = require(path.join(root, 'server.js', 'db.js'));

const admins = db.prepare('SELECT id, email, name FROM users WHERE is_admin = 1').all();
console.log('Admins in database:');
admins.forEach((a) => console.log('  ' + a.email + ' (' + a.name + ')'));

console.log('');
console.log('.env seed values (used by npm run reset-admin):');
console.log('  ADMIN_EMAIL=' + (process.env.ADMIN_EMAIL || '(not set)'));
console.log('  ADMIN_PASSWORD=' + (process.env.ADMIN_PASSWORD ? '(set — hidden)' : '(not set)'));
