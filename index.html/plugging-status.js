const orderRef = new URLSearchParams(location.search).get('order');

const labels = {
  pending_payment: 'Waiting for payment',
  pending_approval: 'Payment submitted — waiting for approval',
  approved: 'Approved — access key ready',
  rejected: 'Payment rejected — contact support'
};

const badgeClass = {
  pending_payment: 'pending',
  pending_approval: 'pending',
  approved: 'approved',
  rejected: 'rejected'
};

const accessLabels = {
  active: 'Active',
  inactive: 'Inactive — not used yet',
  expired: 'Expired'
};

function formatExpiry(data) {
  if (data.awaitingActivation) {
    return 'Expiry starts when you first open the workspace.';
  }
  if (data.expiresAt) {
    const d = new Date(data.expiresAt);
    return `Expires ${Number.isNaN(d.getTime()) ? data.expiresAt : d.toLocaleString()}`;
  }
  if (data.accessState === 'active') return 'No expiry set.';
  return '';
}

async function copyAccessKey() {
  const key = document.getElementById('access-key')?.textContent?.trim();
  if (!key) return;
  try {
    await navigator.clipboard.writeText(key);
    const btn = document.getElementById('copy-access-key');
    if (btn) {
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy key'; }, 1400);
    }
  } catch {
    /* ignore */
  }
}

async function loadStatus() {
  if (!orderRef) {
    document.getElementById('status-ref').textContent = 'No order specified — add ?order=PLG-... to the URL';
    return;
  }
  const data = await fetch(`/api/plugging/orders/${encodeURIComponent(orderRef)}`).then((r) => r.json());
  document.getElementById('status-ref').textContent = data.orderRef;
  const badgeWrap = document.getElementById('status-badge-wrap');
  const cls = badgeClass[data.status] || 'pending';
  let badgeText = labels[data.status] || data.status;
  if (data.status === 'approved' && data.accessState) {
    badgeText = accessLabels[data.accessState] || badgeText;
  }
  badgeWrap.innerHTML = `<span class="plug-status-badge-lg ${cls}">${badgeText}</span>`;
  const expiryLine = formatExpiry(data);
  document.getElementById('status-box').innerHTML = `
    <p><strong>Plan</strong><br>${data.planName}</p>
    <p><strong>Amount</strong><br>₱${Number(data.total).toLocaleString()}</p>
    ${expiryLine ? `<p><strong>Access</strong><br>${expiryLine}</p>` : ''}`;
  const keyBox = document.getElementById('access-key-box');
  if (data.status === 'approved' && data.accessKey) {
    keyBox.hidden = false;
    document.getElementById('access-key').textContent = data.accessKey;
    let copyBtn = document.getElementById('copy-access-key');
    if (!copyBtn) {
      copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.id = 'copy-access-key';
      copyBtn.className = 'plug-flow-btn plug-flow-btn-ghost';
      copyBtn.style.marginTop = '0.65rem';
      copyBtn.textContent = 'Copy key';
      document.getElementById('access-key').insertAdjacentElement('afterend', copyBtn);
      copyBtn.addEventListener('click', copyAccessKey);
    }
    document.querySelectorAll('.plug-flow-step')[2]?.classList.add('done');
    document.querySelectorAll('.plug-flow-step')[3]?.classList.add('active');
  } else {
    keyBox.hidden = true;
  }
}

document.getElementById('refresh-status').addEventListener('click', loadStatus);
loadStatus();
setInterval(loadStatus, 15000);
