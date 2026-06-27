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
  loan: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h2"/><path d="M10 15h4"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  zap: '<svg viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
};

function renderIcon(name) {
  return `<span class="service-card-icon" aria-hidden="true">${ICON_SVGS[name] || ICON_SVGS.star}</span>`;
}

function filterActivityItems(items) {
  return (items || []).filter((a) => a.type === 'order' || a.type === 'lending');
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
  return 'Recent activity';
}

function renderActivityFeed(items) {
  const el = document.getElementById('activity-feed-list');
  const filtered = filterActivityItems(items);
  if (!el) return;
  if (!filtered.length) {
    el.innerHTML = '<li class="activity-feed-item"><span class="activity-feed-dot"></span><div>No recent orders or loan activity yet.</div></li>';
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

function renderServiceCategories(items) {
  const el = document.getElementById('service-categories-grid');
  if (!el) return;
  el.innerHTML = items.map((c) => {
    const btnClass = c.primary ? 'btn-primary-platform' : 'btn-outline-platform';
    const cta = c.cta || c.title || 'Explore';
    return `
    <a href="${escapeHtml(c.link)}" class="service-card">
      ${renderIcon(c.icon)}
      <h3>${escapeHtml(c.title)}</h3>
      <p>${escapeHtml(c.desc || c.text || '')}</p>
      <span class="${btnClass} service-card-btn">${escapeHtml(cta)}</span>
    </a>`;
  }).join('');
}

const GUIDE_LINKS = [
  { label: 'Order Guide', hint: 'How to buy step-by-step', href: '/guide.html', hot: true },
  { label: 'FAQs', hint: 'Common questions answered', href: '/faqs.html' },
  { label: 'Contact', hint: 'Reach our support team', href: '/contact.html' },
  { label: 'Shop', hint: 'Browse digital products', href: '/shop', hot: true },
  { label: 'Plugging', hint: 'Telegram auto forwarder', href: '/plugging' },
  { label: 'Lending', hint: 'Flexible loan plans', href: '/lending' },
  { label: 'Web Services', hint: 'Website packages', href: '/website-making' },
  { label: 'About Me', hint: 'Get to know me', href: '/about.html' },
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
  if (!profile) return;
  const nameEl = document.getElementById('home-about-name');
  const bioEl = document.getElementById('home-about-bio');
  const photoEl = document.getElementById('home-about-photo');
  const locWrap = document.getElementById('home-about-location');
  const locText = document.getElementById('home-about-location-text');

  if (nameEl) nameEl.textContent = profile.displayName || profile.brandName || 'loveriette';
  if (bioEl) bioEl.textContent = profile.bio || 'your go-to for premium digital goodies — shop, lend, build, and plug with someone who actually cares ♡';
  if (photoEl) {
    photoEl.src = profile.photoUrl || '/assets/store-logo.png';
    photoEl.alt = profile.displayName || 'Store profile';
    photoEl.onerror = () => { photoEl.src = '/assets/store-logo.png'; };
  }
  if (profile.location && locWrap && locText) {
    locText.textContent = profile.location;
    locWrap.hidden = false;
  } else if (locWrap) {
    locWrap.hidden = true;
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
  } catch (_) { /* ignore */ }
}

function renderFaqs(items) {
  const el = document.getElementById('homepage-faq-list');
  if (!el) return;
  el.innerHTML = items.map((f, i) => `
    <div class="faq-item${i === 0 ? ' open' : ''}">
      <button type="button" class="faq-question">${escapeHtml(f.question)}</button>
      <div class="faq-answer"><p>${escapeHtml(f.answer)}</p></div>
    </div>`).join('');
  el.querySelectorAll('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open'));
  });
}

function renderFeaturedProducts(products) {
  const el = document.getElementById('featured-products');
  if (!el || !products?.length) return;
  el.innerHTML = products.slice(0, 4).map((p) => {
    const href = p.shareUrl || p.slug ? `/product/${p.slug}` : `product.html?id=${p.id}`;
    return `<a href="${href}" class="related-product-card">
      <strong>${escapeHtml(p.name)}</strong>
      <div style="font-size:0.8rem;color:var(--theme-secondary);margin-top:0.25rem">From ₱${Number(p.startingPrice || p.price).toLocaleString()}</div>
    </a>`;
  }).join('');
}

function renderAnnouncements(items) {
  const bar = document.getElementById('announcement-bar');
  if (!bar || !items?.length) return;
  bar.hidden = false;
  bar.textContent = items[0].title + (items[0].body ? ` — ${items[0].body}` : '');
}

async function loadHomepage() {
  try {
    const data = await (window.ApiCache?.fetchJson || fetch)('/api/homepage');
    const payload = data.sections ? data : await data.json?.() || data;

    const sections = {};
    (payload.sections || []).forEach((s) => { sections[s.key] = s; });

    if (sections.service_categories) {
      document.getElementById('service-categories-title').textContent = sections.service_categories.title || 'Our Services';
      const sub = document.getElementById('service-categories-sub');
      if (sub) sub.textContent = sections.service_categories.subtitle || 'Four powerful services, one platform';
      renderServiceCategories(sections.service_categories.content?.items || []);
    }

    renderGuideLinks();
    loadHomeAbout();

    renderFaqs(payload.faqs || []);
    renderActivityFeed(payload.activity || []);
    renderFeaturedProducts(payload.featured || []);
    renderAnnouncements(payload.announcements || []);

    if (payload.footer?.footer_tagline) {
      const tagline = document.getElementById('footer-tagline');
      if (tagline) tagline.textContent = payload.footer.footer_tagline;
    }
  } catch (e) {
    console.warn('Homepage CMS load failed', e);
  }
}

// Poll activity feed
setInterval(async () => {
  try {
    const items = await ApiCache.fetchJson('/api/activity-feed', {}, 10000);
    renderActivityFeed(items);
  } catch (_) { /* ignore */ }
}, 30000);

document.addEventListener('DOMContentLoaded', () => {
  if (typeof initPlatformNav === 'function') initPlatformNav('home');
  loadHomepage();
  fetch('/api/track-visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/' }) }).catch(() => {});
});
