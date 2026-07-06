const FLIRTY_BIO_FALLBACK = 'your go-to for premium digital goodies — shop, lend, build, and plug with someone who actually cares ';

function renderAboutSocials(links) {
  const orbit = document.getElementById('about-socials');
  if (!orbit) return;
  orbit.innerHTML = '';

  if (!links.length) {
    orbit.innerHTML = '<p class="about-social-empty flirty-prose">Social links coming soon.</p>';
    return;
  }

  links.forEach((s) => {
    const icon = window.socialIcon ? window.socialIcon(s.key) : '';
    const pill = document.createElement('a');
    pill.className = 'about-social-pill';
    pill.href = s.url;
    pill.target = '_blank';
    pill.rel = 'noopener noreferrer';
    pill.title = s.label || s.key;
    pill.innerHTML = `
      <span class="about-social-pill-icon">${icon}</span>
      <span class="about-social-pill-label">${s.label || s.key}</span>
    `;
    orbit.appendChild(pill);
  });
}

function renderProfile(profile) {
  const nameEl = document.getElementById('about-name');
  const bioEl = document.getElementById('about-bio');
  const photoEl = document.getElementById('about-photo');
  const locWrap = document.getElementById('about-location');
  const locText = document.getElementById('about-location-text');

  if (nameEl) nameEl.textContent = profile.displayName || profile.brandName || 'loveriette';
  if (bioEl) bioEl.textContent = profile.bio || FLIRTY_BIO_FALLBACK;
  if (photoEl) {
    const src = profile.photoUrl || '/assets/store-logo.png';
    photoEl.src = src;
    photoEl.alt = profile.displayName || 'Store profile';
    photoEl.onerror = () => { photoEl.src = '/assets/store-logo.png'; };
  }
  if (profile.location && locWrap && locText) {
    locText.textContent = profile.location;
    locWrap.hidden = false;
  } else if (locWrap) {
    locWrap.hidden = true;
  }
}

async function loadAbout() {
  let profile = null;
  let social = [];

  try {
    const res = await fetch('/store-profile', { credentials: 'include' });
    if (res.ok) profile = await res.json();
  } catch { /* ignore */ }

  try {
    const res = await fetch('/social', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) social = data;
    }
  } catch { /* ignore */ }

  if (!profile) {
    const page = document.getElementById('about-page');
    if (page) {
      page.innerHTML = '<p class="page-empty flirty-prose">profile\'s taking a little break — try again soon, love.</p>';
    }
    return;
  }

  renderProfile(profile);
  renderAboutSocials(social);
  if (window.renderFooterSocials) window.renderFooterSocials(social);

  document.getElementById('about-page')?.classList.add('about-loaded');
}

loadAbout();
