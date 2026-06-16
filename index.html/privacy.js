function renderPrivacy(sections) {
  const list = document.querySelector('.legal-list');
  if (!list) return;
  list.innerHTML = '';

  if (!sections.length) {
    list.innerHTML = '<p class="page-empty">Privacy policy is not available yet.</p>';
    return;
  }

  sections.forEach((section) => {
    const card = document.createElement('article');
    card.className = 'info-card legal-card';
    card.innerHTML = `
      <h3>${section.title}</h3>
      <div class="legal-body">${section.body}</div>
    `;
    list.appendChild(card);
  });
}

async function loadPrivacy() {
  try {
    const res = await fetch('/privacy', { credentials: 'include' });
    if (!res.ok) throw new Error('API unavailable');
    const sections = await res.json();
    renderPrivacy(Array.isArray(sections) ? sections : []);
  } catch {
    const list = document.querySelector('.legal-list');
    if (list) list.innerHTML = '<p class="page-empty">Could not load privacy policy. Please refresh the page.</p>';
  }
}

loadPrivacy();
