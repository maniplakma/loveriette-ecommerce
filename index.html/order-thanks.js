const params = new URLSearchParams(window.location.search);

const orderNumber = params.get('order');



async function api(url, options = {}) {

  const res = await fetch(url, {

    ...options,

    headers: { 'Content-Type': 'application/json', ...options.headers },

    credentials: 'include'

  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(data.error || 'Request failed');

  return data;

}



function formatMoney(amount) {

  return `₱${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

}



function orderLabel(order) {

  if (order.displayId) return String(order.displayId);

  if (order.orderId != null) return String(order.orderId);

  return order.orderNumber;

}



function statusCopy(status) {

  if (status === 'approved') {

    return {

      title: 'Order approved',

      desc: 'Your order is complete. Open My Account to view credentials and manage your purchase.'

    };

  }

  if (status === 'pending') {

    return {

      title: 'Receipt received',

      desc: 'We\'re reviewing your payment. You\'ll get your credentials in My Account once approved.'

    };

  }

  return {

    title: 'Order placed',

    desc: 'Complete your payment if you haven\'t yet, then we\'ll verify and deliver your order.'

  };

}



async function loadThanks() {

  const loading = document.getElementById('thanks-loading');

  const errorEl = document.getElementById('thanks-error');

  const content = document.getElementById('thanks-content');



  if (!orderNumber) {

    loading.hidden = true;

    errorEl.hidden = false;

    return;

  }



  try {

    const order = await api(`/orders/${encodeURIComponent(orderNumber)}`);

    const branding = await api('/branding').catch(() => ({ name: 'loveriette' }));

    const storeName = branding.name || 'our shop';



    loading.hidden = true;

    content.hidden = false;



    document.getElementById('thanks-trust-line').textContent =

      `Thank you for trusting ${storeName} — we're honored to serve you.`;



    document.getElementById('thanks-order-id').textContent = `#${orderLabel(order)}`;

    document.getElementById('thanks-order-total').textContent = formatMoney(order.total);



    const status = statusCopy(order.status);

    document.getElementById('thanks-status-title').textContent = status.title;

    document.getElementById('thanks-status-desc').textContent = status.desc;



    const statusBox = document.getElementById('thanks-status-box');

    statusBox.classList.toggle('is-approved', order.status === 'approved');



    const tingiWrap = document.getElementById('thanks-tingi-wrap');

    if (tingiWrap && order.tingiDropEnabled) {

      const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);

      const holdDays = order.tingiHoldDays || 10;

      tingiWrap.hidden = false;

      document.getElementById('thanks-tingi-title').textContent =

        `Tingi Drop — ${holdDays}-day hold`;

      document.getElementById('thanks-tingi-hint').textContent =

        `You reserved ${totalQty} units. Request accounts one-by-one from My Account. Unclaimed units auto-deliver after ${holdDays} days.`;

    }



    const orderLink = document.getElementById('thanks-order-link');
    if (orderLink) {
      orderLink.href = `dashboard.html?order=${encodeURIComponent(order.orderNumber)}#active-purchases`;
      orderLink.hidden = false;
    }



    const emailLine = document.getElementById('thanks-email-line');

    if (emailLine && order.email) {

      emailLine.textContent = `Delivery email: ${order.email}`;

    }



    const primaryBtn = document.querySelector('.thanks-btn-primary');

    if (order.status === 'approved' && primaryBtn) {

      primaryBtn.setAttribute('href', 'dashboard.html');

      primaryBtn.textContent = 'View My Account';

    }

  } catch {

    loading.hidden = true;

    errorEl.hidden = false;

  }

}



loadThanks();

