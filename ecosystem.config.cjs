/**
 * PM2 process file — paths resolve from this file location (portable).
 * All runtime values (PORT, HOST, secrets) come from .env via --env-file.
 *
 * Start: pm2 start ecosystem.config.cjs --env production
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'ecommerce',
      script: path.join(__dirname, 'server.js', 'server.js'),
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY || '512M',
      time: true,
      merge_logs: true,
      out_file: path.join(__dirname, 'logs', 'out.log'),
      error_file: path.join(__dirname, 'logs', 'err.log'),
      node_args: '--env-file=.env',
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
