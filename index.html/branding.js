/* Store logo + name font — loaded from /branding (admin Theme settings) */
(function () {
  const FONT_OPTIONS = {
    'system-ui': 'system-ui, -apple-system, sans-serif',
    Pacifico: '"Pacifico", cursive',
    Fredoka: '"Fredoka", system-ui, sans-serif',
    Quicksand: '"Quicksand", system-ui, sans-serif',
    Poppins: '"Poppins", system-ui, sans-serif',
    'Playfair Display': '"Playfair Display", Georgia, serif',
    Caveat: '"Caveat", cursive',
    Nunito: '"Nunito", system-ui, sans-serif'
  };

  const GOOGLE_FONTS = ['Pacifico', 'Fredoka', 'Quicksand', 'Poppins', 'Playfair Display', 'Caveat', 'Nunito'];
  const LOGO_IMG_SELECTOR = '.store-brand-logo, .admin-brand-logo-img, .auth-logo-img';

  function loadGoogleFont(name) {
    if (!GOOGLE_FONTS.includes(name)) return;
    const id = `gf-brand-${name.replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;600;700&display=swap`;
    document.head.appendChild(link);
  }

  function fontFamily(key) {
    return FONT_OPTIONS[key] || FONT_OPTIONS['system-ui'];
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
      brand.innerHTML = '<span class="store-brand-name brand-wordmark">loveriette</span>';
      inner.insertBefore(brand, inner.firstChild);
    });
  }

  function applyStoreBranding(data) {
    const b = data || {};
    const name = b.name || 'loveriette';
    const logoUrl = b.logoUrl || '';
    const fontKey = b.nameFont || 'system-ui';
    const logoAutoTheme = b.logoAutoTheme == null ? true : Boolean(b.logoAutoTheme);

    wrapAllBrandLogos();
    applyLogoAutoTheme(logoAutoTheme);

    if (fontKey !== 'system-ui') loadGoogleFont(fontKey);
    document.documentElement.style.setProperty('--brand-font', fontFamily(fontKey));

    document.querySelectorAll('.store-brand-name, .admin-brand-name, .auth-logo-text').forEach((el) => {
      el.textContent = name;
      el.style.fontFamily = fontFamily(fontKey);
    });

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
  window.BRAND_FONT_OPTIONS = Object.keys(FONT_OPTIONS);

  async function initBranding() {
    if (!document.body?.classList.contains('admin-page')) {
      ensureDesktopBrand();
    }
    wrapAllBrandLogos();
    try {
      const b = await fetch('/branding').then((r) => r.json());
      applyStoreBranding(b);
    } catch {
      applyLogoAutoTheme(true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBranding);
  } else {
    initBranding();
  }
})();
