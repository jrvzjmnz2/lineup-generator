(function () {
  // If already logged in, skip straight to the right place.
  const existingUser = Auth.getUser();
  if (existingUser && Auth.getToken()) {
    routeAfterLogin(existingUser);
    return;
  }

  const employeeLoginToggle = document.getElementById('employeeLoginToggle');
  const loginForm = document.getElementById('loginForm');
  const alertBox = document.getElementById('alertBox');
  const googleUnavailableMsg = document.getElementById('googleUnavailableMsg');
  const googleSignInButton = document.getElementById('googleSignInButton');

  function clearAlert() { alertBox.innerHTML = ''; }
  function setAlert(message, type = 'error') {
    alertBox.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  }

  function routeAfterLogin(user) {
    if (user.role === 'admin') {
      window.location.href = 'admin.html';
    } else if (!user.profileComplete) {
      window.location.href = 'complete-profile.html';
    } else {
      window.location.href = 'marshal.html';
    }
  }

  employeeLoginToggle.addEventListener('click', () => {
    const showing = loginForm.style.display !== 'none';
    loginForm.style.display = showing ? 'none' : '';
    employeeLoginToggle.textContent = showing ? 'Employee Login' : 'Hide Employee Login';
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
      routeAfterLogin(data.user);
    } catch (err) {
      setAlert(err.message);
    }
  });

  // Called by Google Identity Services once the user picks an account.
  window.handleGoogleCredential = async function handleGoogleCredential(response) {
    clearAlert();
    try {
      const data = await apiRequest('/auth/google', { method: 'POST', body: { credential: response.credential } });
      Auth.setSession(data.token, data.user);
      routeAfterLogin(data.user);
    } catch (err) {
      setAlert(err.message);
    }
  };

  // The Google Identity Services script tag is `async defer`, so it may not
  // have finished loading yet when this file runs -- poll briefly for it
  // instead of assuming it's either instantly ready or never coming.
  function waitForGoogleScript(timeoutMs = 4000) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(poll, 100);
        }
      })();
    });
  }

  async function initGoogleSignIn() {
    try {
      const [{ googleClientId }, googleReady] = await Promise.all([
        apiRequest('/auth/config'),
        waitForGoogleScript(),
      ]);
      if (!googleClientId || !googleReady) {
        googleUnavailableMsg.style.display = '';
        return;
      }
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: window.handleGoogleCredential,
      });
      google.accounts.id.renderButton(googleSignInButton, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        width: 280,
      });
    } catch (err) {
      googleUnavailableMsg.style.display = '';
    }
  }

  initGoogleSignIn();
})();
