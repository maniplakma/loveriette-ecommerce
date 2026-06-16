/* Site uses light theme only — dark mode removed */
(function bootThemeFromCache() {
  try {
    const raw = localStorage.getItem('loveriette-theme-colors');
    if (!raw) return;
    const t = JSON.parse(raw);
    const root = document.documentElement;
    const map = {
      background: '--background-color',
      font: '--font-color',
      primary: '--primary-color',
      secondary: '--secondary-color'
    };
    Object.entries(map).forEach(([key, prop]) => {
      if (t[key]) root.style.setProperty(prop, t[key]);
    });
    if (t.primary) root.style.setProperty('--a-primary', t.primary);
    if (t.background) root.style.setProperty('--a-bg', t.background);
  } catch (_) { /* ignore */ }
})();

(function forceLightTheme() {
  document.documentElement.classList.add('light-mode');
  if (document.body) document.body.classList.add('light-mode');
  try {
    localStorage.setItem('loveriette-theme', 'light');
  } catch (_) { /* ignore */ }
})();

const LIGHT_THEME_COLOR = '#f1dec9';

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
  if (document.body?.classList.contains('auth-page')) setNewBuyer(true);
  document.documentElement.classList.add('light-mode');
  if (document.body) document.body.classList.add('light-mode');
  updateThemeMeta();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme);
} else {
  initTheme();
}

window.setNewBuyer = setNewBuyer;
window.toggleTheme = toggleTheme;
window.setTheme = setTheme;
window.updateThemeMeta = updateThemeMeta;
window.updateThemeToggleUI = function () {};
