(function renderBrandLogos() {
  const mount = document.querySelector('.brand-logos');
  if (!mount) return;

  const base = 'https://api.iconify.design/';
  const brands = [
    { name: 'Netflix', icon: 'cbi:netflix-alt', slot: 'slot-1', delay: '0s' },
    { name: 'Spotify', icon: 'simple-icons:spotify', color: '%231db954', slot: 'slot-2', delay: '0.55s' },
    { name: 'CapCut', icon: 'arcticons:capcut', slot: 'slot-3', delay: '1.1s' },
    { name: 'Canva', icon: 'simple-icons:canva', slot: 'slot-4', delay: '0.85s' },
    { name: 'ChatGPT', icon: 'simple-icons:openai', color: '%2310a37f', slot: 'slot-5', delay: '1.45s' }
  ];

  mount.classList.add('brand-logos-scatter');
  mount.innerHTML = brands.map((brand) => {
    const colorParam = brand.color ? `?color=${brand.color}` : '';
    return `
    <div class="brand-logo-item brand-logo-item--${brand.slot}" style="--float-delay: ${brand.delay}">
      <div class="brand-logo-tile">
        <img src="${base}${brand.icon}.svg${colorParam}" alt="" loading="lazy"
             onerror="this.closest('.brand-logo-item').style.display='none'">
      </div>
      <span class="sr-only">${brand.name}</span>
    </div>`;
  }).join('');
})();
