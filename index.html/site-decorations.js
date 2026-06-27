/**
 * Page-top corners only — admin, payment, buyer dashboard.
 * Transparent PNG cutouts. Scrolls away (not fixed). One icon per corner.
 */
(function () {
  const PNG = {
    web: '/assets/deco-web-corner-cut.png?v=2',
    dice: '/assets/deco-dice-cut.png?v=2',
    webFull: '/assets/deco-web-cut.png?v=2',
    eyes: '/assets/deco-eyes-cut.png?v=2',
    spiral: '/assets/deco-spiral-cut.png?v=2',
    ball7: '/assets/deco-ball7-cut.png?v=2'
  };

  const SVG = {
    heart: '/assets/deco-heart.svg',
    star: '/assets/deco-star.svg',
    rose: '/assets/deco-rose.svg',
    bat: '/assets/deco-bat.svg',
    moon: '/assets/deco-moon.svg',
    cross: '/assets/deco-cross.svg',
    lips: '/assets/deco-lips.svg',
    cherry: '/assets/deco-cherry.svg',
    crown: '/assets/deco-crown.svg'
  };

  const ZONES = {
    admin: {
      bodyClass: 'site-deco-zone--admin',
      corners: { tl: PNG.web, tr: PNG.dice, bl: SVG.crown, br: SVG.bat }
    },
    payment: {
      bodyClass: 'site-deco-zone--payment',
      corners: { tl: PNG.eyes, tr: PNG.spiral, bl: PNG.ball7, br: PNG.web }
    },
    buyer: {
      bodyClass: 'site-deco-zone--buyer',
      corners: { tl: PNG.dice, tr: SVG.lips, bl: PNG.eyes, br: SVG.star }
    }
  };

  function getZone() {
    const path = location.pathname.toLowerCase();
    if (document.body.classList.contains('page-home')) return null;
    if (path === '/' || path.endsWith('/index.html') || path.endsWith('index.html')) return null;
    if (document.body.classList.contains('admin-page') || path.includes('admin.html')) return 'admin';
    if (document.body.classList.contains('buyer-dashboard-page') || path.includes('dashboard.html')) return 'buyer';
    if (
      document.querySelector('.payment-page') ||
      path.includes('payment.html') ||
      path.includes('checkout.html') ||
      path.includes('order-thanks.html') ||
      path.includes('plugging-payment')
    ) return 'payment';
    return null;
  }

  function addPageCorners(config) {
    if (document.getElementById('site-page-corners')) return;

    const band = document.createElement('div');
    band.id = 'site-page-corners';
    band.className = 'site-page-corners';
    band.setAttribute('aria-hidden', 'true');

    Object.entries(config.corners).forEach(([pos, src]) => {
      const img = document.createElement('img');
      img.src = src;
      img.className = `deco-page-corner deco-page-corner--${pos}`;
      img.alt = '';
      img.decoding = 'async';
      img.setAttribute('aria-hidden', 'true');
      band.appendChild(img);
    });

    document.body.prepend(band);
  }

  function init() {
    const zoneKey = getZone();
    if (!zoneKey) return;
    const config = ZONES[zoneKey];
    document.body.classList.add('site-deco-active', config.bodyClass);
    addPageCorners(config);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
