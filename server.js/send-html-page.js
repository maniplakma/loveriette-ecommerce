'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Serve an HTML page with <base href="/"> so relative CSS/JS resolve from site root
 * on nested pretty URLs (/product/foo, /plugging/plan/bar, etc.).
 */
function sendHtmlPage(res, frontendDir, filename) {
  const filePath = path.join(frontendDir, filename);
  let html = fs.readFileSync(filePath, 'utf8');
  if (!/<base\s[^>]*href\s*=/i.test(html)) {
    html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n  <base href="/">`);
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

function isInvalidPageSlug(slug) {
  const s = String(slug || '').trim();
  return !s || s.includes('.') || s === 'style.css' || s === 'favicon.ico';
}

module.exports = { sendHtmlPage, isInvalidPageSlug };
