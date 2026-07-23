/** Admin platform management: CMS, website-making, analytics */
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

    document.getElementById('cms-faqs-list').innerHTML = (data.faqs || []).map((f) => `
      <div class="admin-card" style="margin-bottom:0.5rem">
        <span class="admin-card-meta">[${esc(f.scope)}]</span> <strong>${esc(f.question)}</strong>
        <button class="admin-btn admin-btn-danger admin-btn-sm" data-del-faq="${f.id}">Delete</button>
      </div>`).join('') || '<p class="admin-empty">No FAQs.</p>';

    const svcSection = (data.sections || []).find((s) => s.section_key === 'service_categories');
    if (svcSection) {
      document.getElementById('cms-services-title').value = svcSection.title || '';
      document.getElementById('cms-services-subtitle').value = svcSection.subtitle || '';
      let content = {};
      try { content = JSON.parse(svcSection.content_json || '{}'); } catch (_) {}
      const items = (content.items || []).filter((i) => {
        const link = String(i?.link || '').toLowerCase();
        const title = String(i?.title || '').toLowerCase();
        return link !== '/lending' && !link.includes('lending.html') && title !== 'lending';
      });
      renderCmsServiceItems(items);
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
        <div class="admin-field"><label>Icon (cart, web, plug, shield, zap, heart, star)</label><input class="svc-icon" value="${esc(item.icon || 'star')}"></div>
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
    })).filter((i) => {
      if (!i.title || !i.link) return false;
      const link = i.link.toLowerCase();
      const title = i.title.toLowerCase();
      return link !== '/lending' && !link.includes('lending.html') && title !== 'lending';
    });
  }

  function bindCmsEvents() {
    const root = document.getElementById('tab-cms');
    if (!root || root.dataset.cmsBound === '1') return;
    root.dataset.cmsBound = '1';

    document.getElementById('cms-faq-add')?.addEventListener('click', async () => {
      const scope = prompt('Scope (home/website/plugging):', 'home');
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

    document.getElementById('cms-services-items')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.cms-service-del');
      if (!btn) return;
      const items = collectCmsServiceItems();
      items.splice(Number(btn.dataset.idx), 1);
      renderCmsServiceItems(items);
    });
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

    document.getElementById('web-portfolio-list').innerHTML = (data.portfolio || []).map((item) => `
      <div class="admin-card" style="margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <div>
          <strong>${esc(item.title)}</strong>${item.is_enabled === 0 ? ' <span class="admin-card-meta">(disabled)</span>' : ''}<br>
          <small class="admin-card-meta">${esc((item.description || '').slice(0, 80))}</small>
          ${item.link_url ? `<br><small class="admin-card-meta"><a href="${esc(item.link_url)}" target="_blank" rel="noopener">${esc(item.link_url)}</a></small>` : ''}
        </div>
        <button class="admin-btn admin-btn-danger admin-btn-sm" data-del-portfolio="${item.id}">Delete</button>
      </div>`).join('') || '<p class="admin-empty">No portfolio items yet.</p>';

    document.getElementById('web-inquiries-list').innerHTML = (data.inquiries || []).map((i) => `
      <div class="admin-card inquiry-admin-row" style="margin-bottom:0.5rem" data-inquiry-id="${i.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;flex-wrap:wrap">
          <div>
            <strong>${esc(i.name)}</strong> (${esc(i.email)}) — ${esc(i.status)}${i.unread_by_admin ? ' <span class="admin-badge orange">new</span>' : ''}<br>
            <small class="admin-card-meta">${esc(i.inquiry_ref || '')} · ${esc(i.package_name || 'General')} · ${esc(i.created_at || '')}</small><br>
            <small>${esc((i.message || '').slice(0, 120))}</small>
          </div>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
            <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" data-open-inq="${i.id}">Open Chat</button>
            <select class="admin-select-sm" data-inq-status="${i.id}">
              ${['new', 'open', 'in_progress', 'contacted', 'reviewed', 'closed'].map((st) =>
                `<option value="${st}" ${i.status === st ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>`).join('') || '<p class="admin-empty">No inquiries.</p>';

    document.querySelectorAll('[data-open-inq]').forEach((b) => b.addEventListener('click', () => openInquiryChat(Number(b.dataset.openInq))));
    document.querySelectorAll('[data-inq-status]').forEach((sel) => sel.addEventListener('change', async () => {
      await api(`/admin/website-making/inquiries/${sel.dataset.inqStatus}`, { method: 'PUT', body: { status: sel.value } });
      if (window.showToast) showToast('Status updated');
    }));

    bindWebsiteEvents();

    document.querySelectorAll('[data-del-pkg]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete package?')) return;
      await api(`/admin/website-making/packages/${b.dataset.delPkg}`, { method: 'DELETE' });
      loadPlatformWebsite();
    }));

    document.querySelectorAll('[data-del-portfolio]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete portfolio item?')) return;
      await api(`/admin/website-making/portfolio/${b.dataset.delPortfolio}`, { method: 'DELETE' });
      loadPlatformWebsite();
    }));
  };

  function bindWebsiteEvents() {
    const root = document.getElementById('tab-website-making');
    if (!root || root.dataset.webBound === '1') return;
    root.dataset.webBound = '1';

    document.getElementById('web-pkg-add')?.addEventListener('click', async () => {
      const name = prompt('Package name:');
      const price = prompt('Price (₱):', '15000');
      if (!name) return;
      await api('/admin/website-making/packages', { method: 'POST', body: { name, price: Number(price) || 0, description: '', features: [] } });
      loadPlatformWebsite();
    });

    document.getElementById('web-portfolio-add')?.addEventListener('click', async () => {
      const title = prompt('Portfolio title:');
      if (!title) return;
      const description = prompt('Description:', '') || '';
      const linkUrl = prompt('Project URL (optional):', '') || '';
      const imageUrl = prompt('Image URL (optional):', '') || '';
      await api('/admin/website-making/portfolio', {
        method: 'POST',
        body: { title, description, linkUrl, imageUrl, sortOrder: 0 }
      });
      loadPlatformWebsite();
    });
  }

  async function openInquiryChat(id) {
    const modal = document.getElementById('inquiry-chat-modal');
    const body = document.getElementById('inquiry-chat-body');
    const compose = document.getElementById('inquiry-admin-compose');
    if (!modal || !body) return;
    modal.hidden = false;
    body.innerHTML = '<p class="dashboard-loading">Loading…</p>';
    compose.hidden = true;

    let data;
    try {
      data = await api(`/admin/website-making/inquiries/${id}`);
    } catch (err) {
      body.innerHTML = `<p class="admin-empty">${esc(err.message)}</p>`;
      return;
    }

    const inq = data.inquiry;
    document.getElementById('inquiry-chat-title').textContent = `${inq.name} — ${inq.inquiryRef || 'Inquiry'}`;
    document.getElementById('inquiry-chat-sub').textContent =
      `${inq.email}${inq.phone ? ' · ' + inq.phone : ''} · ${inq.packageName || 'General'} · ${inq.status}`;

    body.innerHTML = (data.messages || []).map((m) => `
      <div class="inquiry-msg inquiry-msg--${m.senderType === 'admin' ? 'admin' : 'client'}">
        <div class="inquiry-msg-meta">${m.senderType === 'admin' ? 'Admin' : 'Client'} · ${esc(m.createdAt)}</div>
        <div class="inquiry-msg-body">${esc(m.body).replace(/\n/g, '<br>')}</div>
      </div>`).join('') || '<p class="admin-empty">No messages yet.</p>';
    body.scrollTop = body.scrollHeight;

    compose.hidden = inq.status === 'closed';
    compose.dataset.inquiryId = String(id);

    document.getElementById('inquiry-admin-notes').value = inq.adminNotes || '';
    document.getElementById('inquiry-admin-status').value = inq.status || 'new';
  }

  window.closeInquiryChatModal = function closeInquiryChatModal() {
    const modal = document.getElementById('inquiry-chat-modal');
    if (modal) modal.hidden = true;
  };

  document.getElementById('inquiry-chat-close')?.addEventListener('click', closeInquiryChatModal);
  document.getElementById('inquiry-chat-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'inquiry-chat-modal') closeInquiryChatModal();
  });

  document.getElementById('inquiry-admin-send')?.addEventListener('click', async () => {
    const compose = document.getElementById('inquiry-admin-compose');
    const id = compose?.dataset.inquiryId;
    const message = document.getElementById('inquiry-admin-message')?.value?.trim();
    if (!id || !message) return;
    try {
      const r = await api(`/admin/website-making/inquiries/${id}/messages`, { method: 'POST', body: { message } });
      document.getElementById('inquiry-admin-message').value = '';
      const body = document.getElementById('inquiry-chat-body');
      body.innerHTML = (r.messages || []).map((m) => `
        <div class="inquiry-msg inquiry-msg--${m.senderType === 'admin' ? 'admin' : 'client'}">
          <div class="inquiry-msg-meta">${m.senderType === 'admin' ? 'Admin' : 'Client'} · ${esc(m.createdAt)}</div>
          <div class="inquiry-msg-body">${esc(m.body).replace(/\n/g, '<br>')}</div>
        </div>`).join('');
      body.scrollTop = body.scrollHeight;
      if (window.showToast) showToast('Reply sent');
    } catch (err) {
      if (window.showToast) showToast(err.message || 'Failed');
    }
  });

  document.getElementById('inquiry-admin-save')?.addEventListener('click', async () => {
    const compose = document.getElementById('inquiry-admin-compose');
    const id = compose?.dataset.inquiryId;
    if (!id) return;
    await api(`/admin/website-making/inquiries/${id}`, {
      method: 'PUT',
      body: {
        status: document.getElementById('inquiry-admin-status')?.value,
        adminNotes: document.getElementById('inquiry-admin-notes')?.value
      }
    });
    if (window.showToast) showToast('Inquiry saved');
    loadPlatformWebsite();
  });

  function renderPlugVariantRow(v) {
    const ms = v.max_sources ?? v.maxSources ?? 1;
    const md = v.max_destinations ?? v.maxDestinations ?? 3;
    const pri = v.priority ? 1 : 0;
    const enabled = v.is_enabled !== 0;
    return `
      <div class="admin-card plug-variant-row" data-variant-id="${v.id}" style="margin:0.35rem 0 0.35rem 1rem;padding:0.65rem 0.85rem">
        <div class="plug-variant-view" data-variant-view="${v.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
            <div>
              <strong>${esc(v.name)}</strong>${v.duration ? ` · ${esc(v.duration)}` : ''} — ${peso(v.price)} · ${ms}→${md}${pri ? ' · Priority' : ''}
              ${!enabled ? ' · <em>disabled</em>' : ''}
              <br><small class="admin-card-meta">${v.description ? esc(v.description) : '<em>No description — click Edit to add</em>'}</small>
            </div>
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
              <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-edit-plug-plan="${v.id}">Edit</button>
              <button type="button" class="admin-btn admin-btn-danger admin-btn-sm" data-del-plug-plan="${v.id}">Delete</button>
            </div>
          </div>
        </div>
        <form class="plug-variant-edit" data-variant-edit="${v.id}" hidden style="margin-top:0.65rem">
          <div class="admin-field-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.5rem">
            <div class="admin-field"><label>Name</label><input class="admin-input-sm" name="name" value="${esc(v.name)}" required></div>
            <div class="admin-field"><label>Duration</label><input class="admin-input-sm" name="duration" value="${esc(v.duration || '')}" placeholder="7 Days"></div>
            <div class="admin-field"><label>Price (₱)</label><input class="admin-input-sm" name="price" type="number" min="0" value="${Number(v.price || 0)}"></div>
            <div class="admin-field"><label>Max accounts</label><input class="admin-input-sm" name="maxSources" type="number" min="1" value="${ms}"></div>
            <div class="admin-field"><label>Max groups</label><input class="admin-input-sm" name="maxDestinations" type="number" min="1" value="${md}"></div>
            <div class="admin-field"><label>Sort</label><input class="admin-input-sm" name="sortOrder" type="number" value="${Number(v.sort_order || 0)}"></div>
          </div>
          <div class="admin-field" style="margin-top:0.45rem"><label>Description</label><textarea class="admin-input-sm" name="description" rows="2">${esc(v.description || '')}</textarea></div>
          <label class="admin-checkbox" style="display:inline-flex;align-items:center;gap:0.35rem;margin:0.5rem 0.65rem 0 0">
            <input type="checkbox" name="priority" ${pri ? 'checked' : ''}> VIP+ priority
          </label>
          <label class="admin-checkbox" style="display:inline-flex;align-items:center;gap:0.35rem;margin-top:0.5rem">
            <input type="checkbox" name="isEnabled" ${enabled ? 'checked' : ''}> Enabled
          </label>
          <div style="margin-top:0.65rem;display:flex;gap:0.45rem;flex-wrap:wrap">
            <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" data-save-plug-plan="${v.id}">Save variant</button>
            <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-cancel-plug-plan="${v.id}">Cancel</button>
          </div>
        </form>
      </div>`;
  }

  function renderPlugProductCard(prod) {
    const enabled = prod.is_enabled !== 0;
    return `
      <div class="admin-card plug-product-card" data-product-id="${prod.id}" style="margin-bottom:1rem">
        <div class="plug-product-view" data-product-view="${prod.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem">
            <div>
              <strong>${esc(prod.name)}</strong> · /plugging/plan/${esc(prod.slug)} · ${enabled ? 'enabled' : 'disabled'}<br>
              <small class="admin-card-meta">${esc(prod.description?.slice(0, 100))}</small>
            </div>
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
              <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-edit-plug-product="${prod.id}">Edit</button>
              <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-add-variant="${prod.id}" data-product-name="${esc(prod.name)}">+ Variant</button>
              <button type="button" class="admin-btn admin-btn-danger admin-btn-sm" data-del-plug-product="${prod.id}">Delete Product</button>
            </div>
          </div>
        </div>
        <form class="plug-product-edit" data-product-edit="${prod.id}" hidden style="margin-bottom:0.75rem">
          <div class="admin-field"><label>Product name</label><input class="admin-input-sm" name="name" value="${esc(prod.name)}" required></div>
          <div class="admin-field" style="margin-top:0.45rem"><label>Description</label><textarea class="admin-input-sm" name="description" rows="2">${esc(prod.description || '')}</textarea></div>
          <label class="admin-checkbox" style="display:inline-flex;align-items:center;gap:0.35rem;margin-top:0.5rem">
            <input type="checkbox" name="isEnabled" ${enabled ? 'checked' : ''}> Enabled
          </label>
          <div style="margin-top:0.65rem;display:flex;gap:0.45rem;flex-wrap:wrap">
            <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" data-save-plug-product="${prod.id}">Save product</button>
            <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-cancel-plug-product="${prod.id}">Cancel</button>
          </div>
        </form>
        ${(prod.variants || []).map((v) => renderPlugVariantRow(v)).join('') || '<p class="admin-empty" style="margin-left:1rem">No variants — add 7 Days, 30 Days, etc.</p>'}
      </div>`;
  }

  async function plugApiAction(action) {
    try {
      return await action();
    } catch (err) {
      if (window.showToast) showToast(err.message || 'Request failed', 'error');
      throw err;
    }
  }

  function togglePlugEdit(viewSel, editSel, showEdit) {
    const view = document.querySelector(viewSel);
    const edit = document.querySelector(editSel);
    if (view) view.hidden = showEdit;
    if (edit) edit.hidden = !showEdit;
  }

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

    const proxySettings = document.getElementById('plugging-proxy-settings');
    if (proxySettings) {
      const proxyToggle = proxySettings.querySelector('[name="proxy_enabled"]');
      proxyToggle.checked = s.proxy_enabled === '1';
      proxyToggle.onchange = async () => {
        await api('/admin/plugging/settings', {
          method: 'PUT',
          body: { proxy_enabled: proxyToggle.checked ? '1' : '0' }
        });
        if (window.showToast) showToast('Proxy setting saved');
      };
    }

    const proxies = await api('/admin/plugging/proxies');
    document.getElementById('plugging-proxies-list').innerHTML = (proxies || []).map((p) => `
      <div class="admin-card" style="margin-bottom:0.65rem">
        <strong>${esc(p.label || `Proxy #${p.id}`)}</strong>
        ${p.isEnabled ? '' : ' <span class="admin-card-meta">(disabled)</span>'}
        <br><code style="font-size:0.78rem;word-break:break-all">${esc(p.url)}</code>
        <div style="margin-top:0.45rem;display:flex;gap:0.45rem;flex-wrap:wrap">
          <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-toggle-proxy="${p.id}" data-enabled="${p.isEnabled ? '0' : '1'}">${p.isEnabled ? 'Disable' : 'Enable'}</button>
          <button type="button" class="admin-btn admin-btn-danger admin-btn-sm" data-del-proxy="${p.id}">Delete</button>
        </div>
      </div>`).join('') || '<p class="admin-empty">No proxies yet. Add one above — new accounts will auto-use them.</p>';

    document.querySelectorAll('[data-toggle-proxy]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/admin/plugging/proxies/${b.dataset.toggleProxy}`, {
        method: 'PUT',
        body: { isEnabled: b.dataset.enabled === '1' }
      });
      loadPlatformPlugging();
    }));
    document.querySelectorAll('[data-del-proxy]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this proxy?')) return;
      await api(`/admin/plugging/proxies/${b.dataset.delProxy}`, { method: 'DELETE' });
      loadPlatformPlugging();
    }));

    const master = await api('/admin/plugging/master-key');
    const masterBox = document.getElementById('plugging-master-key-box');
    if (masterBox) {
      if (master.enabled && master.accessKey) {
        const created = master.createdAt
          ? `Created ${new Date(master.createdAt).toLocaleString()} · Lifetime access`
          : 'Lifetime access · no expiry';
        masterBox.innerHTML = `
          <code class="admin-plug-master-code">${esc(master.accessKey)}</code>
          <div style="margin-top:0.65rem;display:flex;gap:0.5rem;flex-wrap:wrap">
            <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" id="plug-master-copy">Copy key</button>
            <a class="admin-btn admin-btn-ghost admin-btn-sm" href="/plugging/workspace" target="_blank" rel="noopener">Open workspace</a>
            <button type="button" class="admin-btn admin-btn-danger admin-btn-sm" id="plug-master-regenerate">Regenerate</button>
          </div>
          <p class="admin-card-meta" style="margin-top:0.5rem">${esc(created)}</p>
          <p class="admin-card-meta">${esc(master.note || '')}</p>`;
        document.getElementById('plug-master-copy')?.addEventListener('click', () => {
          navigator.clipboard?.writeText(master.accessKey);
          if (window.showToast) showToast('Master key copied');
        });
        document.getElementById('plug-master-regenerate')?.addEventListener('click', async () => {
          if (!confirm('Regenerate master key? The old key will stop working immediately.')) return;
          const next = await api('/admin/plugging/master-key/generate', { method: 'POST', body: { regenerate: true } });
          if (next.accessKey && window.showToast) showToast('New master key generated');
          loadPlatformPlugging();
        });
      } else {
        masterBox.innerHTML = `
          <p class="admin-card-meta">${esc(master.message || 'No master key yet.')}</p>
          <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" id="plug-master-generate" style="margin-top:0.65rem">Generate Key</button>`;
        document.getElementById('plug-master-generate')?.addEventListener('click', async () => {
          const next = await api('/admin/plugging/master-key/generate', { method: 'POST' });
          if (next.accessKey && window.showToast) showToast('Master key generated');
          loadPlatformPlugging();
        });
      }
    }

    const planSelect = document.getElementById('plugging-access-key-plan');
    const allPlans = (data.products || []).flatMap((prod) =>
      (prod.variants || []).map((v) => ({
        id: v.id,
        label: `${prod.name} — ${v.name}${v.duration ? ` (${v.duration})` : ''}`
      }))
    );
    if (planSelect) {
      const prev = planSelect.value;
      planSelect.innerHTML = '<option value="">Select plan…</option>' + allPlans.map((p) =>
        `<option value="${p.id}">${esc(p.label)}</option>`
      ).join('');
      if (prev && allPlans.some((p) => String(p.id) === prev)) planSelect.value = prev;
      else if (allPlans.length === 1) planSelect.value = String(allPlans[0].id);
    }

    const stock = await api('/admin/plugging/access-keys');
    const stockCounts = {};
    (stock.counts || []).forEach((c) => {
      const key = `${c.plan_id}:${c.status}`;
      stockCounts[key] = c.c;
    });
    const availableTotal = (stock.keys || []).filter((k) => k.status === 'available').length;
    document.getElementById('plugging-access-keys-list').innerHTML = (stock.keys || []).length
      ? `<p class="admin-card-meta" style="margin-bottom:0.5rem"><strong>${availableTotal}</strong> key(s) available in stock</p>` + (stock.keys || []).map((k) => `
        <div class="admin-card" style="margin-bottom:0.5rem">
          <code style="font-size:0.85rem">${esc(k.access_key)}</code>
          · ${esc(k.plan_name || `Plan #${k.plan_id}`)}
          · <span class="admin-card-meta">${esc(k.status)}</span>
          ${k.activated_at ? ` · activated ${esc(String(k.activated_at).slice(0, 10))}` : ''}
          ${k.order_id ? ` · order #${k.order_id}` : ''}
          ${k.status === 'available' ? `<div style="margin-top:0.35rem"><button type="button" class="admin-btn admin-btn-danger admin-btn-sm" data-del-access-key="${k.id}">Delete</button></div>` : ''}
        </div>`).join('')
      : '<p class="admin-empty">No access keys in stock yet. Add keys above before approving orders.</p>';

    document.querySelectorAll('[data-del-access-key]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this unused access key?')) return;
      await plugApiAction(() => api(`/admin/plugging/access-keys/${b.dataset.delAccessKey}`, { method: 'DELETE' }));
      if (window.showToast) showToast('Access key removed');
      loadPlatformPlugging();
    }));

    const orders = await api('/admin/plugging/orders');
    document.getElementById('plugging-orders-list').innerHTML = (orders || []).map((o) => `
      <div class="admin-card" style="margin-bottom:0.75rem${o.status === 'pending_approval' ? ';border-left:3px solid var(--admin-orange,#f59e0b)' : ''}">
        <strong>${esc(o.order_ref)}</strong> — ${esc(o.customer_name)} · <strong>${esc(o.status)}</strong><br>
        <small class="admin-card-meta">${esc(o.plan_name)} · ${peso(o.total)}${o.expires_at ? ` · expires ${esc(String(o.expires_at).slice(0, 10))}` : (o.status === 'approved' ? ' · not activated yet (no expiry)' : '')}</small>
        ${o.email ? `<br><small class="admin-card-meta">${esc(o.email)}</small>` : ''}
        ${o.access_key ? `<br><code style="font-size:0.85rem">Key: ${esc(o.access_key)}</code>` : ''}
        ${o.receipt_path ? `<br><a href="${esc(o.receipt_path)}" target="_blank">View receipt</a>` : ''}
        <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap">
          ${o.status === 'pending_approval' ? `<button class="admin-btn admin-btn-primary admin-btn-sm" data-approve-order="${o.id}">Approve & Issue Key</button>
          <button class="admin-btn admin-btn-danger admin-btn-sm" data-reject-order="${o.id}">Reject</button>` : ''}
        </div>
      </div>`).join('') || '<p class="admin-empty">No subscription orders yet.</p>';

    document.querySelectorAll('[data-approve-order]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api(`/admin/plugging/orders/${b.dataset.approveOrder}`, { method: 'PUT', body: { status: 'approved' } });
        if (window.showToast) showToast(`Approved — Key: ${r.accessKey}`);
        loadPlatformPlugging();
      } catch (err) {
        if (window.showToast) showToast(err.message || 'Approval failed', 'error');
      }
    }));
    document.querySelectorAll('[data-reject-order]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/admin/plugging/orders/${b.dataset.rejectOrder}`, { method: 'PUT', body: { status: 'rejected' } });
      loadPlatformPlugging();
    }));

    document.getElementById('plugging-products-list').innerHTML = (data.products || []).map((prod) => renderPlugProductCard(prod)).join('')
      || '<p class="admin-empty">No products yet. Add Standard Plugging, then add variants.</p>';

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
    const root = document.getElementById('tab-plugging');
    if (root && root.dataset.plugBound !== '1') {
      root.dataset.plugBound = '1';

      document.getElementById('plugging-settings-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        body.plugging_enabled = e.target.querySelector('[name="plugging_enabled"]').checked ? '1' : '0';
        await plugApiAction(() => api('/admin/plugging/settings', { method: 'PUT', body }));
        if (window.showToast) showToast('Plugging settings saved');
      });

      document.getElementById('plugging-proxy-add-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const label = e.target.querySelector('[name="proxy_label"]').value;
        const url = e.target.querySelector('[name="proxy_url"]').value;
        await plugApiAction(() => api('/admin/plugging/proxies', { method: 'POST', body: { label, url } }));
        e.target.reset();
        if (window.showToast) showToast('Proxy added');
        loadPlatformPlugging();
      });

      document.getElementById('plugging-access-key-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const planId = Number(e.target.querySelector('[name="planId"]')?.value);
        const accessKey = e.target.querySelector('[name="accessKey"]')?.value?.trim();
        if (!planId) {
          if (window.showToast) showToast('Select a plan variant', 'error');
          return;
        }
        await plugApiAction(() => api('/admin/plugging/access-keys', {
          method: 'POST',
          body: { planId, accessKey: accessKey || undefined }
        }));
        e.target.querySelector('[name="accessKey"]').value = '';
        if (window.showToast) showToast('Access key added to stock');
        loadPlatformPlugging();
      });

      document.getElementById('plugging-access-key-batch')?.addEventListener('click', async () => {
        const planId = Number(document.getElementById('plugging-access-key-plan')?.value);
        if (!planId) {
          if (window.showToast) showToast('Select a plan variant first', 'error');
          return;
        }
        await plugApiAction(() => api('/admin/plugging/access-keys/batch', {
          method: 'POST',
          body: { planId, count: 5 }
        }));
        if (window.showToast) showToast('Generated 5 access keys');
        loadPlatformPlugging();
      });

      document.getElementById('plugging-product-add')?.addEventListener('click', async () => {
        const name = prompt('Product name (e.g. Standard Plugging):');
        if (!name) return;
        const description = prompt('Description:', '') || '';
        await plugApiAction(() => api('/admin/plugging/products', { method: 'POST', body: { name, description } }));
        loadPlatformPlugging();
      });

      document.getElementById('plugging-products-list')?.addEventListener('click', async (e) => {
        const addBtn = e.target.closest('[data-add-variant]');
        if (addBtn) {
          const productId = Number(addBtn.dataset.addVariant);
          const duration = prompt('Duration label (e.g. 7 Days, 30 Days):', '30 Days');
          if (!duration) return;
          const name = prompt('Variant name:', duration) || duration;
          const price = prompt('Price (₱):', '599');
          if (price == null) return;
          const maxSources = prompt('Max Telegram accounts (VIP=10, VIP+=999 unlimited):', '10') || '10';
          const maxDestinations = prompt('Max groups per account (VIP=50, VIP+=999 unlimited):', '50') || '50';
          const priority = confirm('Priority plan (VIP+)? OK = yes, Cancel = no');
          const defaultDesc = priority
            ? `Unlimited accounts and groups for ${duration.toLowerCase()}. Includes Auto join groups and Start all (staggered delay) in your workspace.`
            : `Up to ${maxSources} accounts, ${maxDestinations} groups each for ${duration.toLowerCase()}. Manual per-account forwarding in your workspace.`;
          const description = prompt('Variant description (shown on plan page):', defaultDesc) || defaultDesc;
          await plugApiAction(() => api('/admin/plugging/plans', {
            method: 'POST',
            body: {
              productId,
              name,
              duration,
              description,
              price: Number(price) || 0,
              priceLabel: `₱${Number(price || 0).toLocaleString()}`,
              maxSources: Number(maxSources) || 1,
              maxDestinations: Number(maxDestinations) || 3,
              priority
            }
          }));
          loadPlatformPlugging();
          return;
        }

        const editProdBtn = e.target.closest('[data-edit-plug-product]');
        if (editProdBtn) {
          const id = editProdBtn.dataset.editPlugProduct;
          togglePlugEdit(`[data-product-view="${id}"]`, `[data-product-edit="${id}"]`, true);
          return;
        }

        const cancelProdBtn = e.target.closest('[data-cancel-plug-product]');
        if (cancelProdBtn) {
          const id = cancelProdBtn.dataset.cancelPlugProduct;
          togglePlugEdit(`[data-product-view="${id}"]`, `[data-product-edit="${id}"]`, false);
          return;
        }

        const saveProdBtn = e.target.closest('[data-save-plug-product]');
        if (saveProdBtn) {
          const id = saveProdBtn.dataset.savePlugProduct;
          const form = document.querySelector(`[data-product-edit="${id}"]`);
          if (!form) return;
          const fd = new FormData(form);
          await plugApiAction(() => api(`/admin/plugging/products/${id}`, {
            method: 'PUT',
            body: {
              name: String(fd.get('name') || '').trim(),
              description: String(fd.get('description') || '').trim(),
              isEnabled: !!form.querySelector('[name="isEnabled"]')?.checked
            }
          }));
          if (window.showToast) showToast('Product saved');
          loadPlatformPlugging();
          return;
        }

        const editPlanBtn = e.target.closest('[data-edit-plug-plan]');
        if (editPlanBtn) {
          const id = editPlanBtn.dataset.editPlugPlan;
          togglePlugEdit(`[data-variant-view="${id}"]`, `[data-variant-edit="${id}"]`, true);
          return;
        }

        const cancelPlanBtn = e.target.closest('[data-cancel-plug-plan]');
        if (cancelPlanBtn) {
          const id = cancelPlanBtn.dataset.cancelPlugPlan;
          togglePlugEdit(`[data-variant-view="${id}"]`, `[data-variant-edit="${id}"]`, false);
          return;
        }

        const savePlanBtn = e.target.closest('[data-save-plug-plan]');
        if (savePlanBtn) {
          const id = savePlanBtn.dataset.savePlugPlan;
          const form = document.querySelector(`[data-variant-edit="${id}"]`);
          if (!form) return;
          const fd = new FormData(form);
          const price = Number(fd.get('price')) || 0;
          await plugApiAction(() => api(`/admin/plugging/plans/${id}`, {
            method: 'PUT',
            body: {
              name: String(fd.get('name') || '').trim(),
              duration: String(fd.get('duration') || '').trim(),
              description: String(fd.get('description') || '').trim(),
              price,
              priceLabel: `₱${price.toLocaleString()}`,
              maxSources: Number(fd.get('maxSources')) || 1,
              maxDestinations: Number(fd.get('maxDestinations')) || 3,
              sortOrder: Number(fd.get('sortOrder')) || 0,
              priority: !!form.querySelector('[name="priority"]')?.checked,
              isEnabled: !!form.querySelector('[name="isEnabled"]')?.checked
            }
          }));
          if (window.showToast) showToast('Variant saved');
          loadPlatformPlugging();
          return;
        }

        const delProdBtn = e.target.closest('[data-del-plug-product]');
        if (delProdBtn) {
          if (!confirm('Delete this product and all its variants?')) return;
          const r = await plugApiAction(() => api(`/admin/plugging/products/${delProdBtn.dataset.delPlugProduct}`, { method: 'DELETE' }));
          if (window.showToast) showToast(r.message || (r.disabled ? 'Product disabled (has orders)' : 'Product deleted'));
          loadPlatformPlugging();
          return;
        }

        const delPlanBtn = e.target.closest('[data-del-plug-plan]');
        if (delPlanBtn) {
          if (!confirm('Delete this variant?')) return;
          const r = await plugApiAction(() => api(`/admin/plugging/plans/${delPlanBtn.dataset.delPlugPlan}`, { method: 'DELETE' }));
          if (window.showToast) showToast(r.message || (r.disabled ? 'Variant disabled (has orders)' : 'Variant deleted'));
          loadPlatformPlugging();
        }
      });
    }

    document.querySelectorAll('[data-save-plug-req]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.savePlugReq;
      const status = document.querySelector(`[data-plug-status="${id}"]`)?.value;
      const adminNotes = document.querySelector(`[data-plug-notes="${id}"]`)?.value;
      await plugApiAction(() => api(`/admin/plugging/requests/${id}`, { method: 'PUT', body: { status, adminNotes } }));
      if (window.showToast) showToast('Request updated');
      loadPlatformPlugging();
    }));
  }

  /* ── Service availability (overview) ── */
  const MODULE_DEFS = [
    { key: 'shop', label: 'Shop', note: 'Digital products store' },
    { key: 'plugging', label: 'Plugging', note: 'Telegram forwarding service' },
    { key: 'websiteMaking', label: 'Website Making', note: 'Custom website inquiries' }
  ];

  window.loadAdminModules = async function loadAdminModules() {
    const grid = document.getElementById('admin-modules-grid');
    const saveBtn = document.getElementById('admin-modules-save');
    if (!grid) return;

    let data = {};
    try { data = await api('/admin/modules'); } catch { return; }

    grid.innerHTML = MODULE_DEFS.map((m) => {
      const on = !!data[m.key];
      const status = on ? 'ON' : 'OFF';
      const statusClass = on ? 'green' : 'orange';
      const extra = '';
      return `
        <label class="admin-module-toggle">
          <div class="admin-module-toggle-info">
            <strong>${esc(m.label)}</strong>
            <span class="admin-card-meta">${esc(m.note)}${extra}</span>
          </div>
          <span class="admin-module-status ${statusClass}">${status}</span>
          <input type="checkbox" data-module="${m.key}" ${on ? 'checked' : ''}>
        </label>`;
    }).join('');

    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', async () => {
        const body = {};
        grid.querySelectorAll('[data-module]').forEach((cb) => {
          body[cb.dataset.module] = cb.checked;
        });
        await api('/admin/modules', { method: 'PUT', body });
        if (window.showToast) showToast('Service availability saved');
        loadAdminModules();
      });
    }
  };

  /* ── Analytics ── */
  function analyticsCard(label, value, opts = {}) {
    const { tone = '', iconName = '' } = opts;
    const iconHtml = iconName && window.adminIconHtml ? window.adminIconHtml(iconName, 'admin-fcard-icon') : '';
    return `
      <div class="admin-fcard ${tone ? `admin-fcard--${tone}` : ''}">
        ${iconHtml}
        <div class="admin-fcard-label">${label}</div>
        <div class="admin-fcard-value ${tone}">${value}</div>
      </div>`;
  }

  function renderPlatformTrafficChart(d) {
    const wrap = document.getElementById('platform-traffic-chart');
    if (!wrap) return;
    const today = Number(d.visitorsToday) || 0;
    const week = Number(d.visitorsWeek) || 0;
    const avg = week > 0 ? Math.round(week / 7) : 0;
    const max = Math.max(today, avg, week, 1);
    const bars = [
      { label: 'Today', value: today },
      { label: 'Daily avg (7d)', value: avg },
      { label: '7-day total', value: week }
    ];
    wrap.innerHTML = `
      <div class="admin-traffic-bars">
        ${bars.map((b) => `
          <div class="admin-traffic-bar-row">
            <span class="admin-traffic-bar-label">${b.label}</span>
            <div class="admin-traffic-bar-track"><span style="width:${Math.max((b.value / max) * 100, b.value ? 6 : 0)}%"></span></div>
            <strong class="admin-traffic-bar-value">${b.value.toLocaleString()}</strong>
          </div>`).join('')}
      </div>`;
  }

  window.loadPlatformAnalytics = async function loadPlatformAnalytics() {
    const d = await api('/admin/platform/stats');

    document.getElementById('platform-analytics-finance').innerHTML = [
      analyticsCard('Product Sales', peso(d.productSales), { tone: 'green', iconName: 'sales' }),
      analyticsCard('Website Inquiries', d.websiteInquiries, { iconName: 'inbox' }),
      analyticsCard('Plugging Requests', d.pluggingRequests || 0, { iconName: 'plug' }),
      analyticsCard('Active Plugs', d.activePlugs || 0, { tone: 'green', iconName: 'check' })
    ].join('');

    document.getElementById('platform-analytics-stats').innerHTML = `
      <div class="admin-stat admin-stat--accent"><div class="admin-stat-label">Visitors Today</div><div class="admin-stat-value">${d.visitorsToday}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Visitors (7 days)</div><div class="admin-stat-value green">${d.visitorsWeek}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">New Web Inquiries</div><div class="admin-stat-value orange">${d.newWebsiteInquiries || 0}</div></div>
      <div class="admin-stat"><div class="admin-stat-label">Pending Plug Orders</div><div class="admin-stat-value orange">${d.pendingPluggingOrders || 0}</div></div>`;

    renderPlatformTrafficChart(d);

    const topPages = d.topPages || [];
    const maxViews = Math.max(...topPages.map((p) => p.views), 1);
    document.getElementById('platform-top-pages').innerHTML = topPages.length
      ? topPages.map((p) => `
        <div class="admin-top-page-row">
          <code class="admin-top-page-path">${esc(p.path)}</code>
          <div class="admin-top-page-bar"><span style="width:${Math.max((p.views / maxViews) * 100, 4)}%"></span></div>
          <span class="admin-top-page-views">${p.views} views</span>
        </div>`).join('')
      : '<p class="admin-empty">No visitor data yet.</p>';

    window.hydrateAdminIcons?.(document.getElementById('tab-platform-analytics') || document);
  };
})();
