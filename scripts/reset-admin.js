'use strict';

/**
 * Reset admin login from .env values (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME).
 * Usage on VPS:
 *   cd /var/www/ecommerce
 *   npm run reset-admin
 *
 * Edit .env first with nano, then run this — no long paste needed.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');

function loadEnvFile() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env — copy .env.example first.');
    process.exit(1);
  }
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

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const name = process.env.ADMIN_NAME || 'Site Admin';

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
  process.exit(1);
}

const dbPath = path.join(root, 'server.js', 'db.js');
delete require.cache[require.resolve(dbPath)];
const db = require(dbPath);

const hash = bcrypt.hashSync(password, 10);
const existing = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();

if (existing) {
  db.prepare('UPDATE users SET email = ?, password_hash = ?, name = ?, is_admin = 1 WHERE id = ?')
    .run(email, hash, name, existing.id);
  console.log('Admin updated.');
} else {
  db.prepare('INSERT INTO users (email, password_hash, name, is_admin) VALUES (?, ?, ?, 1)')
    .run(email, hash, name);
  console.log('Admin created.');
}

console.log('Login with:');
console.log('  Email:   ' + email);
console.log('  Password: (value of ADMIN_PASSWORD in .env)');
