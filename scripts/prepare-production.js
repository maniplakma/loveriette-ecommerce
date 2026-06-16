'use strict';

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

const appConfigPath = path.join(root, 'server.js', 'config.js');
delete require.cache[require.resolve(appConfigPath)];
const cfg = require(appConfigPath);

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  console.error(`Node.js ${process.versions.node} detected. Node 22+ is required (node:sqlite).`);
  process.exit(1);
}

console.log('Preparing production deployment…');
console.log(`  Node ${process.versions.node}`);

cfg.ensurePortableDirs();

const required = [
  path.join(root, 'package.json'),
  path.join(cfg.serverDir, 'server.js'),
  path.join(cfg.serverDir, 'db.js'),
  path.join(cfg.frontendDir, 'index.html'),
];

for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }
}

const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  console.warn('  warning: .env not found — copy .env.example to .env before starting');
} else if (cfg.isProduction && !process.env.SESSION_SECRET) {
  console.warn('  warning: SESSION_SECRET is empty — required when NODE_ENV=production');
}

console.log('  app root:', cfg.appRoot);
console.log('  database:', cfg.dbPath);
console.log('  uploads:', cfg.uploadsDir);
console.log('Production prepare complete.');
console.log('Next: npm ci --omit=dev && pm2 start ecosystem.config.cjs --env production');
