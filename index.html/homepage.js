function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const ICON_SVGS = {
  cart: '<svg viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  zap: '<svg viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
};

const DEFAULTS = {
  serviceCategories: {
    title: 'Our Services',
    subtitle: 'Shop, websites, and plugging — one platform',
    items: [
      { title: 'Plugging', desc: 'Telegram message auto forwarder — relay messages across your groups and channels automatically.', link: '/plugging', icon: 'plug', cta: 'View Plugging', primary: true },
      { title: 'Shop', desc: 'Premium digital products, apps, and subscriptions delivered after payment verification.', link: '/shop', icon: 'cart', cta: 'Browse Shop' },
      { title: 'Website Making', desc: 'Custom ecommerce sites, auto-order platforms, and ongoing maintenance for your brand.', link: '/website-making', icon: 'web', cta: 'View Packages' }
    ]
  },
  whyChooseUs: {
    title: 'Why Choose Us',
    subtitle: 'Trusted by thousands of customers',
    items: [
      { icon: 'shield', title: 'Secure & Reliable', text: 'Enterprise-grade security for every transaction and account delivery.' },
      { icon: 'zap', title: 'Fast Delivery', text: 'Digital products and access details delivered promptly after approval.' },
      { icon: 'heart', title: 'Dedicated Support', text: 'Real support via chat, tickets, and contact channels when you need help.' },
      { icon: 'star', title: 'Premium Quality', text: 'Curated products and services at fair, transparent prices.' }
    ]
  },
  faqs: [
    {
      question: 'What services do you offer?',
      answer: 'Loveriette is a multi-service digital platform. Our Shop offers premium app accounts, streaming subscriptions, and creative tools with verified delivery after payment. Website Making covers ecommerce stores, auto-order sites, landing pages, and ongoing maintenance. Plugging is a self-service Telegram message auto-forwarder that runs on your own account. You can browse each service from the homepage or navigation menu.'
    },
    {
      question: 'How do I place an order?',
      answer: 'Create an account or sign in, then browse the Shop and add items to your cart. At checkout, choose your payment method and pay the exact amount shown. Upload a clear photo or screenshot of your payment receipt before submitting. Our team reviews payments during business hours. Once approved, your order status updates and digital credentials or access details appear in My Account → Purchases. For website or plugging services, follow the inquiry or plan selection flow on the respective service page.'
    },
    {
      question: 'How long does delivery take?',
      answer: 'Most digital shop orders are processed within minutes to a few hours after payment verification, depending on queue volume and time of day. Orders submitted outside business hours are handled at the start of the next active period. Website projects and custom work follow the timeline agreed during inquiry. Plugging access keys are issued after payment approval — you can enter your key immediately in the workspace to begin setup.'
    },
    {
      question: 'What payment methods do you accept?',
      answer: 'Accepted methods are shown at checkout and may include GCash, QRPH, and other options configured for the store. Always pay the exact total displayed. Upload only genuine, unedited payment receipts from the app or bank you used. Incorrect amounts, wrong recipients, or altered screenshots may delay or void your order until corrected.'
    },
    {
      question: 'Is my payment secure?',
      answer: 'We do not collect or store credit card numbers, online banking passwords, or full payment credentials on our servers. Checkout uses manual verification: you pay through your chosen provider and upload proof. Account passwords and order data are handled with reasonable technical safeguards. Never share your Loveriette login or one-time codes with anyone claiming to be support outside our official contact channels.'
    },
    {
      question: 'How does website making work?',
      answer: 'Visit the Website Making page to compare packages — ecommerce, auto-order, business sites, landing pages, maintenance, and rental options. Select a package to view full details, then submit an inquiry with your requirements. Our team responds with scope, timeline, and payment steps. Revisions and post-launch support depend on the package you choose; maintenance plans include ongoing updates and minor edits.'
    }
  ],
  aboutBio: 'Lovebyriette offers digital products and premium accounts at affordable prices. Reliable, fast service, and open for supplying and bulk orders.',
  aboutName: 'loveriette',
  aboutSub: 'Your trusted source for premium digital products and services'
};

