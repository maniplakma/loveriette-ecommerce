const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const appConfig = require('./config');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
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

const port = process.argv[2] || String(appConfig.port);
const bindHost = process.env.TUNNEL_TARGET_HOST || '127.0.0.1';
const target = `http://${bindHost}:${port}`;

console.log(`Opening Cloudflare tunnel to ${target} ...`);
console.log('(Keep this window open while using the link on your phone)\n');

const child = spawn(
  'npx',
  ['--yes', 'cloudflared', 'tunnel', '--url', target],
  {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..')
  }
);

child.on('exit', (code) => process.exit(code ?? 0));
