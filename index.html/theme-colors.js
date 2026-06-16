/* Dynamic theme — updates canonical :root variables site-wide */
(function () {
  const STORAGE_KEY = 'loveriette-theme-colors';
  const DEFAULTS = {
    background: '#f1dec9',
    font: '#4a3c2e',
    primary: '#8d7b68',
    secondary: '#a4907c'
  };

  function normalizeHex(hex) {
    const h = String(hex || '').trim();
    if (!h) return null;
    const m = h.match(/^#?([a-fA-F0-9]{6})$/);
    return m ? `#${m[1].toLowerCase()}` : null;
  }

  function hexToRgb(hex) {
    const h = normalizeHex(hex)?.slice(1);
    if (!h) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  }

  function mixHex(a, b, weight) {
    const ar = hexToRgb(a);
    const br = hexToRgb(b);
    if (!ar || !br) return a || b;
    return rgbToHex(
      ar.r * (1 - weight) + br.r * weight,
      ar.g * (1 - weight) + br.g * weight,
      ar.b * (1 - weight) + br.b * weight
    );
  }

  function luminance(hex) {
    const c = hexToRgb(hex);
    if (!c) return 0;
    const chan = [c.r, c.g, c.b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  }

  function contrastOn(bg) {
    return luminance(bg) > 0.55 ? '#1f150c' : '#fbf4ea';
  }

  function hexToRgba(hex, alpha) {
    const c = hexToRgb(hex);
    if (!c) return `rgba(0,0,0,${alpha})`;
    return `rgba(${c.r},${c.g},${c.b},${alpha})`;
  }

  function parseColorhuntUrl(url) {
    const str = String(url || '').trim();
    const match = str.match(/colorhunt\.co\/palette\/([a-fA-F0-9\-]+)/i);
    if (!match) return null;
    const chunk = match[1].replace(/-/g, '');
    const hexes = [];
    for (let i = 0; i < chunk.length; i += 6) {
      const part = chunk.slice(i, i + 6);
      if (/^[a-fA-F0-9]{6}$/.test(part)) hexes.push(`#${part.toLowerCase()}`);
    }
    return hexes.length >= 2 ? hexes : null;
  }

  function mapPaletteToTheme(hexes) {
    const unique = [...new Set(hexes.map((h) => normalizeHex(h)).filter(Boolean))];
    if (unique.length < 2) return null;
    const sorted = unique.map((hex) => ({ hex, lum: luminance(hex) })).sort((a, b) => a.lum - b.lum);
    const darkest = sorted[0].hex;
    const lightest = sorted[sorted.length - 1].hex;
    const mids = sorted.slice(1, -1).map((x) => x.hex);
    const primary = mids[0] || lightest;
    const secondary = mids[1] || mids[0] || mixHex(darkest, lightest, 0.5);
    return {
      background: lightest,
      font: darkest,
      primary,
      secondary
    };
  }

  function normalizeThemePayload(colors) {
    const src = colors || {};
    return {
      background: normalizeHex(src.background) || DEFAULTS.background,
      font: normalizeHex(src.font) || DEFAULTS.font,
      primary: normalizeHex(src.primary) || DEFAULTS.primary,
      secondary: normalizeHex(src.secondary) || DEFAULTS.secondary
    };
  }

  function deriveThemeVars(colors) {
    const background = normalizeHex(colors.background) || DEFAULTS.background;
    const font = normalizeHex(colors.font) || DEFAULTS.font;
    const primary = normalizeHex(colors.primary) || DEFAULTS.primary;
    const secondary = normalizeHex(colors.secondary) || DEFAULTS.secondary;
    return {
      background,
      font,
      primary,
      secondary,
      surface: mixHex(background, '#ffffff', 0.42),
      surfaceAlt: mixHex(background, '#ffffff', 0.28),
      border: mixHex(secondary, primary, 0.35),
      muted: mixHex(font, secondary, 0.42),
      tint: mixHex(secondary, background, 0.55),
      buttonGradient: `linear-gradient(135deg, ${secondary} 0%, ${primary} 100%)`,
      onPrimary: contrastOn(primary),
      shadow: hexToRgba(font, 0.18),
      authBrandBg: `linear-gradient(145deg, ${mixHex(background, '#ffffff', 0.5)} 0%, ${background} 40%, ${secondary} 100%)`,
      authGlowA: hexToRgba(primary, 0.12),
      authGlowB: hexToRgba(secondary, 0.2)
    };
  }

  function saveThemeToStorage(colors) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeThemePayload(colors)));
    } catch (_) { /* ignore */ }
  }

  function loadThemeFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return normalizeThemePayload(parsed);
    } catch {
      return null;
    }
  }

  /** Write all theme tokens to :root — frontend + admin inherit instantly */
  function applyThemeColors(colors) {
    const v = deriveThemeVars(colors || {});
    const root = document.documentElement;

    root.style.setProperty('--primary-color', v.primary);
    root.style.setProperty('--secondary-color', v.secondary);
    root.style.setProperty('--background-color', v.background);
    root.style.setProperty('--font-color', v.font);

    root.style.setProperty('--surface-color', v.surface);
    root.style.setProperty('--surface-alt-color', v.surfaceAlt);
    root.style.setProperty('--border-color', v.border);
    root.style.setProperty('--muted-color', v.muted);
    root.style.setProperty('--tint-color', v.tint);
    root.style.setProperty('--button-gradient', v.buttonGradient);
    root.style.setProperty('--on-primary-color', v.onPrimary);
    root.style.setProperty('--shadow-color', v.shadow);
    root.style.setProperty('--auth-brand-bg', v.authBrandBg);
    root.style.setProperty('--auth-glow-a', v.authGlowA);
    root.style.setProperty('--auth-glow-b', v.authGlowB);

    /* Storefront + auth aliases (inline so every page picks up without style.css reload) */
    root.style.setProperty('--bg', v.background);
    root.style.setProperty('--surface', v.surface);
    root.style.setProperty('--surface-2', v.surfaceAlt);
    root.style.setProperty('--border', v.border);
    root.style.setProperty('--text', v.font);
    root.style.setProperty('--text-muted', v.muted);
    root.style.setProperty('--text-faint', v.secondary);
    root.style.setProperty('--accent', v.primary);
    root.style.setProperty('--accent-2', v.secondary);
    root.style.setProperty('--tint', v.tint);
    root.style.setProperty('--btn-bg', v.buttonGradient);
    root.style.setProperty('--on-primary', v.onPrimary);
    root.style.setProperty('--on-primary-color', v.onPrimary);

    syncAdminThemeAliases(v);
    document.querySelectorAll('.admin-sidebar, .admin-sidebar-footer').forEach((el) => {
      el.style.removeProperty('background');
      el.style.removeProperty('background-color');
      el.style.removeProperty('color');
      el.style.removeProperty('border-color');
    });

    if (typeof window.updateThemeMeta === 'function') {
      window.updateThemeMeta();
    }
    updateAdminThemePreviewSwatches(v);
  }

  function syncAdminThemeAliases(v) {
    const root = document.documentElement;
    root.style.setProperty('--a-bg', v.background);
    root.style.setProperty('--a-surface', v.surface);
    root.style.setProperty('--a-surface-2', v.surfaceAlt);
    root.style.setProperty('--a-border', v.border);
    root.style.setProperty('--a-text', v.font);
    root.style.setProperty('--a-muted', v.muted);
    root.style.setProperty('--a-muted-2', v.secondary);
    root.style.setProperty('--a-primary', v.primary);
    root.style.setProperty('--a-accent', v.primary);
    root.style.setProperty('--a-hover', v.surfaceAlt);
    root.style.setProperty('--a-input', v.surfaceAlt);
    root.style.setProperty('--a-grad', v.buttonGradient);
    root.style.setProperty('--a-soft', v.tint);
    root.style.setProperty('--a-pink', v.secondary);
    root.style.setProperty('--a-shadow', `0 4px 16px ${v.shadow}`);
  }

  function updateAdminThemePreviewSwatches(v) {
    const map = {
      'theme-swatch-bg': v.background,
      'theme-swatch-font': v.font,
      'theme-swatch-primary': v.primary,
      'theme-swatch-secondary': v.secondary
    };
    Object.entries(map).forEach(([id, color]) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.background = color;
        el.style.backgroundColor = color;
      }
    });

    const live = document.getElementById('theme-palette-live');
    if (live) {
      live.style.background = v.background;
      live.style.color = v.font;
      live.style.borderColor = v.border;
    }
  }

  async function fetchAndApplyThemeColors() {
    try {
      const res = await fetch('/theme-colors', { cache: 'no-store' });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('application/json')) {
        throw new Error(`theme-colors bad response: ${res.status} ${ct.slice(0, 40)}`);
      }
      const data = await res.json();
      applyThemeColors(data);
      saveThemeToStorage(data);
      return data;
    } catch (err) {
      const cached = loadThemeFromStorage();
      if (cached) {
        applyThemeColors(cached);
        return cached;
      }
      applyThemeColors(DEFAULTS);
      saveThemeToStorage(DEFAULTS);
      return DEFAULTS;
    }
  }

  const cached = loadThemeFromStorage();
  if (cached) applyThemeColors(cached);

  window.applyThemeColors = applyThemeColors;
  window.reapplySidebarTheme = function reapplySidebarTheme() {
    const cachedColors = loadThemeFromStorage();
    if (cachedColors) applyThemeColors(cachedColors);
    else fetchAndApplyThemeColors();
  };
  window.saveThemeToStorage = saveThemeToStorage;
  window.loadThemeFromStorage = loadThemeFromStorage;
  window.parseColorhuntUrl = parseColorhuntUrl;
  window.mapPaletteToTheme = mapPaletteToTheme;
  window.fetchAndApplyThemeColors = fetchAndApplyThemeColors;
  window.THEME_COLOR_DEFAULTS = DEFAULTS;

  fetchAndApplyThemeColors();
})();