function coalesceItems(section, fallbackItems) {
  const raw = section?.content?.items || section?.items;
  if (!Array.isArray(raw)) return fallbackItems;
  const items = raw.filter((i) => {
    if (!i || !(i.title || i.question)) return false;
    const link = String(i.link || '').toLowerCase();
    const title = String(i.title || '').toLowerCase();
    return link !== '/lending' && !link.includes('lending.html') && title !== 'lending';
  });
  return items.length ? items : fallbackItems;
}

function renderIcon(name) {
  return `<span class="service-card-icon" aria-hidden="true">${ICON_SVGS[name] || ICON_SVGS.star}</span>`;
}

function filterActivityItems(items) {
  return (items || []).filter((a) => a.type === 'order');
}

function formatActivityMessage(a) {
  if (a?.message) return a.message;
  if (a?.meta?.buyerMasked && a.meta.items?.length) {
    const parts = a.meta.items.map((i) => {
      const qty = Number(i.quantity) || 1;
      return `${i.name} (${qty === 1 ? '1 pc' : `${qty} pcs`})`;
    }).join(', ');
    return `${a.meta.buyerMasked} bought ${parts}`;
  }
  return 'Recent order activity';
}

function renderActivityFeed(items) {
  const el = document.getElementById('activity-feed-list');
  const filtered = filterActivityItems(items);
  if (!el) return;
  if (!filtered.length) {
    el.innerHTML = '<li class="activity-feed-item"><span class="activity-feed-dot"></span><div>No recent order activity yet.</div></li>';
    return;
  }
  el.innerHTML = filtered.map((a) => `
    <li class="activity-feed-item">
      <span class="activity-feed-dot"></span>
      <div class="activity-feed-body">
        <div class="activity-feed-text">${escapeHtml(formatActivityMessage(a))}</div>
        <span class="activity-feed-time">${timeAgo(a.createdAt)}</span>
      </div>
    </li>`).join('');
}

window.__renderActivity = renderActivityFeed;

function renderServiceCategories(items) {
  const el = document.getElementById('service-categories-grid');
  if (!el) return;
  const list = items?.length ? items : DEFAULTS.serviceCategories.items;
  el.innerHTML = list.map((c) => {
    const cta = c.cta || c.title || 'Learn more';
    const badge = c.primary
      ? '<span class="service-card-badge">Popular</span>'
      : (c.badge ? `<span class="service-card-badge service-card-badge--soft">${escapeHtml(c.badge)}</span>` : '');
    return `
    <a href="${escapeHtml(c.link)}" class="service-card service-card--premium${c.primary ? ' service-card--featured' : ''}">
      <span class="service-card-shine" aria-hidden="true"></span>
      <div class="service-card-top">
        ${badge}
        <div class="service-card-icon-wrap">${renderIcon(c.icon)}</div>
      </div>
      <h3 class="service-card-title">${escapeHtml(c.title)}</h3>
      <p class="service-card-desc">${escapeHtml(c.desc || c.text || '')}</p>
      <span class="service-card-cta${c.primary ? ' service-card-cta--primary' : ''}">${escapeHtml(cta)}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </a>`;
  }).join('');
}

function renderWhyChooseUs(section) {
  const titleEl = document.getElementById('why-choose-title');
  const subEl = document.getElementById('why-choose-sub');
  const grid = document.getElementById('why-choose-grid');
  if (!grid) return;
  const data = section || DEFAULTS.whyChooseUs;
  if (titleEl) titleEl.textContent = data.title || DEFAULTS.whyChooseUs.title;
  if (subEl) subEl.textContent = data.subtitle || DEFAULTS.whyChooseUs.subtitle;
  const items = coalesceItems(data, DEFAULTS.whyChooseUs.items);
  grid.innerHTML = items.map((item) => `
    <article class="benefit-card benefit-card--float">
      <span class="benefit-card-gloss" aria-hidden="true"></span>
      ${renderIcon(item.icon || 'star')}
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.text || item.desc || '')}</p>
    </article>`).join('');
}

