/**
 * Show welcome banner when clients arrive from ezyshell (?from=ezyshell).
 */
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('from') !== 'ezyshell' && params.get('migrated') !== '1') return;

  const text =
    'Welcome back, babe — use the same email and password from ezyshell. Your orders are already here ♡';

  function mountBanner(container) {
    if (!container || container.querySelector('.ezyshell-migrated-banner')) return;
    const el = document.createElement('div');
    el.className = 'ezyshell-migrated-banner';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<strong>We moved to loveriette</strong><span>' + text + '</span>';
    container.prepend(el);
  }

  mountBanner(document.querySelector('.auth-form-wrap'));
  mountBanner(document.querySelector('.auth-form-panel'));

  const bar = document.getElementById('announcement-bar');
  if (bar) {
    bar.hidden = false;
    bar.className = 'announcement-bar ezyshell-migrated-topbar';
    bar.innerHTML =
      '<p><strong>From ezyshell?</strong> Sign in with your old account — same email &amp; password. Your history is ready ♡</p>';
  }
})();
