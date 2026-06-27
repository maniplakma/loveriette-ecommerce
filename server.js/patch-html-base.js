const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'index.html');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const fp = path.join(dir, f);
  let h = fs.readFileSync(fp, 'utf8');
  if (/<base\s/i.test(h)) {
    console.log('skip', f);
    continue;
  }
  h = h.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n  <base href="/">`);
  fs.writeFileSync(fp, h);
  console.log('patched', f);
}