const GUIDE_LINKS = [
  { label: 'Order Guide', hint: 'How to buy step-by-step', href: '/guide.html', hot: true },
  { label: 'FAQ', hint: 'Common questions answered', href: '/faqs.html' },
  { label: 'Contact', hint: 'Reach our support team', href: '/contact.html' },
  { label: 'Shop', hint: 'Browse digital products', href: '/shop', hot: true },
  { label: 'Plugging', hint: 'Telegram auto forwarder', href: '/plugging' },
  { label: 'Website Making', hint: 'Website packages', href: '/website-making' },
  { label: 'About', hint: 'Learn about the store', href: '/about.html' },
  { label: 'Privacy', hint: 'Privacy policy', href: '/privacy.html' },
  { label: 'Terms', hint: 'Terms of service', href: '/terms.html' }
];

function renderGuideLinks() {
  const el = document.getElementById('guide-links-grid');
  if (!el) return;
  el.innerHTML = GUIDE_LINKS.map((link) => `
    <a href="${escapeHtml(link.href)}" class="guide-link-btn${link.hot ? ' guide-link-btn--hot' : ''}" title="${escapeHtml(link.hint)}">
      <span class="guide-link-btn-label">${escapeHtml(link.label)}</span>
    </a>`).join('');
}

function renderHomeAboutSocials(links) {
  const orbit = document.getElementById('home-about-socials');
  const wrap = document.getElementById('home-about-social-wrap');
  if (!orbit) return;
  if (!links?.length) {
    if (wrap) wrap.hidden = true;
    return;
  }
  if (wrap) wrap.hidden = false;
  orbit.innerHTML = links.map((s) => {
    const icon = window.socialIcon ? window.socialIcon(s.key) : '';
    return `<a class="about-social-pill" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.label || s.key)}">
      <span class="about-social-pill-icon">${icon}</span>
      <span class="about-social-pill-label">${escapeHtml(s.label || s.key)}</span>
    </a>`;
  }).join('');
}

function renderHomeAbout(profile) {
  const nameEl = document.getElementById('home-about-name');
  const bioEl = document.getElementById('home-about-bio');
  const photoEl = document.getElementById('home-about-photo');
  const locWrap = document.getElementById('home-about-location');
  const locText = document.getElementById('home-about-location-text');
  const subEl = document.getElementById('about-portfolio-sub');

  const p = profile || {};
  if (subEl && !subEl.dataset.cmsFilled) subEl.textContent = DEFAULTS.aboutSub;
  if (nameEl) nameEl.textContent = p.displayName || p.brandName || DEFAULTS.aboutName;
  if (bioEl) bioEl.textContent = p.bio || DEFAULTS.aboutBio;
  if (photoEl) {
    photoEl.src = p.photoUrl || '/assets/store-logo.png';
    photoEl.alt = p.displayName || 'Store profile';
    photoEl.onerror = () => { photoEl.src = '/assets/store-logo.png'; };
  }
  if (p.location && locWrap && locText) {
    locText.textContent = p.location;
    locWrap.hidden = false;
  } else if (locWrap) {
    locWrap.hidden = true;
  }
}

function renderFaqs(items) {
  const el = document.getElementById('homepage-faq-list');
  if (!el) return;
  const list = items?.length ? items : DEFAULTS.faqs;
  el.innerHTML = list.map((f, i) => `
    <div class="faq-item${i === 0 ? ' open' : ''}">
      <button type="button" class="faq-question">${escapeHtml(f.question)}</button>
      <div class="faq-answer"><p>${escapeHtml(f.answer)}</p></div>
    </div>`).join('');
  el.querySelectorAll('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open'));
  });
}

