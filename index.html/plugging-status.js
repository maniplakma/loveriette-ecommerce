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

async function loadStatus() {
  if (!orderRef) {
    document.getElementById('status-ref').textContent = 'No order specified — add ?order=PLG-... to the URL';
    return;
  }
  const data = await fetch(`/api/plugging/orders/${encodeURIComponent(orderRef)}`).then((r) => r.json());
  document.getElementById('status-ref').textContent = data.orderRef;
  const badgeWrap = document.getElementById('status-badge-wrap');
  const cls = badgeClass[data.status] || 'pending';
  badgeWrap.innerHTML = `<span class="plug-status-badge-lg ${cls}">${labels[data.status] || data.status}</span>`;
  document.getElementById('status-box').innerHTML = `
    <p><strong>Plan</strong><br>${data.planName}</p>
    <p><strong>Amount</strong><br>₱${Number(data.total).toLocaleString()}</p>`;
  const keyBox = document.getElementById('access-key-box');
  if (data.status === 'approved' && data.accessKey) {
    keyBox.hidden = false;
    document.getElementById('access-key').textContent = data.accessKey;
    document.querySelectorAll('.plug-flow-step')[2]?.classList.add('done');
    document.querySelectorAll('.plug-flow-step')[3]?.classList.add('active');
  } else {
    keyBox.hidden = true;
  }
}

document.getElementById('refresh-status').addEventListener('click', loadStatus);
loadStatus();
setInterval(loadStatus, 15000);
