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
