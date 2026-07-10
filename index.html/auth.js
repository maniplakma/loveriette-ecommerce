async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    credentials: 'include'
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showFormError(form, message) {
  const errorEl = form.querySelector('.form-error');
  errorEl.textContent = message;
  errorEl.hidden = false;
}

document.querySelectorAll('.toggle-password').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = btn.parentElement.querySelector('input');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
  });
});

const loginForm = document.querySelector('#login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginForm.querySelector('.form-error').hidden = true;

    const formData = new FormData(loginForm);

    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password')
        })
      });
      showToast('Login successful');
      setTimeout(() => { window.location.href = 'index.html'; }, 900);
    } catch (err) {
      showFormError(loginForm, err.message);
    }
  });
}

const signupForm = document.querySelector('#signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    signupForm.querySelector('.form-error').hidden = true;

    const formData = new FormData(signupForm);
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');

    if (password !== confirmPassword) {
      showFormError(signupForm, 'Passwords do not match');
      return;
    }

    try {
      await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          password
        })
      });
      showToast('Account registered successfully');
      setTimeout(() => { window.location.href = 'index.html'; }, 900);
    } catch (err) {
      showFormError(signupForm, err.message);
    }
  });
}

api('/auth/me').then(({ user }) => {
  if (user) window.location.href = 'index.html';
}).catch(() => {});

const forgotForm = document.querySelector('#forgot-password-form');
if (forgotForm) {
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    forgotForm.querySelector('.form-error').hidden = true;
    const successEl = document.getElementById('forgot-success');
    if (successEl) successEl.hidden = true;

    const formData = new FormData(forgotForm);
    const submitBtn = forgotForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const data = await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: formData.get('email') })
      });
      if (successEl) {
        successEl.textContent = data.message || 'Check your email for a reset link.';
        successEl.hidden = false;
      }
      showToast(data.message || 'Reset link sent');
      forgotForm.reset();
    } catch (err) {
      showFormError(forgotForm, err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

const resetForm = document.querySelector('#reset-password-form');
if (resetForm) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  const tokenInput = document.getElementById('reset-token');
  const invalidEl = document.getElementById('reset-invalid');

  async function initResetPage() {
    if (!token) {
      resetForm.hidden = true;
      if (invalidEl) invalidEl.hidden = false;
      return;
    }
    if (tokenInput) tokenInput.value = token;

    try {
      const { valid } = await api(`/auth/reset-password/verify?token=${encodeURIComponent(token)}`);
      if (!valid) {
        resetForm.hidden = true;
        if (invalidEl) invalidEl.hidden = false;
        return;
      }
      resetForm.hidden = false;
    } catch (_) {
      resetForm.hidden = false;
    }
  }

  initResetPage();

  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    resetForm.querySelector('.form-error').hidden = true;

    const formData = new FormData(resetForm);
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');
    if (password !== confirmPassword) {
      showFormError(resetForm, 'Passwords do not match');
      return;
    }

    const submitBtn = resetForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: formData.get('token') || token,
          password,
          confirmPassword
        })
      });
      showToast('Password updated — sign in now');
      setTimeout(() => { window.location.href = 'login.html'; }, 900);
    } catch (err) {
      showFormError(resetForm, err.message);
      submitBtn.disabled = false;
    }
  });
}

