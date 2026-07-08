'use strict';

const crypto = require('crypto');
const appConfig = require('./config');
const { encrypt, decrypt } = require('./token-crypto');
const { expiresAtIso } = require('./gmail-schema');

const GMAIL_SCOPE = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
].join(' ');

function oauthConfigured() {
  return !!(appConfig.googleClientId && appConfig.googleClientSecret);
}

function getRedirectUri() {
  if (appConfig.googleRedirectUri) return appConfig.googleRedirectUri;
  if (appConfig.publicUrl) return `${appConfig.publicUrl}/auth/google/callback`;
  return `http://127.0.0.1:${appConfig.port}/auth/google/callback`;
}

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: appConfig.googleClientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function createOAuthState() {
  return crypto.randomBytes(24).toString('hex');
}

async function exchangeCodeForTokens(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: appConfig.googleClientId,
      client_secret: appConfig.googleClientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code'
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || 'OAuth token exchange failed');
  return json;
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appConfig.googleClientId,
      client_secret: appConfig.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || 'Token refresh failed');
  return json;
}

async function fetchGoogleEmail(accessToken) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || 'Could not read Gmail profile');
  return json.emailAddress || '';
}

function saveGmailConnection(db, { email, accessToken, refreshToken, expiresIn, adminUserId, label }) {
  const tokenExpiry = expiresIn
    ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
    : null;
  const expiresAt = expiresAtIso(30);
  db.prepare(`
    INSERT INTO gmail_connections
      (connected_email, access_token_enc, refresh_token_enc, token_expiry, label, is_active, connected_by, expires_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(connected_email) DO UPDATE SET
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      token_expiry = excluded.token_expiry,
      label = excluded.label,
      is_active = 1,
      connected_by = excluded.connected_by,
      expires_at = excluded.expires_at
  `).run(
    email,
    encrypt(accessToken),
    encrypt(refreshToken || ''),
    tokenExpiry,
    label || email,
    adminUserId || null,
    expiresAt
  );
  return db.prepare('SELECT * FROM gmail_connections WHERE connected_email = ?').get(email);
}

async function getValidAccessToken(db, connectionRow) {
  if (!connectionRow) throw new Error('No Gmail connection configured');
  let accessToken = decrypt(connectionRow.access_token_enc);
  const refreshToken = decrypt(connectionRow.refresh_token_enc);
  const expiry = connectionRow.token_expiry ? new Date(connectionRow.token_expiry).getTime() : 0;
  const needsRefresh = !accessToken || (expiry && expiry <= Date.now() + 60_000);

  if (needsRefresh) {
    if (!refreshToken) throw new Error('Gmail refresh token missing — reconnect Gmail in admin');
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    const tokenExpiry = refreshed.expires_in
      ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
      : connectionRow.token_expiry;
    db.prepare(`
      UPDATE gmail_connections SET access_token_enc = ?, token_expiry = ? WHERE id = ?
    `).run(encrypt(accessToken), tokenExpiry, connectionRow.id);
  }
  return accessToken;
}

module.exports = {
  GMAIL_SCOPE,
  oauthConfigured,
  getRedirectUri,
  buildAuthUrl,
  createOAuthState,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchGoogleEmail,
  saveGmailConnection,
  getValidAccessToken
};
