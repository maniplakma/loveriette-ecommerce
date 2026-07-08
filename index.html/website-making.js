/** Website Making — isolated module (no hard dependency on ApiCache) */
(function () {
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const DEFAULT_PACKAGES = [
    { slug: 'ecommerce', name: 'Ecommerce Website', description: 'Full online store with cart & checkout.', price: 25000, priceLabel: 'Starting at ₱25,000', features: ['Product catalog', 'Cart & checkout', 'Admin panel', 'Mobile responsive'] },
    { slug: 'auto-order', name: 'Auto Order Website', description: 'Automated order processing site.', price: 18000, priceLabel: 'Starting at ₱18,000', features: ['Auto order flow', 'Payment QR', 'Order notifications', 'Admin dashboard'] },
    { slug: 'custom', name: 'Custom Website', description: 'Tailored design for your brand.', price: 35000, priceLabel: 'Starting at ₱35,000', features: ['Custom design', 'Unique features', 'SEO setup', 'Training included'] },
    { slug: 'business', name: 'Business Website', description: 'Professional corporate presence.', price: 15000, priceLabel: 'Starting at ₱15,000', features: ['5 pages', 'Contact form', 'Google Maps', 'Social links'] },
    { slug: 'landing-page', name: 'Landing Page', description: 'High-converting single page.', price: 8000, priceLabel: 'Starting at ₱8,000', features: ['Single page', 'CTA optimized', 'Mobile first', 'Fast loading'] },
    { slug: 'maintenance', name: 'Maintenance Service', description: 'Ongoing site care & updates.', price: 3000, priceLabel: '₱3,000/month', features: ['Monthly updates', 'Security patches', 'Backup', 'Minor edits'] },
    { slug: 'rental', name: 'Monthly Website Rental', description: 'Rent a ready-made website.', price: 2500, priceLabel: '₱2,500/month', features: ['Ready-made site', 'Hosting included', 'Monthly updates', 'Support included'] }
  ];

  const DEFAULT_FAQS = [
    { question: 'How long does it take to build a website?', answer: 'Typical turnaround is 1–2 weeks depending on package complexity, content readiness, and revision rounds. Custom and ecommerce builds may take longer; we confirm timeline in your inquiry reply before work starts.' },
    { question: 'Do you provide hosting?', answer: 'Yes. Hosting is included in rental and maintenance packages. For one-time builds, we can deploy to your preferred host or recommend a setup as part of the package scope.' },
    { question: 'Can I request changes after launch?', answer: 'Minor edits are included in maintenance plans. For one-time packages, post-launch changes are quoted separately unless otherwise agreed in writing during inquiry.' },
    { question: 'How do I order a package?', answer: 'Open any package page, click Order Now or Send Inquiry, and submit your details. You receive an inquiry reference and can chat with our team to confirm scope, price, and payment steps.' }
  ];

  async function fetchWebsiteData() {
    if (window.ApiCache?.fetchJson) {
      return ApiCache.fetchJson('/api/website-making', {}, 60000);
    }
    const res = await fetch('/api/website-making', { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load website packages');
    return data;
  }

  function priceLabel(pkg) {
    if (pkg.priceLabel) return pkg.priceLabel;
    const n = Number(pkg.price);
    return Number.isFinite(n) ? `₱${n.toLocaleString()}` : '';
  }

  function renderPackageCard(p) {
    const features = Array.isArray(p.features) ? p.features : [];
    const img = p.imageUrl
      ? `<div class="package-card-media"><img src="${esc(p.imageUrl)}" alt="" loading="lazy"></div>`
      : '';
    return `
      <article class="package-card">
        ${img}
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.description)}</p>
        <div class="package-price">${esc(priceLabel(p))}</div>
        <ul class="package-features">${features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="package-actions">
          <a href="/website-making/${esc(p.slug)}" class="btn-primary-platform">View Package</a>
        </div>
      </article>`;
  }

  function renderPackages(packages, { fromApi = false } = {}) {
    const grid = document.getElementById('packages-grid');
    const empty = document.getElementById('packages-empty');
    if (!grid) return;
    const list = Array.isArray(packages) && packages.length
      ? packages
      : (fromApi ? [] : DEFAULT_PACKAGES);
    grid.innerHTML = list.map(renderPackageCard).join('');
    if (empty) empty.hidden = list.length > 0;
  }

  function renderPortfolio(items) {
    const section = document.getElementById('portfolio-section');
    const grid = document.getElementById('portfolio-grid');
    if (!section || !grid) return;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    grid.innerHTML = list.map((item) => `
      <article class="package-card package-card--portfolio">
        ${item.imageUrl ? `<div class="package-card-media"><img src="${esc(item.imageUrl)}" alt="" loading="lazy"></div>` : ''}
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.description)}</p>
        ${item.linkUrl ? `<a href="${esc(item.linkUrl)}" class="btn-outline-platform" target="_blank" rel="noopener">View project</a>` : ''}
      </article>`).join('');
  }

  function renderFaqs(faqs) {
    const el = document.getElementById('web-faq');
    if (!el) return;
    const list = Array.isArray(faqs) && faqs.length ? faqs : DEFAULT_FAQS;
    el.innerHTML = list.map((f, i) => `
      <div class="faq-item${i === 0 ? ' open' : ''}">
        <button type="button" class="faq-question">${esc(f.question)}</button>
        <div class="faq-answer"><p>${esc(f.answer)}</p></div>
      </div>`).join('');
    el.querySelectorAll('.faq-question').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open'));
    });
  }

  function applyPageMeta() {
    if (window.applySeoMeta) {
      applySeoMeta({ title: 'Website Making — loveriette', description: 'Professional websites for your business', url: '/website-making' });
    }
    if (window.renderShareButtons) {
      renderShareButtons(document.getElementById('web-share'), '/website-making', 'Website Making');
    }
  }

  async function loadWebsiteMaking() {
    let data;
    try {
      data = await fetchWebsiteData();
    } catch (e) {
      console.warn('Website making API failed — using defaults', e);
      applyPageMeta();
      renderPackages(DEFAULT_PACKAGES, { fromApi: false });
      renderFaqs(DEFAULT_FAQS);
      renderPortfolio([]);
      return;
    }

    applyPageMeta();
    renderPackages(data.packages, { fromApi: true });
    renderFaqs(data.faqs);
    renderPortfolio(data.portfolio);
  }

  const domReady = window.domReady || window.onPageReady || function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

  domReady(() => {
    if (typeof initPlatformNav === 'function') initPlatformNav('website');
    loadWebsiteMaking();
  });
})();
