'use strict';
/** Strip lending nav links from all HTML — run once after lending module removal */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'index.html');

const patterns = [
  /\s*<li><a href="\/lending" class="nav-link">Lending<\/a><\/li>\s*/gi,
  /\s*<li><a href="lending\.html" class="nav-link">Lending<\/a><\/li>\s*/gi,
  /<link rel="stylesheet" href="welcome-topup\.css[^"]*">\s*/gi,
  /<link rel="stylesheet" href="site-decorations\.css[^"]*">\s*/gi,
  /\s*<script src="welcome-topup\.js[^"]*"><\/script>\s*/gi,
  /\s*<script src="platform-closed\.js[^"]*"><\/script>\s*/gi,
  /\s*<script src="lending\.js[^"]*"><\/script>\s*/gi,
  /\s*<script src="lending-apply\.js[^"]*"><\/script>\s*/gi,
];

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const fp = path.join(dir, file);
  let html = fs.readFileSync(fp, 'utf8');
  const before = html;
  patterns.forEach((p) => { html = html.replace(p, '\n'); });
  if (html !== before) {
    fs.writeFileSync(fp, html);
    console.log('cleaned', file);
  }
}

console.log('done');
