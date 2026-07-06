'use strict';

const appConfig = require('./config');

/**
 * Custom domain is considered connected when PUBLIC_URL is HTTPS
 * and points to a real hostname (not localhost or raw IP).
 */
function isCustomDomainConnected() {
  const raw = String(appConfig.publicUrl || '').trim();
  if (!raw) return false;
  let host;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host || host === 'localhost' || host.endsWith('.local')) return false;
  if (/^127\./.test(host) || /^0\.0\.0\.0$/.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (!host.includes('.')) return false;

  const expected = String(process.env.EXPECTED_PUBLIC_HOST || '').trim().toLowerCase();
  if (expected && host !== expected) return false;

  return true;
}

function gmailOAuthAllowed() {
  return isCustomDomainConnected();
}

function domainStatus() {
  const publicUrl = appConfig.publicUrl || '';
  return {
    publicUrl,
    domainConnected: isCustomDomainConnected(),
    gmailOAuthAllowed: gmailOAuthAllowed(),
    expectedHost: process.env.EXPECTED_PUBLIC_HOST || null
  };
}

module.exports = {
  isCustomDomainConnected,
  gmailOAuthAllowed,
  domainStatus
};
