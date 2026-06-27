/** Multi-service navigation helper */
function initPlatformNav(active) {
  document.querySelectorAll('.nav-left').forEach((nav) => {
    const items = [
      { href: '/', label: 'Home', key: 'home' },
      { href: '/shop', label: 'Shop', key: 'shop' },
      { href: '/lending', label: 'Lending', key: 'lending' },
      { href: '/website-making', label: 'Websites', key: 'website' },
      { href: '/plugging', label: 'Plugging', key: 'plugging' },
      { href: 'faqs.html', label: 'FAQs', key: 'faqs' },
      { href: 'contact.html', label: 'Contact', key: 'contact' }
    ];
    nav.innerHTML = items.map((i) =>
      `<li><a href="${i.href}" class="${i.key === active ? 'nav-pill active' : 'nav-link'}">${i.label}</a></li>`
    ).join('');
  });
}

window.initPlatformNav = initPlatformNav;
