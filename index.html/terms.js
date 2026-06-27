function renderTerms(sections) {
  const list = document.querySelector('.legal-list');
  if (!list) return;
  list.innerHTML = '';

  if (!sections.length) {
    list.innerHTML = '<p class="page-empty">Terms of service are not available yet.</p>';
    return;
  }

  sections.forEach((section) => {
    const card = document.createElement('article');
    card.className = 'info-card legal-card';
    card.innerHTML = `
      <h3>${section.title}</h3>
      <div class="legal-body flirty-prose">${section.body}</div>
    `;
    list.appendChild(card);
  });
}

async function loadTerms() {
  try {
    const res = await fetch('/terms', { credentials: 'include' });
    if (!res.ok) throw new Error('API unavailable');
    const sections = await res.json();
    renderTerms(Array.isArray(sections) ? sections : []);
  } catch {
    const list = document.querySelector('.legal-list');
    if (list) list.innerHTML = '<p class="page-empty">Could not load terms of service. Please refresh the page.</p>';
  }
}

loadTerms();
