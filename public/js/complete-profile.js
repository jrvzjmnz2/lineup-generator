(function () {
  // allowIncompleteProfile: true -- this IS the "finish your profile" page,
  // so it must not redirect an incomplete-profile marshal to itself.
  const user = Auth.requireRole('marshal', { allowIncompleteProfile: true });
  if (!user) return;

  const alertBox = document.getElementById('alertBox');
  const form = document.getElementById('profileForm');

  function clearAlert() { alertBox.innerHTML = ''; }
  function setAlert(message, type = 'error') {
    alertBox.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  }

  (async () => {
    try {
      const { user: fresh } = await apiRequest('/auth/me');
      if (fresh.role !== 'marshal') {
        window.location.href = 'admin.html';
        return;
      }
      if (fresh.profileComplete) {
        Auth.setSession(Auth.getToken(), fresh);
        window.location.href = 'marshal.html';
        return;
      }
      Auth.setSession(Auth.getToken(), fresh);
      document.getElementById('pFirstName').value = fresh.firstName || '';
      document.getElementById('pLastName').value = fresh.lastName || '';
    } catch (err) {
      // apiRequest already redirects to index.html on an expired session.
    }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    const payload = {
      firstName: document.getElementById('pFirstName').value.trim(),
      lastName: document.getElementById('pLastName').value.trim(),
      contactNumber: document.getElementById('pContact').value.trim(),
    };
    try {
      const data = await apiRequest('/auth/profile', { method: 'PUT', body: payload });
      Auth.setSession(Auth.getToken(), data.user);
      window.location.href = 'marshal.html';
    } catch (err) {
      setAlert(err.message);
    }
  });
})();
