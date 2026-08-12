// Small shared helper for talking to the API and managing the logged-in session.
const Auth = {
  getToken() { return localStorage.getItem('lineup_token'); },
  getUser() {
    try { return JSON.parse(localStorage.getItem('lineup_user') || 'null'); }
    catch { return null; }
  },
  setSession(token, user) {
    localStorage.setItem('lineup_token', token);
    localStorage.setItem('lineup_user', JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem('lineup_token');
    localStorage.removeItem('lineup_user');
  },
  logout() {
    this.clear();
    window.location.href = 'index.html';
  },
  requireRole(role) {
    const user = this.getUser();
    if (!user || !this.getToken()) {
      window.location.href = 'index.html';
      return null;
    }
    if (role && user.role !== role) {
      window.location.href = user.role === 'admin' ? 'admin.html' : 'marshal.html';
      return null;
    }
    return user;
  },
};

async function apiRequest(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = Auth.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  if (res.status === 401) {
    Auth.clear();
    window.location.href = 'index.html';
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

function showToast(message, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
