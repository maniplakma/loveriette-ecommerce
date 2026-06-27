/* Product thumbnail icons via Iconify (https://iconify.design) */
(function () {
  const ICONIFY = 'https://api.iconify.design/';

  const PRODUCT_ICON_PRESETS = [
    { id: 'cbi:netflix-alt', label: 'Netflix' },
    { id: 'simple-icons:spotify', label: 'Spotify' },
    { id: 'arcticons:capcut', label: 'CapCut' },
    { id: 'simple-icons:canva', label: 'Canva' },
    { id: 'simple-icons:coursera', label: 'Coursera' },
    { id: 'simple-icons:grammarly', label: 'Grammarly' },
    { id: 'simple-icons:youtube', label: 'YouTube' },
    { id: 'simple-icons:disneyplus', label: 'Disney+' },
    { id: 'simple-icons:primevideo', label: 'Prime Video' },
    { id: 'simple-icons:openai', label: 'ChatGPT' },
    { id: 'simple-icons:microsoftoffice', label: 'Microsoft 365' },
    { id: 'simple-icons:adobe', label: 'Adobe' },
    { id: 'simple-icons:discord', label: 'Discord' },
    { id: 'simple-icons:telegram', label: 'Telegram' },
    { id: 'simple-icons:steam', label: 'Steam' },
    { id: 'simple-icons:crunchyroll', label: 'Crunchyroll' },
    { id: 'simple-icons:hbo', label: 'HBO Max' },
    { id: 'mdi:play-box-multiple', label: 'Streaming' },
    { id: 'mdi:book-education', label: 'Education' },
    { id: 'mdi:pencil-ruler', label: 'Editing' },
    { id: 'mdi:shield-check', label: 'Premium' }
  ];

  function productIconUrl(iconId, color) {
    if (!iconId) return '';
    const q = color ? `?color=${encodeURIComponent(color)}` : '';
    return `${ICONIFY}${encodeURIComponent(iconId)}.svg${q}`;
  }

  function renderProductIcon(iconId, name, className, color) {
    const cls = className || 'product-icon-img';
    const letter = (name || '?').charAt(0).toUpperCase();
    if (!iconId) {
      return `<span class="product-icon-fallback">${letter}</span>`;
    }
    const src = productIconUrl(iconId, color || '%23ff7070');
    return `<img class="${cls}" src="${src}" alt="${name || ''}" loading="lazy"
      onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'product-icon-fallback',textContent:'${letter.replace(/'/g, "\\'")}'}))">`;
  }

  function guessIconFromName(name) {
    const n = String(name || '').toLowerCase();
    const rules = [
      ['netflix', 'cbi:netflix-alt'],
      ['spotify', 'simple-icons:spotify'],
      ['capcut', 'arcticons:capcut'],
      ['canva', 'simple-icons:canva'],
      ['coursera', 'simple-icons:coursera'],
      ['grammarly', 'simple-icons:grammarly'],
      ['youtube', 'simple-icons:youtube'],
      ['disney', 'simple-icons:disneyplus'],
      ['prime', 'simple-icons:primevideo'],
      ['chatgpt', 'simple-icons:openai'],
      ['openai', 'simple-icons:openai'],
      ['discord', 'simple-icons:discord'],
      ['telegram', 'simple-icons:telegram'],
      ['steam', 'simple-icons:steam']
    ];
    for (const [key, id] of rules) {
      if (n.includes(key)) return id;
    }
    return '';
  }

  window.PRODUCT_ICON_PRESETS = PRODUCT_ICON_PRESETS;
  window.productIconUrl = productIconUrl;
  window.renderProductIcon = renderProductIcon;
  window.guessIconFromName = guessIconFromName;
})();
