async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    credentials: 'include'
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function updateAuthUI(user) {
  document.querySelectorAll('.auth-guest').forEach((el) => { el.hidden = !!user; });
  document.querySelectorAll('.auth-user').forEach((el) => { el.hidden = !user; });
  if (typeof setNewBuyer === 'function') setNewBuyer(!user);
  if (typeof ensureAdminLink === 'function') ensureAdminLink(!!user?.isAdmin);
  cleanupDashboardNavLeft();
}

function cleanupDashboardNavLeft() {
  document.querySelectorAll('.nav-left .nav-dashboard').forEach((el) => el.remove());
}
window.cleanupDashboardNavLeft = cleanupDashboardNavLeft;

function initMobileNav() {
  document.querySelectorAll('.nav-inner').forEach((inner) => {
    if (inner.dataset.mobileReady) return;
    inner.dataset.mobileReady = '1';

    const left = inner.querySelector('.nav-left');
    const right = inner.querySelector('.nav-right');
    if (!left || !right) return;

    const headerRow = document.createElement('div');
    headerRow.className = 'nav-header-row';

    const toggle = document.createElement('button');
    toggle.className = 'nav-toggle icon-btn';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>`;

    const brand = document.createElement('a');
    brand.className = 'nav-brand store-brand';
    brand.href = '/';
    brand.innerHTML = window.buildBrandWordmarkHtml
      ? window.buildBrandWordmarkHtml('loveriette')
      : '<span class="brand-wordmark-wrap"><span class="brand-wordmark-back" aria-hidden="true">loveriette</span><span class="brand-wordmark-front store-brand-name">loveriette</span></span>';

    const quick = document.createElement('ul');
    quick.className = 'nav-quick';

    ['.cart-btn', '.sound-toggle'].forEach((selector) => {
      const el = right.querySelector(selector);
      const li = el?.closest('li');
      if (li) quick.append(li);
    });

    headerRow.append(toggle, brand, quick);

    const menu = document.createElement('div');
    menu.className = 'nav-menu';
    menu.append(left, right);

    inner.prepend(headerRow);
    inner.append(menu);

    toggle.addEventListener('click', () => {
      const open = inner.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });

    menu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => inner.classList.remove('nav-open'));
    });

    document.addEventListener('click', (e) => {
      if (!inner.contains(e.target)) inner.classList.remove('nav-open');
    });
  });
}

async function initNav() {
  initMobileNav();
  cleanupDashboardNavLeft();

  try {
    const { user } = await api('/auth/me');
    updateAuthUI(user);
  } catch {
    updateAuthUI(null);
  }

  try {
    const cart = await api('/cart');
    const cartCountEl = document.querySelector('.cart-count');
    if (cartCountEl) cartCountEl.textContent = cart.count;
  } catch { /* ignore */ }

  document.querySelector('.logout-btn')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    updateAuthUI(null);
    const cartCountEl = document.querySelector('.cart-count');
    if (cartCountEl) cartCountEl.textContent = '0';
  });

  document.querySelectorAll('.cart-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.location.href = 'cart.html';
    });
  });
}

initNav();
