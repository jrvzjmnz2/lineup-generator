(function () {
  // If already logged in, skip straight to the right dashboard.
  const existingUser = Auth.getUser();
  if (existingUser && Auth.getToken()) {
    window.location.href = existingUser.role === 'admin' ? 'admin.html' : 'marshal.html';
    return;
  }

  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const alertBox = document.getElementById('alertBox');

  function clearAlert() { alertBox.innerHTML = ''; }
  function setAlert(message, type = 'error') {
    alertBox.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  }

  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    loginForm.style.display = '';
    registerForm.style.display = 'none';
    clearAlert();
  });

  tabRegisterBtn.addEventListener('click', () => {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    registerForm.style.display = '';
    loginForm.style.display = 'none';
    clearAlert();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    try {
      const data = await apiRequest('/auth/login', { method: 'POST', body: { username, password } });
      Auth.setSession(data.token, data.user);
      window.location.href = data.user.role === 'admin' ? 'admin.html' : 'marshal.html';
    } catch (err) {
      setAlert(err.message);
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    const payload = {
      firstName: document.getElementById('regFirstName').value.trim(),
      lastName: document.getElementById('regLastName').value.trim(),
      username: document.getElementById('regUsername').value.trim(),
      email: document.getElementById('regEmail').value.trim(),
      gender: document.getElementById('regGender').value,
      contactNumber: document.getElementById('regContact').value.trim(),
      password: document.getElementById('regPassword').value,
      confirmPassword: document.getElementById('regConfirmPassword').value,
    };
    if (payload.password !== payload.confirmPassword) {
      setAlert('Password and Confirm Password do not match.');
      return;
    }
    try {
      const data = await apiRequest('/auth/register', { method: 'POST', body: payload });
      Auth.setSession(data.token, data.user);
      window.location.href = 'marshal.html';
    } catch (err) {
      setAlert(err.message);
    }
  });
})();
