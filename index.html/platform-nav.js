/** Multi-service navigation — professional labels; skip rewrite if HTML already has links */
function initPlatformNav(active) {
  if (!active) return;
  const items = [
    { href: '/', label: 'Home', key: 'home' },
    { href: '/shop', label: 'Shop', key: 'shop' },
    { href: '/plugging', label: 'Plugging', key: 'plugging' },
    { href: '/website-making', label: 'Website Making', key: 'website' },
    { href: 'about.html', label: 'About', key: 'about' },
    { href: 'faqs.html', label: 'FAQ', key: 'faqs' },
    { href: 'contact.html', label: 'Contact', key: 'contact' }
  ];
  document.querySelectorAll('.nav-left').forEach((nav) => {
    if (nav.children.length > 0) {
      nav.querySelectorAll('a').forEach((a) => {
        a.classList.remove('nav-pill', 'active', 'nav-link');
        const href = a.getAttribute('href') || '';
        const key = items.find((i) => href === i.href || href === i.href.replace(/^\//, ''))?.key;
        if (key === active) {
          a.classList.add('nav-pill', 'active');
        } else {
          a.classList.add('nav-link');
        }
      });
      return;
    }
    nav.innerHTML = items.map((i) =>
      `<li><a href="${i.href}" class="${i.key === active ? 'nav-pill active' : 'nav-link'}">${i.label}</a></li>`
    ).join('');
  });
}

window.initPlatformNav = initPlatformNav;
