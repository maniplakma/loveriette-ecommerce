/**
 * Blocking boot — apply cached theme tokens before first paint (prevents FOUC).
 * theme-colors.js refines later without re-applying if unchanged.
 */
(function () {
  const DEFAULTS = {
    background: '#080404',
    font: '#f0ecec',
    primary: '#e50914',
    secondary: '#ff3b3b'
  };

  function norm(hex) {
    const m = String(hex || '').trim().match(/^#?([a-fA-F0-9]{6})$/);
    return m ? `#${m[1].toLowerCase()}` : null;
  }

  function lum(hex) {
    const h = norm(hex)?.slice(1);
    if (!h) return 0;
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const ch = c.map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function mix(a, b, w) {
    const pa = norm(a)?.slice(1);
    const pb = norm(b)?.slice(1);
    if (!pa || !pb) return a || b;
    const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const A = rgb(pa);
    const B = rgb(pb);
    const m = A.map((v, i) => Math.round(v * (1 - w) + B[i] * w));
    return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  function resolve(colors) {
    const c = {
      background: norm(colors.background) || DEFAULTS.background,
      font: norm(colors.font) || DEFAULTS.font,
      primary: norm(colors.primary) || DEFAULTS.primary,
      secondary: norm(colors.secondary) || DEFAULTS.secondary
    };
    if (lum(c.background) > 0.35) return { ...DEFAULTS };
    return c;
  }

  function apply(c) {
    const bg = c.background;
    const surface = mix(bg, '#ffffff', 0.06);
    const root = document.documentElement;
    root.classList.add('light-mode');
    root.style.setProperty('--background-color', bg);
    root.style.setProperty('--font-color', c.font);
    root.style.setProperty('--primary-color', c.primary);
    root.style.setProperty('--secondary-color', c.secondary);
    root.style.setProperty('--surface-color', surface);
    root.style.setProperty('--bg', bg);
    root.style.setProperty('--surface', surface);
    root.style.setProperty('--text', c.font);
    root.style.setProperty('--accent', c.primary);
    root.style.setProperty('--accent-2', c.secondary);
    root.style.backgroundColor = bg;
    root.style.colorScheme = 'dark';
  }

  let cached = null;
  try {
    const raw = localStorage.getItem('loveriette-theme-colors');
    if (raw) cached = JSON.parse(raw);
  } catch (_) { /* ignore */ }

  const active = resolve(cached || DEFAULTS);
  apply(active);
  window.__loverietteThemeBootKey = `${active.background}|${active.font}|${active.primary}|${active.secondary}`;
})();
