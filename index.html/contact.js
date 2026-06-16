function linkText(url) {
  if (!url) return '';
  if (url.startsWith('mailto:')) return url.replace('mailto:', '');
  const m = url.match(/t\.me\/([^/?#]+)/i);
  if (m) return '@' + m[1];
  try { return new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.replace(/\/$/, ''); }
  catch { return url; }
}

function renderContact(links) {
  const list = document.querySelector('.contact-list');
  if (!list) return;
  list.innerHTML = '';
  if (!links.length) {
    list.innerHTML = '<p class="page-empty">No contact links configured yet. Check back soon or message us through your order dashboard.</p>';
    return;
  }
  links.forEach((s) => {
    const icon = window.socialIcon ? window.socialIcon(s.key) : '';
    const card = document.createElement('article');
    card.className = 'info-card contact-card';
    card.innerHTML = `
      <div class="contact-icon">${icon}</div>
      <div class="contact-body">
        <h3>${s.label || s.key}</h3>
        <a href="${s.url}" target="_blank" rel="noopener noreferrer">${linkText(s.url)}</a>
      </div>
    `;
    list.appendChild(card);
  });
}

async function loadContact() {
  let links = [];
  try {
    const res = await fetch('/social', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) links = data;
    }
  } catch { /* ignore */ }
  renderContact(links);
  if (window.renderFooterSocials) window.renderFooterSocials(links);
}

loadContact();
