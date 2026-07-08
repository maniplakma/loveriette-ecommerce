const slug = location.pathname.split('/').pop();
let packageId = null;
let packageData = null;

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function categoryLabel(cat) {
  const map = {
    ecommerce: 'Ecommerce',
    'auto-order': 'Auto Order',
    rental: 'Rental',
    custom: 'Custom Build',
    business: 'Business',
    landing: 'Landing Page',
    'landing-page': 'Landing Page',
    maintenance: 'Maintenance'
  };
  return map[cat] || (cat ? String(cat).replace(/-/g, ' ') : 'Website Package');
}

function renderPackage(p) {
  packageId = p.id;
  packageData = p;
  const title = p.metaTitle || p.name;
  document.title = `${title} — loveriette`;
  if (window.applySeoMeta) {
    applySeoMeta({
      title: document.title,
      description: p.metaDescription || p.description || p.longDescription,
      image: p.ogImage || p.imageUrl,
      url: p.shareUrl
    });
  }

  const features = (p.features || []).map((f) => `<li>${esc(f)}</li>`).join('');
  const related = (p.relatedPackages || []).map((r) => `
    <a href="/website-making/${esc(r.slug)}" class="package-card package-card--compact">
      ${r.imageUrl ? `<div class="package-card-media"><img src="${esc(r.imageUrl)}" alt="" loading="lazy"></div>` : ''}
      <div class="package-card-body">
        <h3>${esc(r.name)}</h3>
        <p class="package-price">${esc(r.priceLabel || '₱' + Number(r.price).toLocaleString())}</p>
      </div>
    </a>`).join('');

  document.getElementById('pkg-content').innerHTML = `
    <div class="service-hero service-hero--flirty package-detail-hero">
      <a href="/website-making" class="back-explore">← All Packages</a>
      ${p.category ? `<span class="package-detail-badge">${esc(categoryLabel(p.category))}</span>` : ''}
      <h1 class="title-alt">${esc(p.name)}</h1>
      <p class="package-detail-price">${esc(p.priceLabel || '₱' + Number(p.price).toLocaleString())}</p>
      ${p.description ? `<p class="package-detail-lead">${esc(p.description)}</p>` : ''}
    </div>
    <div class="package-detail-grid">
      ${p.imageUrl ? `<div class="package-detail-media"><img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" loading="eager"></div>` : ''}
      <div class="package-detail-main">
        <section class="package-detail-section">
          <h2 class="title-alt">What's included</h2>
          <div class="package-detail-body">${esc(p.longDescription || p.description || 'Contact us for full package details.')}</div>
          ${features ? `<ul class="package-features">${features}</ul>` : ''}
        </section>
        <div class="package-actions package-detail-actions">
          <button type="button" class="btn-primary-platform" id="order-btn">Order Now</button>
          <button type="button" class="btn-outline-platform" id="inquiry-btn">Send Inquiry</button>
        </div>
      </div>
    </div>
    ${related ? `
      <section class="package-detail-related">
        <h2 class="title-alt">Other packages</h2>
        <div class="package-grid package-grid--related">${related}</div>
      </section>` : ''}`;

  if (window.renderShareButtons) {
    renderShareButtons(document.getElementById('pkg-share'), p.shareUrl, p.name);
  }

  const modal = document.getElementById('inquiry-modal');
  const titleEl = document.getElementById('inquiry-modal-title');

  document.getElementById('inquiry-btn').addEventListener('click', () => {
    if (titleEl) titleEl.textContent = 'Send Inquiry';
    modal.showModal();
  });
  document.getElementById('order-btn').addEventListener('click', () => {
    if (titleEl) titleEl.textContent = 'Order Package';
    modal.showModal();
    const ta = document.querySelector('#inquiry-form textarea');
    if (ta) ta.value = `I would like to order the ${p.name} package.`;
  });
}

async function fetchPackage(slugValue) {
  const url = '/api/website-making/packages/' + encodeURIComponent(slugValue);
  if (window.ApiCache?.fetchJson) {
    try {
      return await ApiCache.fetchJson(url, {}, 60000);
    } catch (e) {
      if (/not found/i.test(e.message || '')) return { error: 'Package not found' };
      throw e;
    }
  }
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || 'Package not found' };
  return data;
}

async function loadPackage() {
  const el = document.getElementById('pkg-content');
  try {
    const p = await fetchPackage(slug);
    if (p.error) {
      el.innerHTML = '<div class="empty-state"><p>Package not found.</p><a href="/website-making" class="btn-outline-platform">← Back to packages</a></div>';
      return;
    }
    renderPackage(p);
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><p>Could not load package. Please try again.</p><a href="/website-making" class="btn-outline-platform">← Back to packages</a></div>';
    console.warn('Package load failed', e);
  }
}

document.getElementById('inquiry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('[type="submit"]');
  if (submitBtn?.disabled) return;
  const fd = new FormData(form);
  const body = {
    packageId,
    name: fd.get('name'),
    email: fd.get('email'),
    phone: fd.get('phone'),
    message: fd.get('message')
  };
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
  }
  try {
    const res = await fetch('/api/website-making/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    document.getElementById('inquiry-modal').close();
    form.reset();
    const email = encodeURIComponent(String(body.email || ''));
    const dest = json.inquiryUrl
      ? `${json.inquiryUrl}?email=${email}`
      : `order-thanks.html?type=website&ref=${encodeURIComponent(json.inquiryRef || '')}&email=${email}`;
    location.href = dest;
  } catch (err) {
    if (window.showToast) showToast(err.message || 'Failed to send');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send';
    }
  }
});

const domReady = window.domReady || window.onPageReady || function (fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
};

domReady(() => {
  if (typeof initPlatformNav === 'function') initPlatformNav('website');
  loadPackage();
});
