/** Functional vs feature pages — strip broken corner decos on admin/dashboard/auth */
(function pageContext() {
  const FUNCTIONAL_PATH = /admin\.html|dashboard\.html|login\.html|signup\.html|faqs\.html|contact\.html|guide\.html|about\.html|terms\.html|privacy\.html|cart\.html|checkout\.html|payment\.html|order-thanks|website-inquiry|website-package|plugging-payment|plugging-status|plugging-subscribe|plugging-workspace|product\.html/i;

  function isFunctionalPage() {
    const body = document.body;
    if (!body) return false;
    if (body.classList.contains('admin-page')) return true;
    if (body.classList.contains('buyer-dashboard-page')) return true;
    if (body.classList.contains('auth-page')) return true;
    if (body.dataset?.noFlirt !== undefined) return true;
    return FUNCTIONAL_PATH.test((location.pathname || '').toLowerCase());
  }

  function isFeaturePage() {
    if (isFunctionalPage()) return false;
    const body = document.body;
    const path = (location.pathname || '').toLowerCase();
    return body.classList.contains('page-home')
      || body.classList.contains('page-shop')
      || /^\/(shop|plugging|website-making)\/?$/i.test(path.replace(/\/$/, '') || '/')
      || /\/(plugging|website-making)\/?$/i.test(path);
  }

  function stripAdminDecorations() {
    document.getElementById('site-page-corners')?.remove();
    document.body?.classList.remove(
      'site-deco-active',
      'site-deco-zone--admin',
      'site-deco-zone--buyer',
      'site-deco-zone--payment'
    );
  }

  window.isFunctionalPage = isFunctionalPage;
  window.isFeaturePage = isFeaturePage;
  window.stripAdminDecorations = stripAdminDecorations;
  if (isFunctionalPage()) stripAdminDecorations();
})();

/* Site theme bootstrap — no duplicate partial cache apply (see theme-colors.js) */
(function forceLightTheme() {
  document.documentElement.classList.add('light-mode');
  if (document.body) document.body.classList.add('light-mode');
  try {
    localStorage.setItem('loveriette-theme', 'light');
  } catch (_) { /* ignore */ }
})();

const LIGHT_THEME_COLOR = '#080404';

function isLightMode() {
  return true;
}

function updateThemeMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
  meta.content = bg || LIGHT_THEME_COLOR;
}

function removeThemeToggles() {
  document.querySelectorAll('.theme-toggle, .theme-toggle-floating').forEach((el) => el.remove());
}

function setTheme(_mode) {
  document.documentElement.classList.add('light-mode');
  if (document.body) document.body.classList.add('light-mode');
  try {
    localStorage.setItem('loveriette-theme', 'light');
  } catch (_) { /* ignore */ }
  updateThemeMeta();
}

function toggleTheme() {
  setTheme('light');
}

function setNewBuyer(isNew) {
  if (!document.body) return;
  document.body.classList.toggle('is-new-buyer', isNew);
}

function ensureAdminLink(isAdmin) {
  document.querySelectorAll('.nav-right').forEach((navRight) => {
    let li = navRight.querySelector('.nav-admin');
    if (isAdmin) {
      if (!li) {
        li = document.createElement('li');
        li.className = 'nav-admin';
        li.innerHTML = '<a href="admin.html" class="nav-admin-link">Admin</a>';
        navRight.prepend(li);
      }
      li.hidden = false;
    } else if (li) {
      li.hidden = true;
    }
  });
}
window.ensureAdminLink = ensureAdminLink;

function initTheme() {
  removeThemeToggles();
  if (typeof stripAdminDecorations === 'function') stripAdminDecorations();
  if (document.body?.classList.contains('auth-page')) setNewBuyer(true);
  document.documentElement.classList.add('light-mode');
  if (document.body) document.body.classList.add('light-mode');
  updateThemeMeta();
  applyModuleNav();
}

async function applyModuleNav() {
  try {
    const data = window.ApiCache
      ? await ApiCache.fetchJson('/api/modules', {}, 60000)
      : await fetch('/api/modules', { credentials: 'include' }).then((r) => r.json());
    document.querySelectorAll('.nav-left a, .nav-menu a').forEach((a) => {
      const href = (a.getAttribute('href') || '').toLowerCase();
      const li = a.closest('li');
      if (!li) return;
      if (!data.shop && (href === '/shop' || href.endsWith('shop.html'))) li.hidden = true;
      if (!data.plugging && (href === '/plugging' || href.includes('plugging'))) li.hidden = true;
      if (!data.websiteMaking && href.includes('website-making')) li.hidden = true;
    });
  } catch (_) { /* non-fatal */ }
}
window.applyModuleNav = applyModuleNav;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme, { once: true });
} else {
  initTheme();
}

window.setNewBuyer = setNewBuyer;
window.toggleTheme = toggleTheme;
window.setTheme = setTheme;
window.updateThemeMeta = updateThemeMeta;
window.updateThemeToggleUI = function () {};

(function loadSiteChrome() {
  const v = '20260705cleanup';
  const functional = typeof isFunctionalPage === 'function' && isFunctionalPage();
  const feature = typeof isFeaturePage === 'function' && isFeaturePage();

  function injectScript(src) {
    if (document.querySelector(`script[src*="${src.split('?')[0]}"]`)) return;
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    document.body.appendChild(s);
  }

  function loadDeferredChrome() {
    if (functional) {
      if (typeof stripAdminDecorations === 'function') stripAdminDecorations();
      return;
    }
    if (feature && !document.querySelector('script[src*="flirty-copy.js"]')) {
      injectScript(`/flirty-copy.js?v=${v}`);
    }
  }

  function scheduleChrome() {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(loadDeferredChrome, { timeout: 2000 });
    } else {
      setTimeout(loadDeferredChrome, 1);
    }
  }

  if (document.body) scheduleChrome();
  else document.addEventListener('DOMContentLoaded', scheduleChrome, { once: true });
})();
