const slug = location.pathname.split('/').pop();
let packageId = null;

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

async function loadPackage() {
  const p = await fetch('/api/website-making/packages/' + encodeURIComponent(slug)).then((r) => r.json());
  if (p.error) {
    document.getElementById('pkg-content').innerHTML = '<p>Package not found.</p>';
    return;
  }
  packageId = p.id;
  document.title = `${p.name} — loveriette`;
  if (window.applySeoMeta) applySeoMeta({ title: document.title, description: p.description, url: p.shareUrl });

  document.getElementById('pkg-content').innerHTML = `
    <a href="/website-making">← All Packages</a>
    <h1>${esc(p.name)}</h1>
    <div class="package-price">${esc(p.priceLabel || '₱' + Number(p.price).toLocaleString())}</div>
    <p>${esc(p.longDescription || p.description)}</p>
    <ul class="package-features">${(p.features||[]).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <div class="package-actions">
      <button type="button" class="btn-primary-platform" id="order-btn">Order Now</button>
      <button type="button" class="btn-outline-platform" id="inquiry-btn">Send Inquiry</button>
    </div>`;

  if (window.renderShareButtons) renderShareButtons(document.getElementById('pkg-share'), p.shareUrl, p.name);

  document.getElementById('inquiry-btn').addEventListener('click', () => {
    document.getElementById('inquiry-modal').showModal();
  });

  document.getElementById('order-btn').addEventListener('click', () => {
    document.getElementById('inquiry-modal').showModal();
    document.querySelector('#inquiry-form textarea').value = `I would like to order the ${p.name} package.`;
  });
}

document.getElementById('inquiry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { packageId, name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), message: fd.get('message') };
  try {
    const res = await fetch('/api/website-making/inquiry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    document.getElementById('inquiry-modal').close();
    const pkgName = document.querySelector('#pkg-content h1')?.textContent || 'Website package';
    location.href = `order-thanks.html?type=website&package=${encodeURIComponent(pkgName)}`;
  } catch (err) {
    if (window.showToast) showToast(err.message || 'Failed to send');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initPlatformNav('website');
  loadPackage().catch(() => {});
});
