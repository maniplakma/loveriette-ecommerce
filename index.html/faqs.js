const DEFAULT_FAQS = [
  {
    question: 'How do I get my account after payment?',
    answer: 'After your payment is approved, sign in and open My Account → Purchases. Your credentials (email, password, PIN, or access details) appear on the order page for that purchase. Delivery is digital only — nothing is shipped physically. If details are missing after approval, contact support with your order number and payment proof.'
  },
  {
    question: 'Is there a warranty on digital products?',
    answer: 'Yes. Eligible shop items include a warranty period stated on the product page (commonly 30 days from delivery). Warranty covers defects such as login failure or service not working as described when used according to the product rules. It does not cover misuse, sharing against policy, or changes you make that break shared accounts. Open a support ticket with your order ID to request warranty service.'
  },
  {
    question: 'Can I change the password on my account?',
    answer: 'For shared or profile-type products, do not change the registered email or password unless the listing explicitly allows it — unauthorized changes may void your warranty. For private or solo accounts labeled as fully yours, you may customize credentials after delivery. Always read the product description and order notes before modifying anything.'
  },
  {
    question: 'What if I paid the wrong amount?',
    answer: 'Orders with incorrect payment amounts may be held or rejected until the difference is settled or the order is cancelled. Pay exactly the total shown at checkout and upload a clear, unedited receipt. Contact support before submitting a new payment if you are unsure.'
  },
  {
    question: 'How do refunds work?',
    answer: 'Digital goods are generally final once delivered and working as described. Refunds or replacements are considered only for defective, incorrect, or misdescribed items, and must be requested within the timeframe stated in our Terms of Service (typically within 24 hours of purchase with valid proof). Chargebacks without contacting us first may result in account suspension.'
  },
  {
    question: 'How can I reach support?',
    answer: 'Use the Contact page for Telegram, email, and channel links. When messaging support, include your registered email, order number, and a screenshot of the issue. Response times vary by queue volume; Telegram is usually the fastest during business hours.'
  }
];

function renderFaqs(faqs) {
  const list = document.querySelector('.faq-list');
  if (!list) return;
  list.innerHTML = '';

  if (!faqs.length) {
    list.innerHTML = '<p class="page-empty">No FAQs available yet.</p>';
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
    const list = Array.isArray(faqs) && faqs.length ? faqs : DEFAULT_FAQS;
    renderFaqs(list);
  } catch {
    renderFaqs(DEFAULT_FAQS);
  }
}

loadFaqs();
