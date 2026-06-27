/* Store logo + layered glossy wordmark — loaded from /branding (admin Theme settings) */
(function () {
  const FONT_OPTIONS = {
    'system-ui': 'system-ui, -apple-system, sans-serif',
    Syne: '"Syne", system-ui, sans-serif',
    'Pinyon Script': '"Pinyon Script", cursive',
    Pacifico: '"Pacifico", cursive',
    'Dancing Script': '"Dancing Script", cursive',
    'Great Vibes': '"Great Vibes", cursive',
    Fredoka: '"Fredoka", system-ui, sans-serif',
    Quicksand: '"Quicksand", system-ui, sans-serif',
    Poppins: '"Poppins", system-ui, sans-serif',
    'Playfair Display': '"Playfair Display", Georgia, serif',
    'Bodoni Moda': '"Bodoni Moda", "Didot", "Bodoni MT", Georgia, serif',
    Caveat: '"Caveat", cursive',
    Nunito: '"Nunito", system-ui, sans-serif'
  };

  const GOOGLE_FONTS = Object.keys(FONT_OPTIONS).filter((k) => k !== 'system-ui');
  const LOGO_IMG_SELECTOR = '.store-brand-logo, .admin-brand-logo-img, .auth-logo-img';
  const LEGACY_NAME_SELECTOR = [
    '.store-brand-name:not(.brand-wordmark-front)',
    '.admin-brand-name:not(.brand-wordmark-front)',
    '.auth-logo-text:not(.brand-wordmark-front)',
    '.brand-wordmark:not(.brand-wordmark-front):not(.brand-wordmark-back)'
  ].join(', ');

  const SCRIPT_FONTS = ['Bodoni Moda', 'Pinyon Script', 'Pacifico', 'Dancing Script', 'Great Vibes', 'Caveat', 'Playfair Display'];
  const BOLD_FONTS = ['Syne', 'Poppins', 'Fredoka', 'Quicksand', 'Nunito', 'system-ui'];

  function loadGoogleFont(name) {
    if (!GOOGLE_FONTS.includes(name)) return;
    const id = `gf-brand-${name.replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) return;
    const weights = name === 'Syne'
      ? 'wght@700;800'
      : name === 'Bodoni Moda'
        ? 'ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400'
        : name === 'Poppins'
          ? 'wght@600;700;800'
          : 'wght@400;600;700';
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:${weights}&display=swap`;
    document.head.appendChild(link);
  }

  function fontFamily(key) {
    return FONT_OPTIONS[key] || FONT_OPTIONS['Pinyon Script'];
  }

  function buildBrandWordmarkHtml(name, extraFrontClass) {
    const n = name || 'loveriette';
    const frontClass = ['brand-wordmark-front', 'store-brand-name', extraFrontClass].filter(Boolean).join(' ');
    return `<span class="brand-wordmark-wrap">
      <span class="brand-wordmark-back" aria-hidden="true">${n}</span>
      <span class="${frontClass}">${n}</span>
    </span>`;
  }

  function wordmarkModifiers(el) {
    const mods = [];
    if (el.id === 'admin-brand-name' || el.closest('.admin-brand')) {
      mods.push('brand-wordmark--admin');
    }
    if (el.id === 'theme-preview-name' || el.closest('.admin-brand-settings-preview')) {
      mods.push('brand-wordmark--preview');
    }
    if (el.classList.contains('auth-logo-text') || el.closest('.auth-logo')) mods.push('brand-wordmark--auth');
    if (el.classList.contains('buyer-dash-brand-name')) mods.push('brand-wordmark--dash');
    return mods;
  }

  function upgradeToWordmark(el) {
    if (!el || el.closest('.brand-wordmark-wrap')) return el?.closest('.brand-wordmark-wrap') || null;
    const name = el.textContent.trim() || 'loveriette';
    const wrap = document.createElement('span');
    wrap.className = ['brand-wordmark-wrap', ...wordmarkModifiers(el)].join(' ');

    const back = document.createElement('span');
    back.className = 'brand-wordmark-back';
    back.setAttribute('aria-hidden', 'true');
    back.textContent = name;

    const front = document.createElement('span');
    front.className = 'brand-wordmark-front store-brand-name';
    if (el.classList.contains('admin-brand-name')) front.classList.add('admin-brand-name');
    if (el.classList.contains('auth-logo-text')) front.classList.add('auth-logo-text');
    if (el.classList.contains('buyer-dash-brand-name')) front.classList.add('buyer-dash-brand-name');
    if (el.id) front.id = el.id;
    front.textContent = name;

    el.replaceWith(wrap);
    wrap.append(back, front);
    return wrap;
  }

  function upgradeAllWordmarks() {
    document.querySelectorAll(LEGACY_NAME_SELECTOR).forEach(upgradeToWordmark);
  }

  function setBrandName(name) {
    const value = name || 'loveriette';
    const shadowLabel = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    document.querySelectorAll('.brand-wordmark-wrap').forEach((wrap) => {
      const back = wrap.querySelector('.brand-wordmark-back');
      const front = wrap.querySelector('.brand-wordmark-front');
      if (back) back.textContent = value;
      if (front) front.textContent = value;
    });
    document.querySelectorAll('.hero-display-shadow').forEach((el) => {
      el.textContent = shadowLabel;
    });
  }

  function wrapBrandLogo(img) {
    if (!img || img.closest('.brand-logo-shell')) return;
    const shell = document.createElement('span');
    shell.className = 'brand-logo-shell';
    shell.setAttribute('aria-hidden', 'true');
    img.parentNode.insertBefore(shell, img);
    shell.appendChild(img);
  }

  function wrapAllBrandLogos() {
    document.querySelectorAll(LOGO_IMG_SELECTOR).forEach(wrapBrandLogo);
  }

  function applyLogoAutoTheme(enabled) {
    document.documentElement.classList.toggle('logo-auto-theme', enabled);
  }

  function ensureDesktopBrand() {
    document.querySelectorAll('.nav-inner').forEach((inner) => {
      if (inner.querySelector('.store-brand')) return;
      const brand = document.createElement('a');
      brand.className = 'store-brand';
      brand.href = 'index.html';
      brand.innerHTML = buildBrandWordmarkHtml('loveriette');
      inner.insertBefore(brand, inner.firstChild);
    });
  }

  function applyBrandFonts(scriptKey, boldKey) {
    const script = scriptKey || 'Pinyon Script';
    const bold = boldKey || 'Syne';
    loadGoogleFont(script);
    loadGoogleFont(bold);
    document.documentElement.style.setProperty('--brand-font-script', fontFamily(script));
    document.documentElement.style.setProperty('--brand-font-bold', fontFamily(bold));
    document.documentElement.style.setProperty('--brand-font', fontFamily(script));
  }

  function applyStoreBranding(data) {
    const b = data || {};
    const name = b.name || 'loveriette';
    const logoUrl = b.logoUrl || '';
    const scriptFont = b.nameFont || 'Pinyon Script';
    const boldFont = b.nameFontBold || 'Syne';
    const logoAutoTheme = b.logoAutoTheme == null ? true : Boolean(b.logoAutoTheme);

    wrapAllBrandLogos();
    upgradeAllWordmarks();
    applyLogoAutoTheme(logoAutoTheme);
    applyBrandFonts(scriptFont, boldFont);
    setBrandName(name);

    document.querySelectorAll(LOGO_IMG_SELECTOR).forEach((img) => {
      const shell = img.closest('.brand-logo-shell');
      if (logoUrl) {
        img.src = logoUrl;
        img.hidden = false;
        if (shell) shell.hidden = false;
      } else {
        img.removeAttribute('src');
        img.hidden = true;
        if (shell) shell.hidden = true;
      }
    });
  }

  window.applyStoreBranding = applyStoreBranding;
  window.buildBrandWordmarkHtml = buildBrandWordmarkHtml;
  window.BRAND_FONT_OPTIONS = Object.keys(FONT_OPTIONS);
  window.BRAND_SCRIPT_FONTS = SCRIPT_FONTS;
  window.BRAND_BOLD_FONTS = BOLD_FONTS;

  async function initBranding() {
    if (!document.body?.classList.contains('admin-page')) {
      ensureDesktopBrand();
    }
    wrapAllBrandLogos();
    applyBrandFonts('Pinyon Script', 'Syne');
    try {
      const b = await fetch('/branding').then((r) => r.json());
      applyStoreBranding(b);
    } catch {
      upgradeAllWordmarks();
      applyLogoAutoTheme(true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBranding);
  } else {
    initBranding();
  }
})();
