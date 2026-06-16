function renderFooterSocials(links) {
  const wrap = document.getElementById('footer-socials');
  if (!wrap) return;
  if (!links?.length) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = links.map((s) =>
    `<a href="${s.url}" target="_blank" rel="noopener noreferrer" aria-label="${s.label || s.key}" title="${s.label || s.key}">${window.socialIcon ? window.socialIcon(s.key) : ''}</a>`
  ).join('');
}

window.renderFooterSocials = renderFooterSocials;

async function loadFooterSocials() {
  let links = [];
  try {
    const res = await fetch('/social', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) links = data;
    }
  } catch { /* ignore */ }
  renderFooterSocials(links);
}

if (document.getElementById('footer-socials')) loadFooterSocials();
