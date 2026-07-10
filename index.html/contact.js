const DEFAULT_CONTACT_CHANNELS = [
  {
    icon: 'telegram',
    title: 'Telegram',
    description: 'Chat with us directly on Telegram for the fastest response.',
    link_text: '@skyloverie',
    link_url: 'https://t.me/skyloverie'
  },
  {
    icon: 'email',
    title: 'Email',
    description: 'Send us an email and we will get back to you as soon as possible.',
    link_text: 'riettemadzehn@gmail.com',
    link_url: 'mailto:riettemadzehn@gmail.com'
  },
  {
    icon: 'channel',
    title: 'Telegram Channel',
    description: 'Join our Telegram channel for updates, promos, and announcements.',
    link_text: '@lovebyriette',
    link_url: 'https://t.me/lovebyriette'
  }
];

function linkText(url) {
  if (!url) return '';
  if (url.startsWith('mailto:')) return url.replace('mailto:', '');
  const m = url.match(/t\.me\/([^/?#]+)/i);
  if (m) return '@' + m[1];
  try { return new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.replace(/\/$/, ''); }
  catch { return url; }
}

function renderContact(channels) {
  const list = document.querySelector('.contact-list');
  if (!list) return;
  list.innerHTML = '';
  if (!channels.length) {
    list.innerHTML = '<p class="page-empty">No contact channels available. Please try again later.</p>';
    return;
  }
  channels.forEach((ch) => {
    const icon = window.socialIcon ? window.socialIcon(ch.icon || ch.key || 'link') : '';
    const label = ch.title || ch.label || ch.key || 'Contact';
    const url = ch.link_url || ch.url || '';
    const display = ch.link_text || linkText(url);
    const card = document.createElement('article');
    card.className = 'info-card contact-card';
    card.innerHTML = `
      <div class="contact-icon">${icon}</div>
      <div class="contact-body">
        <h3>${label}</h3>
        ${ch.description ? `<p class="contact-desc">${ch.description}</p>` : ''}
        <a href="${url}" target="_blank" rel="noopener noreferrer">${display}</a>
      </div>
    `;
    list.appendChild(card);
  });
}

function channelsToSocialLinks(channels) {
  return channels.map((ch) => ({
    key: ch.icon || 'link',
    label: ch.title || ch.label || '',
    url: ch.link_url || ch.url || '',
    enabled: true
  })).filter((l) => l.url);
}

async function loadContact() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('subject') === 'password-reset') {
    const header = document.querySelector('.info-header p');
    if (header) {
      header.innerHTML = 'Use the <a href="forgot-password.html">Forgot password</a> page — we\'ll email you a secure reset link. If email reset is unavailable, contact us with the email on your account.';
    }
  }

  let channels = [];
  try {
    const res = await fetch('/contact', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) channels = data.filter((c) => c.link_url);
    }
  } catch { /* ignore */ }

  if (!channels.length) channels = DEFAULT_CONTACT_CHANNELS;
  renderContact(channels);
  if (window.renderFooterSocials) window.renderFooterSocials(channelsToSocialLinks(channels));
}

loadContact();
