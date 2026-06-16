const STEP_ICONS = [

  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',

  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',

  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',

  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',

  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'

];



function escapeHtml(str) {

  return String(str || '')

    .replace(/&/g, '&amp;')

    .replace(/</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;');

}



function stepIcon(index) {

  return STEP_ICONS[index % STEP_ICONS.length];

}



function renderSteps(steps) {

  const list = document.getElementById('guide-steps');

  list.innerHTML = steps.map((step, i) => {

    const bullets = Array.isArray(step.bullets) ? step.bullets : [];

    const bulletHtml = bullets.length

      ? `<ul class="guide-step-bullets">${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`

      : '';

    return `

      <article class="guide-step info-card">

        <div class="guide-step-head">

          <span class="guide-step-badge" aria-hidden="true">

            <span class="guide-step-icon">${stepIcon(i)}</span>

            <span class="guide-step-num">${escapeHtml(step.number || String(i + 1))}</span>

          </span>

          <div class="guide-step-title-wrap">

            <h2>${escapeHtml(step.title)}</h2>

            <p class="guide-step-desc">${escapeHtml(step.description)}</p>

          </div>

        </div>

        ${bulletHtml}

      </article>

    `;

  }).join('');

  list.hidden = false;

}



async function loadGuide() {

  const loading = document.getElementById('guide-loading');

  const errorEl = document.getElementById('guide-error');



  try {

    const res = await fetch('/guide', { credentials: 'include' });

    if (!res.ok) throw new Error('API error');

    const steps = await res.json();

    if (!Array.isArray(steps) || !steps.length) throw new Error('No steps');

    loading.hidden = true;

    renderSteps(steps);

  } catch {

    loading.hidden = true;

    errorEl.hidden = false;

  }

}



loadGuide();

