const params = new URLSearchParams(location.search);
const prePlan = params.get('plan');

async function initApply() {
  const data = await ApiCache.fetchJson('/api/lending');
  const select = document.getElementById('plan-select');
  (data.plans || []).forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    opt.dataset.slug = p.slug;
    if (p.slug === prePlan) opt.selected = true;
    select.append(opt);
  });

  const fieldsEl = document.getElementById('dynamic-fields');
  fieldsEl.innerHTML = (data.applyFields || []).map((f) => {
    if (f.type === 'textarea') {
      return `<label>${f.label}${f.required ? ' *' : ''}<textarea name="${f.key}" ${f.required ? 'required' : ''}></textarea></label>`;
    }
    return `<label>${f.label}${f.required ? ' *' : ''}<input type="${f.type || 'text'}" name="${f.key}" ${f.required ? 'required' : ''}></label>`;
  }).join('');

  document.getElementById('apply-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const formData = {};
    fd.forEach((v, k) => { if (k !== 'planId') formData[k] = v; });
    const planId = select.value ? Number(select.value) : null;
    try {
      const res = await fetch('/api/lending/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ planId, formData })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      location.href = `order-thanks.html?type=lending&ref=${encodeURIComponent(json.applicationId)}`;
    } catch (err) {
      if (window.showToast) showToast(err.message || 'Failed to submit');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initPlatformNav('lending');
  initApply().catch(() => {});
});
