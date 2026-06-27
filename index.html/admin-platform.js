/** Admin platform management: CMS, lending, website-making, analytics */
(function () {
  const api = window.api || (async (url, opts = {}) => {
    const res = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts, body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  });

  const peso = (n) => `₱${Number(n || 0).toLocaleString()}`;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  /* ── CMS ── */
  window.loadPlatformCms = async function loadPlatformCms() {
    const data = await api('/admin/cms/homepage');

    document.getElementById('cms-stats-list').innerHTML = (data.statistics || []).map((s) => `
      <div class="admin-card" style="margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center">
        <span><strong>${esc(s.label)}</strong>: ${esc(s.value)} ${s.is_enabled ? '' : '(disabled)'}</span>
        <button class="admin-btn admin-btn-danger admin-btn-sm" data-del-stat="${s.id}">Delete</button>
      </div>`).join('') || '<p class="admin-empty">No statistics yet.</p>';

    document.getElementById('cms-faqs-list').innerHTML = (data.faqs || []).map((f) => `
      <div class="admin-card" style="margin-bottom:0.5rem">
        <span class="admin-card-meta">[${esc(f.scope)}]</span> <strong>${esc(f.question)}</strong>
        <button class="admin-btn admin-btn-danger admin-btn-sm" data-del-faq="${f.id}">Delete</button>
      </div>`).join('') || '<p class="admin-empty">No FAQs.</p>';

    document.getElementById('cms-sections-list').innerHTML = (data.sections || []).map((s) => `
      <div class="admin-card" style="margin-bottom:0.5rem">
        <strong>${esc(s.section_key)}</strong> — ${esc(s.title)}
        <span class="admin-card-meta">${s.is_enabled ? 'enabled' : 'disabled'}</span>
      </div>`).join('');

    const svcSection = (data.sections || []).find((s) => s.section_key === 'service_categories');
    if (svcSection) {
      document.getElementById('cms-services-title').value = svcSection.title || '';
      document.getElementById('cms-services-subtitle').value = svcSection.subtitle || '';
      let content = {};
      try { content = JSON.parse(svcSection.content_json || '{}'); } catch (_) {}
      renderCmsServiceItems(content.items || []);
    }

    if (data.footer) {
      document.getElementById('footer-tagline-input').value = data.footer.footer_tagline || '';
      document.getElementById('footer-copyright-input').value = data.footer.footer_copyright || '';
    }

    bindCmsEvents();
  };

  function renderCmsServiceItems(items) {
    const wrap = document.getElementById('cms-services-items');
    if (!wrap) return;
    wrap.innerHTML = items.map((item, i) => `
      <div class="admin-card cms-service-row" style="margin-bottom:0.75rem;padding:0.75rem" data-idx="${i}">
        <div class="admin-field"><label>Title</label><input class="svc-title" value="${esc(item.title)}"></div>
        <div class="admin-field"><label>Description</label><textarea class="svc-desc" rows="2">${esc(item.desc || item.text || '')}</textarea></div>
        <div class="admin-field"><label>Link</label><input class="svc-link" value="${esc(item.link)}"></div>
        <div class="admin-field"><label>Button Label</label><input class="svc-cta" value="${esc(item.cta || item.title)}"></div>
        <div class="admin-field"><label>Icon (cart, loan, web, plug, shield, zap, heart, star)</label><input class="svc-icon" value="${esc(item.icon || 'star')}"></div>
        <label class="admin-toggle"><input type="checkbox" class="svc-primary" ${item.primary ? 'checked' : ''}> <span>Primary button style</span></label>
        <button type="button" class="admin-btn admin-btn-danger admin-btn-sm cms-service-del" data-idx="${i}">Remove</button>
      </div>`).join('');
  }

  function collectCmsServiceItems() {
    return [...document.querySelectorAll('.cms-service-row')].map((row) => ({
      title: row.querySelector('.svc-title')?.value?.trim() || '',
      desc: row.querySelector('.svc-desc')?.value?.trim() || '',
      link: row.querySelector('.svc-link')?.value?.trim() || '',
      cta: row.querySelector('.svc-cta')?.value?.trim() || '',
      icon: row.querySelector('.svc-icon')?.value?.trim() || 'star',
      primary: !!row.querySelector('.svc-primary')?.checked
    })).filter((i) => i.title && i.link);
  }

  function bindCmsEvents() {
    document.getElementById('cms-stat-add')?.replaceWith(document.getElementById('cms-stat-add').cloneNode(true));
    document.getElementById('cms-stat-add')?.addEventListener('click', async () => {
      const label = prompt('Stat label:');
      const value = prompt('Stat value:');
      if (!label || !value) return;
      await api('/admin/cms/statistics', { method: 'POST', body: { label, value } });
      loadPlatformCms();
    });

    document.querySelectorAll('[data-del-stat]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/admin/cms/statistics/${b.dataset.delStat}`, { method: 'DELETE' });
      loadPlatformCms();
    }));

    document.getElementById('cms-faq-add')?.addEventListener('click', async () => {
      const scope = prompt('Scope (home/lending/website/plugging):', 'home');
      const question = prompt('Question:');
      const answer = prompt('Answer:');
      if (!question || !answer) return;
      await api('/admin/cms/faqs', { method: 'POST', body: { scope, question, answer } });
      loadPlatformCms();
    });

    document.querySelectorAll('[data-del-faq]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/admin/cms/faqs/${b.dataset.delFaq}`, { method: 'DELETE' });
      loadPlatformCms();
    }));

    document.getElementById('cms-footer-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api('/admin/cms/footer', { method: 'PUT', body: Object.fromEntries(fd) });
      if (window.showToast) showToast('Footer saved');
    });

    document.getElementById('cms-services-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const items = collectCmsServiceItems();
      await api('/admin/cms/sections/service_categories', {
        method: 'PUT',
        body: {
          title: document.getElementById('cms-services-title').value,
          subtitle: document.getElementById('cms-services-subtitle').value,
          contentJson: { items }
        }
      });
      if (window.showToast) showToast('Services saved');
      loadPlatformCms();
    });

    document.getElementById('cms-service-add')?.addEventListener('click', () => {
      const items = collectCmsServiceItems();
      items.push({ title: 'New Service', desc: '', link: '/', icon: 'star', cta: 'Explore' });
      renderCmsServiceItems(items);
    });

    document.querySelectorAll('.cms-service-del').forEach((b) => b.addEventListener('click', () => {
      const items = collectCmsServiceItems();
      items.splice(Number(b.dataset.idx), 1);
      renderCmsServiceItems(items);
    }));
  }

  /* ── Lending ── */
  window.loadPlatformLending = async function loadPlatformLending() {
    const data = await api('/admin/lending');
    const s = data.settings || {};

    const form = document.getElementById('lending-settings-form');
    form.querySelector('[name="lending_enabled"]').checked = s.lending_enabled !== '0';
    form.querySelector('[name="lending_hero_title"]').value = s.lending_hero_title || '';
    form.querySelector('[name="lending_hero_subtitle"]').value = s.lending_hero_subtitle || '';
    form.querySelector('[name="lending_contact_email"]').value = s.lending_contact_email || '';
    form.querySelector('[name="lending_contact_phone"]').value = s.lending_contact_phone || '';

    document.getElementById('lending-plans-list').innerHTML = (data.plans || []).map((p) => `
      <div class="admin-card" style="margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <div>
          <strong>${esc(p.name)}</strong> — ${p.interest_rate}% · ${p.is_enabled ? 'enabled' : 'disabled'}<br>
          <small class="admin-card-meta"><a href="/lending/plan/${esc(p.slug)}" target="_blank">/lending/plan/${esc(p.slug)}</a></small>
        </div>
        <div>
          <button class="admin-btn admin-btn-ghost admin-btn-sm" data-edit-plan="${p.id}">Edit</button>
          <button class="admin-btn admin-btn-danger admin-btn-sm" data-del-plan="${p.id}">Delete</button>
        </div>
      </div>`).join('') || '<p class="admin-empty">No loan plans.</p>';

    document.getElementById('lending-apps-list').innerHTML = (data.applications || []).map((a) => `
      <div class="admin-card" style="margin-bottom:0.5rem">
        <strong>${esc(a.application_id)}</strong> — ${esc(a.status)} · ${esc(a.plan_name || 'No plan')}<br>
        <small class="admin-card-meta">${esc(a.created_at)}</small>
        <select data-app-status="${a.id}" style="margin-left:0.5rem">
          ${['pending', 'reviewing', 'approved', 'rejected'].map((st) => `<option ${a.status === st ? 'selected' : ''}>${st}</option>`).join('')}
        </select>
      </div>`).join('') || '<p class="admin-empty">No applications yet.</p>';

    bindLendingEvents(data.plans || []);
  };

  function bindLendingEvents(plans) {
    document.getElementById('lending-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      body.lending_enabled = e.target.querySelector('[name="lending_enabled"]').checked ? '1' : '0';
      await api('/admin/lending/settings', { method: 'PUT', body });
      if (window.showToast) showToast('Lending settings saved');
    }, { once: true });

    document.getElementById('lending-plan-add')?.addEventListener('click', async () => {
      const name = prompt('Plan name:');
      if (!name) return;
      await api('/admin/lending/plans', { method: 'POST', body: { name, description: '', minAmount: 1000, maxAmount: 50000, interestRate: 3, adminFee: 200, termMonths: 3 } });
      loadPlatformLending();
    });

    document.querySelectorAll('[data-del-plan]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this plan?')) return;
      await api(`/admin/lending/plans/${b.dataset.delPlan}`, { method: 'DELETE' });
      loadPlatformLending();
    }));

    document.querySelectorAll('[data-edit-plan]').forEach((b) => b.addEventListener('click', async () => {
      const plan = plans.find((p) => p.id == b.dataset.editPlan);
      if (!plan) return;
      const name = prompt('Plan name:', plan.name);
      const rate = prompt('Interest rate (%):', plan.interest_rate);
      if (name) await api(`/admin/lending/plans/${plan.id}`, { method: 'PUT', body: { name, interestRate: Number(rate) || plan.interest_rate } });
      loadPlatformLending();
    }));

    document.querySelectorAll('[data-app-status]').forEach((sel) => sel.addEventListener('change', async () => {
      await api(`/admin/lending/applications/${sel.dataset.appStatus}`, { method: 'PUT', body: { status: sel.value } });
    }));
  }

  /* ── Website Making ── */
  window.loadPlatformWebsite = async function loadPlatformWebsite() {
    const data = await api('/admin/website-making');

    document.getElementById('web-packages-list').innerHTML = (data.packages || []).map((p) => `
      <div class="admin-card" style="margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <div>
          <strong>${esc(p.name)}</strong> — ${peso(p.price)} · ${p.is_enabled ? 'enabled' : 'disabled'}<br>
          <small class="admin-card-meta"><a href="/website-making/${esc(p.slug)}" target="_blank">/website-making/${esc(p.slug)}</a></small>
        </div>
        <button class="admin-btn admin-btn-danger admin-btn-sm" data-del-pkg="${p.id}">Delete</button>
      </div>`).join('') || '<p class="admin-empty">No packages.</p>';

    document.getElementById('web-inquiries-list').innerHTML = (data.inquiries || []).map((i) => `
      <div class="admin-card" style="margin-bottom:0.5rem">
        <strong>${esc(i.name)}</strong> (${esc(i.email)}) — ${esc(i.status)}<br>
        <small>${esc(i.message?.slice(0, 100))}</small>
        <button class="admin-btn admin-btn-ghost admin-btn-sm" data-mark-inq="${i.id}">Mark Reviewed</button>
      </div>`).join('') || '<p class="admin-empty">No inquiries.</p>';

    document.getElementById('web-pkg-add')?.addEventListener('click', async () => {
      const name = prompt('Package name:');
      const price = prompt('Price (₱):', '15000');
      if (!name) return;
      await api('/admin/website-making/packages', { method: 'POST', body: { name, price: Number(price) || 0, description: '', features: [] } });
      loadPlatformWebsite();
    }, { once: true });

    document.querySelectorAll('[data-del-pkg]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete package?')) return;
      await api(`/admin/website-making/packages/${b.dataset.delPkg}`, { method: 'DELETE' });
      loadPlatformWebsite();
    }));

    document.querySelectorAll('[data-mark-inq]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/admin/website-making/inquiries/${b.dataset.markInq}`, { method: 'PUT', body: { status: 'reviewed' } });
      loadPlatformWebsite();
    }));
  };

  /* ── Plugging ── */
  window.loadPlatformPlugging = async function loadPlatformPlugging() {
    const data = await api('/admin/plugging');
    const s = data.settings || {};
    const form = document.getElementById('plugging-settings-form');
    form.querySelector('[name="plugging_enabled"]').checked = s.plugging_enabled !== '0';
    form.querySelector('[name="plugging_hero_title"]').value = s.plugging_hero_title || '';
    form.querySelector('[name="plugging_hero_subtitle"]').value = s.plugging_hero_subtitle || '';
    form.querySelector('[name="plugging_contact_telegram"]').value = s.plugging_contact_telegram || '';
    form.querySelector('[name="telegram_api_id"]').value = s.telegram_api_id || '';
    form.querySelector('[name="telegram_api_hash"]').value = s.telegram_api_hash || '';
    form.querySelector('[name="proxy_url"]').value = s.proxy_url || '';
    form.querySelector('[name="proxy_enabled"]').checked = s.proxy_enabled === '1';

    const orders = await api('/admin/plugging/orders');
    document.getElementById('plugging-orders-list').innerHTML = (orders || []).map((o) => `
      <div class="admin-card" style="margin-bottom:0.75rem">
        <strong>${esc(o.order_ref)}</strong> — ${esc(o.customer_name)} · ${esc(o.status)}<br>
        <small class="admin-card-meta">${esc(o.plan_name)} · ${peso(o.total)}</small>
        ${o.access_key ? `<br><code style="font-size:0.85rem">Key: ${esc(o.access_key)}</code>` : ''}
        ${o.receipt_path ? `<br><a href="${esc(o.receipt_path)}" target="_blank">View receipt</a>` : ''}
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap">
          ${o.status === 'pending_approval' ? `<button class="admin-btn admin-btn-primary admin-btn-sm" data-approve-order="${o.id}">Approve & Issue Key</button>
          <button class="admin-btn admin-btn-danger admin-btn-sm" data-reject-order="${o.id}">Reject</button>` : ''}
        </div>
      </div>`).join('') || '<p class="admin-empty">No subscription orders yet.</p>';

    document.querySelectorAll('[data-approve-order]').forEach((b) => b.addEventListener('click', async () => {
      const r = await api(`/admin/plugging/orders/${b.dataset.approveOrder}`, { method: 'PUT', body: { status: 'approved' } });
      if (window.showToast) showToast(`Approved — Key: ${r.accessKey}`);
      loadPlatformPlugging();
    }));
    document.querySelectorAll('[data-reject-order]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/admin/plugging/orders/${b.dataset.rejectOrder}`, { method: 'PUT', body: { status: 'rejected' } });
      loadPlatformPlugging();
    }));

    document.getElementById('plugging-products-list').innerHTML = (data.products || []).map((prod) => `
      <div class="admin-card" style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem">
          <div>
            <strong>${esc(prod.name)}</strong> · /plugging/plan/${esc(prod.slug)} · ${prod.is_enabled ? 'enabled' : 'disabled'}<br>
            <small class="admin-card-meta">${esc(prod.description?.slice(0, 100))}</small>
          </div>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
            <button class="admin-btn admin-btn-ghost admin-btn-sm" data-add-variant="${prod.id}" data-product-name="${esc(prod.name)}">+ Variant</button>
            <button class="admin-btn admin-btn-danger admin-btn-sm" data-del-plug-product="${prod.id}">Delete Product</button>
          </div>
        </div>
        ${(prod.variants || []).map((v) => `
          <div class="admin-card" style="margin:0.35rem 0 0.35rem 1rem;padding:0.65rem 0.85rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
            <div>
              <strong>${esc(v.name)}</strong>${v.duration ? ` · ${esc(v.duration)}` : ''} — ${peso(v.price)} · ${v.max_sources ?? v.maxSources}→${v.max_destinations ?? v.maxDestinations}
              ${v.is_enabled === 0 ? ' · <em>disabled</em>' : ''}
            </div>
            <button class="admin-btn admin-btn-danger admin-btn-sm" data-del-plug-plan="${v.id}">Delete</button>
          </div>`).join('') || '<p class="admin-empty" style="margin-left:1rem">No variants — add 7 Days, 30 Days, etc.</p>'}
      </div>`).join('') || '<p class="admin-empty">No products yet. Add Standard Plugging, then add variants.</p>';

    const statuses = ['pending', 'setting_up', 'active', 'paused', 'rejected'];
    document.getElementById('plugging-requests-list').innerHTML = (data.requests || []).map((r) => `
      <div class="admin-card" style="margin-bottom:0.75rem">
        <strong>${esc(r.request_id)}</strong> — @${esc(r.telegram_username)} · ${esc(r.status)}<br>
        <small class="admin-card-meta">${esc(r.name)} · Source: ${esc(r.source_chat)}</small><br>
        <small>To: ${esc(r.destination_chats?.slice(0, 100))}</small>
        ${r.notes ? `<br><small>Notes: ${esc(r.notes.slice(0, 80))}</small>` : ''}
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
          <select class="admin-select-sm" data-plug-status="${r.id}">
            ${statuses.map((st) => `<option value="${st}" ${r.status === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
          <input class="admin-input-sm" placeholder="Admin notes" data-plug-notes="${r.id}" value="${esc(r.admin_notes || '')}" style="flex:1;min-width:140px">
          <button class="admin-btn admin-btn-ghost admin-btn-sm" data-save-plug-req="${r.id}">Save</button>
        </div>
      </div>`).join('') || '<p class="admin-empty">No requests yet.</p>';

    bindPluggingEvents();
  };

  function bindPluggingEvents() {
    document.getElementById('plugging-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.plugging_enabled = e.target.querySelector('[name="plugging_enabled"]').checked ? '1' : '0';
      body.proxy_enabled = e.target.querySelector('[name="proxy_enabled"]').checked ? '1' : '0';
      await api('/admin/plugging/settings', { method: 'PUT', body });
      if (window.showToast) showToast('Plugging settings saved');
    }, { once: true });

    document.getElementById('plugging-product-add')?.addEventListener('click', async () => {
      const name = prompt('Product name (e.g. Standard Plugging):');
      if (!name) return;
      const description = prompt('Description:', '') || '';
      await api('/admin/plugging/products', { method: 'POST', body: { name, description } });
      loadPlatformPlugging();
    }, { once: true });

    document.querySelectorAll('[data-add-variant]').forEach((b) => b.addEventListener('click', async () => {
      const productId = Number(b.dataset.addVariant);
      const duration = prompt('Duration label (e.g. 7 Days, 30 Days):', '30 Days');
      if (!duration) return;
      const name = prompt('Variant name:', duration) || duration;
      const price = prompt('Price (₱):', '599');
      if (price == null) return;
      const maxSources = prompt('Max Telegram accounts:', '1') || '1';
      const maxDestinations = prompt('Max destinations:', '3') || '3';
      await api('/admin/plugging/plans', {
        method: 'POST',
        body: {
          productId,
          name,
          duration,
          price: Number(price) || 0,
          priceLabel: `₱${Number(price || 0).toLocaleString()}`,
          maxSources: Number(maxSources) || 1,
          maxDestinations: Number(maxDestinations) || 3
        }
      });
      loadPlatformPlugging();
    }));

    document.querySelectorAll('[data-del-plug-product]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this product and all its variants?')) return;
      await api(`/admin/plugging/products/${b.dataset.delPlugProduct}`, { method: 'DELETE' });
      loadPlatformPlugging();
    }));

    document.querySelectorAll('[data-del-plug-plan]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete plan?')) return;
      await api(`/admin/plugging/plans/${b.dataset.delPlugPlan}`, { method: 'DELETE' });
      loadPlatformPlugging();
    }));

    document.querySelectorAll('[data-save-plug-req]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.savePlugReq;
      const status = document.querySelector(`[data-plug-status="${id}"]`)?.value;
      const adminNotes = document.querySelector(`[data-plug-notes="${id}"]`)?.value;
      await api(`/admin/plugging/requests/${id}`, { method: 'PUT', body: { status, adminNotes } });
      if (window.showToast) showToast('Request updated');
      loadPlatformPlugging();
    }));
  }

  /* ── Analytics ── */
  window.loadPlatformAnalytics = async function loadPlatformAnalytics() {
    const d = await api('/admin/platform/stats');

    document.getElementById('platform-analytics-finance').innerHTML = `
      <div class="admin-fcard"><div class="admin-fcard-label">Product Sales</div><div class="admin-fcard-value green">${peso(d.productSales)}</div></div>
      <div class="admin-fcard"><div class="admin-fcard-label">Lending Applications</div><div class="admin-fcard-value">${d.lendingApplications}</div></div>
      <div class="admin-fcard"><div class="admin-fcard-label">Approved Loans</div><div class="admin-fcard-value green">${d.approvedLoans}</div></div>
      <div class="admin-fcard"><div class="admin-fcard-label">Website Inquiries</div><div class="admin-fcard-value">${d.websiteInquiries}</div></div>
      <div class="admin-fcard"><div class="admin-fcard-label">Plugging Requests</div><div class="admin-fcard-value">${d.pluggingRequests || 0}</div></div>
      <div class="admin-fcard"><div class="admin-fcard-label">Active Plugs</div><div class="admin-fcard-value green">${d.activePlugs || 0}</div></div>`;

    document.getElementById('platform-analytics-stats').innerHTML = `
      <div class="admin-stat"><div class="admin-stat-label">Visitors Today</div><div class="admin-stat-value">${d.visitorsToday}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Visitors (7 days)</div><div class="admin-stat-value">${d.visitorsWeek}</div></div>`;

    document.getElementById('platform-top-pages').innerHTML = (d.topPages || []).map((p) => `
      <div class="admin-card" style="margin-bottom:0.35rem;display:flex;justify-content:space-between">
        <code>${esc(p.path)}</code><span>${p.views} views</span>
      </div>`).join('') || '<p class="admin-empty">No visitor data yet.</p>';
  };
})();
