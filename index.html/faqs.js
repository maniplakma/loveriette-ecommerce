function renderFaqs(faqs) {
  const list = document.querySelector('.faq-list');
  if (!list) return;
  list.innerHTML = '';

  if (!faqs.length) {
    list.innerHTML = '<p class="page-empty flirty-prose">no faqs yet — check back soon, babe.</p>';
    return;
  }

  faqs.forEach((faq) => {
    const card = document.createElement('article');
    card.className = 'info-card faq-card';
    card.innerHTML = `
      <h3>${faq.question}</h3>
      <p>${faq.answer}</p>
    `;
    list.appendChild(card);
  });
}

async function loadFaqs() {
  try {
    const res = await fetch('/faqs', { credentials: 'include' });
    if (!res.ok) throw new Error('API unavailable');
    const faqs = await res.json();
    renderFaqs(Array.isArray(faqs) ? faqs : []);
  } catch {
    const list = document.querySelector('.faq-list');
    if (list) list.innerHTML = '<p class="page-empty flirty-prose">couldn\'t load faqs — refresh and try again, love.</p>';
  }
}

loadFaqs();
