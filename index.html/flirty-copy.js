/**
 * Buyer-facing copy — toasts, notifications, and UI hints (English).
 * Skipped on admin pages. Product names/descriptions are untouched.
 */
(function () {
  const TOAST_MAP = {
    'Order approved!': 'Order approved — check My Purchases for your credentials.',
    'Receipt submitted — awaiting approval': 'Receipt received — we will review it shortly.',
    'Order placed — complete your payment': 'Order placed — complete payment to continue.',
    'Added to cart': 'Added to cart.',
    'Login successful': 'Welcome back.',
    'Account registered successfully': 'Account created — welcome to loveriette.',
    'Order number copied': 'Order number copied.',
    'Could not copy': 'Could not copy — please try again.',
    'Link copied!': 'Link copied.',
    'Please select a receipt image before confirming': 'Upload your receipt image before confirming.',
    'Only JPG, PNG, WebP, or GIF images are allowed': 'Use JPG, PNG, WebP, or GIF only.',
    'Receipt image must be 4MB or smaller': 'Receipt image must be 4MB or smaller.',
    'This order can no longer be confirmed': 'This order can no longer be confirmed — check your dashboard.',
    'Message sent': 'Message sent — we will reply soon.',
    'Profile saved': 'Profile updated.',
    'Preferences saved': 'Preferences saved.',
    'Ticket submitted': 'Support ticket submitted.',
    'Application submitted!': 'Application submitted.',
    'Inquiry sent! We\'ll contact you soon.': 'Inquiry sent — we will contact you soon.',
    'Payment failed': 'Payment failed — please try again.',
    'Select a valid payment method': 'Select a payment method first.'
  };

  const NOTIF_STATUS = {
    approved: 'Approved — your order is ready in My Purchases.',
    pending: 'Receipt received — awaiting review.',
    pending_payment: 'Awaiting payment.',
    rejected: 'Order declined — see your dashboard for details.',
    refunded: 'Refund processed.'
  };

  function isAdminContext() {
    if (typeof isFunctionalPage === 'function' && isFunctionalPage()) return true;
    return document.body?.classList?.contains('admin-page')
      || document.body?.classList?.contains('buyer-dashboard-page')
      || document.body?.classList?.contains('auth-page');
  }

  function toast(message) {
    if (isAdminContext() || !message) return message;
    return TOAST_MAP[message] || message;
  }

  function orderStatus(status) {
    return NOTIF_STATUS[status] || status;
  }

  function orderNotifText(orderLabel, status) {
    if (status === 'pending_payment') {
      return `Complete payment for ${orderLabel}.`;
    }
    if (status === 'approved') {
      return `${orderLabel} approved — check My Purchases.`;
    }
    return `${orderLabel} — ${orderStatus(status)}`;
  }

  window.flirtCopy = { toast, orderStatus, orderNotifText, isAdminContext };
})();
