'use strict';

const fs = require('fs');
const path = require('path');

const serverDir = path.resolve(__dirname);
const appRoot = process.env.APP_ROOT
  ? path.resolve(process.env.APP_ROOT)
  : path.resolve(serverDir, '..');

(function loadEnvFile() {
  const envPath = path.join(appRoot, '.env');
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
})();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT) || 3000,
  // 0.0.0.0 = listen on all interfaces (external access via VPS IP:PORT)
  host: process.env.HOST || '0.0.0.0',
  publicUrl: String(process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  appRoot,
  serverDir,
  frontendDir: process.env.FRONTEND_DIR
    ? path.resolve(process.env.FRONTEND_DIR)
    : path.join(appRoot, 'index.html'),
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(serverDir, 'ecom.db'),
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(serverDir, 'uploads'),
  brandingUploadsDir: process.env.BRANDING_UPLOADS_DIR
    ? path.resolve(process.env.BRANDING_UPLOADS_DIR)
    : path.join(appRoot, 'index.html', 'uploads'),
  logDir: process.env.LOG_DIR
    ? path.resolve(process.env.LOG_DIR)
    : path.join(appRoot, 'logs'),
  sessionSecret: process.env.SESSION_SECRET || '',
  cookieSecure: process.env.COOKIE_SECURE === '1',
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'Site Admin',
  plugMasterKey: process.env.PLUG_MASTER_KEY || '',
  testBase: process.env.TEST_BASE || '',
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '12mb',
  defaultSocialLinksJson: process.env.DEFAULT_SOCIAL_LINKS_JSON || JSON.stringify([
    { key: 'telegram', label: 'Telegram', url: 'https://t.me/skyloverie', enabled: true },
    { key: 'email', label: 'Email', url: 'mailto:riettemadzehn@gmail.com', enabled: true },
    { key: 'channel', label: 'Telegram Channel', url: 'https://t.me/lovebyriette', enabled: true }
  ]),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
};

function resolveSessionSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  if (config.isProduction) {
    throw new Error('SESSION_SECRET is required when NODE_ENV=production');
  }
  return 'dev-insecure-session-secret-change-me';
}

function resolveTestBase() {
  const base = config.testBase || `http://127.0.0.1:${config.port}`;
  return base.replace(/\/$/, '');
}

function parseDefaultSocialLinks() {
  const raw = config.defaultSocialLinksJson.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ensurePortableDirs() {
  const dirs = [
    config.logDir,
    config.uploadsDir,
    path.join(config.uploadsDir, 'avatars'),
    path.join(config.uploadsDir, 'receipts'),
    path.join(config.uploadsDir, 'report-proofs'),
    path.join(config.uploadsDir, 'payment-qr'),
    config.brandingUploadsDir,
    path.dirname(config.dbPath),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  ...config,
  resolveSessionSecret,
  resolveTestBase,
  parseDefaultSocialLinks,
  ensurePortableDirs,
};
