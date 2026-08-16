# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single Node.js/Express app (the "loveriette" e-commerce + platform site). There is no build step and no frontend bundler — the frontend is static files served directly by Express.

### Layout gotcha
- The Express server code lives in the directory `server.js/` and the entrypoint is `server.js/server.js` (note: `server.js` is a directory, not a file).
- The static frontend lives in the directory `index.html/` (also a directory, not a file). Its entry page is `index.html/index.html`.
- The database is SQLite via Node's built-in `node:sqlite` (`DatabaseSync`), so **Node 22+ is required** and no native module compilation is needed. The DB file `server.js/ecom.db` is created/seeded automatically on first start and is gitignored.

### Env
- Copy `.env.example` to `.env` for local dev. Keep `NODE_ENV=development` locally so a dev `SESSION_SECRET` fallback is used (production requires a real `SESSION_SECRET`). Default `PORT` is 3000.
- `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env` only seed the admin user when the DB has no admin (first boot). After seeding, changing them has no effect.

### Run / test / lint (standard commands are in `package.json`)
- Start the dev server: `npm start` (runs `node server.js/server.js`). No watcher/hot-reload is configured; restart the process after code changes.
- Tests are HTTP smoke/e2e suites that require the server to already be running on `TEST_BASE` (defaults to `http://127.0.0.1:3000`). Start the server first, then run `npm run test:platform`, `npm run test:e2e`, `npm run test:audit`, `npm run test:workflows`, or `npm run test:qa` (all four). Pass `TEST_ADMIN_PASSWORD=<the .env ADMIN_PASSWORD>` so the admin-login-based tests can authenticate.
- There is **no lint script and no ESLint config** in this repo — "lint" is not applicable.
- `npm run build` runs `scripts/prepare-production.js` (verifies Node 22+, checks required files, creates `logs/` + upload dirs). It is not a real compile/bundle step.

### Known non-blocking test failures in a clean env
- The Telegram-backed "plugging" feature needs external Telegram API credentials/sessions. `test:audit`'s `workspace unlock` case returns 500 without them, and `test:workflows` has a flaky `dropped label` stock-state assertion. Core storefront/platform/e2e flows pass. These are unrelated to environment setup.
