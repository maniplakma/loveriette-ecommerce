/** Multi-service navigation — Shop, Games, Plugging, Website Making */
function initPlatformNav(active) {
  if (!active) return;
  const items = [
    { href: '/', label: 'Home', key: 'home' },
    { href: '/shop', label: 'Shop', key: 'shop' },
    { href: '/games', label: 'Games', key: 'games' },
    { href: '/plugging', label: 'Plugging', key: 'plugging' },
    { href: '/website-making', label: 'Website Making', key: 'website' },
    { href: 'about.html', label: 'About', key: 'about' },
    { href: 'faqs.html', label: 'FAQ', key: 'faqs' },
    { href: 'contact.html', label: 'Contact', key: 'contact' }
  ];
  document.querySelectorAll('.nav-left').forEach((nav) => {
    nav.innerHTML = items.map((i) =>
      `<li><a href="${i.href}" class="${i.key === active ? 'nav-pill active' : 'nav-link'}">${i.label}</a></li>`
    ).join('');
  });
}

window.initPlatformNav = initPlatformNav;
