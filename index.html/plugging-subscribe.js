document.addEventListener('DOMContentLoaded', async () => {
  if (typeof initPlatformNav === 'function') initPlatformNav('plugging');
  const params = new URLSearchParams(location.search);
  const planId = params.get('plan');
  const planSlug = params.get('slug');
  let plan = null;

  try {
    const data = await ApiCache.fetchJson('/api/plugging');
    if (planId) plan = data.plans?.find((p) => String(p.id) === String(planId));
    if (!plan && planSlug) plan = data.plans?.find((p) => p.slug === planSlug);
    if (!plan && data.plans?.length) plan = data.plans[0];
    if (!plan) throw new Error('Plan not found');
    document.getElementById('plan-id').value = plan.id;
    document.getElementById('plan-summary').textContent =
      `${plan.productName ? plan.productName + ' · ' : ''}${plan.name}${plan.duration ? ' (' + plan.duration + ')' : ''} — ${plan.priceLabel || '₱' + Number(plan.price).toLocaleString()}`;
    const descEl = document.getElementById('plan-description');
    if (descEl) {
      const desc = String(plan.description || '').trim();
      descEl.hidden = !desc;
      descEl.textContent = desc;
    }
  } catch (e) {
    document.getElementById('plan-summary').textContent = 'Could not load plan.';
  }

  document.getElementById('subscribe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('subscribe-error');
    err.hidden = true;
    const fd = new FormData(e.target);
    try {
      const res = await fetch('/api/plugging/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: fd.get('planId'),
          name: fd.get('name'),
          email: fd.get('email')
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Subscribe failed');
      location.href = json.paymentUrl || `/plugging/payment?order=${json.orderRef}`;
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
    }
  });
});