function renderAnnouncements(items) {
  const bar = document.getElementById('announcement-bar');
  if (!bar || !items?.length) return;
  bar.hidden = false;
  bar.textContent = items[0].title + (items[0].body ? ` — ${items[0].body}` : '');
}

function renderDefaults() {
  const catTitle = document.getElementById('service-categories-title');
  const catSub = document.getElementById('service-categories-sub');
  if (catTitle) catTitle.textContent = DEFAULTS.serviceCategories.title;
  if (catSub) catSub.textContent = DEFAULTS.serviceCategories.subtitle;
  renderServiceCategories(DEFAULTS.serviceCategories.items);
  renderWhyChooseUs(DEFAULTS.whyChooseUs);
  renderFaqs(DEFAULTS.faqs);
  renderGuideLinks();
  renderHomeAbout(null);
}

async function fetchJson(url, ttl) {
  if (window.ApiCache?.fetchJson) {
    return ApiCache.fetchJson(url, {}, ttl || 30000);
  }
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadActivityFast() {
  try {
    const items = window.__activityPrefetch
      ? await window.__activityPrefetch
      : await fetchJson('/api/activity-feed', 15000);
    renderActivityFeed(items);
  } catch (_) {
    /* full homepage load will retry */
  }
}

async function loadHomeAbout() {
  try {
    const [profileRes, socialRes] = await Promise.all([
      fetch('/store-profile', { credentials: 'include' }),
      fetch('/social', { credentials: 'include' })
    ]);
    if (profileRes.ok) renderHomeAbout(await profileRes.json());
    if (socialRes.ok) {
      const data = await socialRes.json();
      renderHomeAboutSocials(Array.isArray(data) ? data : []);
    }
  } catch (_) {
    renderHomeAbout(null);
  }
}

async function loadHomepage() {
  try {
    const payload = await fetchJson('/api/homepage', 45000);
    const sections = {};
    (payload.sections || []).forEach((s) => { sections[s.key] = s; });

    if (sections.service_categories) {
      const sc = sections.service_categories;
      const catTitle = document.getElementById('service-categories-title');
      const catSub = document.getElementById('service-categories-sub');
      if (catTitle) catTitle.textContent = sc.title || DEFAULTS.serviceCategories.title;
      if (catSub) catSub.textContent = sc.subtitle || DEFAULTS.serviceCategories.subtitle;
      renderServiceCategories(coalesceItems(sc, DEFAULTS.serviceCategories.items));
    } else {
      renderServiceCategories(DEFAULTS.serviceCategories.items);
    }

    renderWhyChooseUs(sections.why_choose_us || DEFAULTS.whyChooseUs);

    renderFaqs(payload.faqs?.length ? payload.faqs : DEFAULTS.faqs);
    if (payload.activity?.length) renderActivityFeed(payload.activity);
    renderAnnouncements(payload.announcements || []);

    if (payload.footer?.footer_tagline) {
      const tagline = document.getElementById('footer-tagline');
      if (tagline) tagline.textContent = payload.footer.footer_tagline;
    }
  } catch (e) {
    console.warn('Homepage CMS load failed — using defaults', e);
  }
}

function bootHomepage() {
  renderDefaults();
  loadActivityFast();
  loadHomeAbout();
  loadHomepage();
  if (typeof initPlatformNav === 'function') initPlatformNav('home');
  fetch('/api/track-visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/' })
  }).catch(() => {});
}

function domReady(fn) {
  if (typeof window.onPageReady === 'function') {
    window.onPageReady(fn);
    return;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

setInterval(async () => {
  try {
    const items = await fetchJson('/api/activity-feed', 10000);
    renderActivityFeed(items);
  } catch (_) { /* ignore */ }
}, 30000);

domReady(bootHomepage);

// Paint immediately when script runs at end of body (before deferred head scripts)
if (document.getElementById('service-categories-grid')) {
  renderDefaults();
}
