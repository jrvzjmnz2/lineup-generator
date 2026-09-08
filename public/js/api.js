// Small shared helper for talking to the API and managing the logged-in session.
//
// Every storage access here is guarded. Embedded webviews (Messenger,
// Facebook, in-app browsers generally) and private-mode browsers can block
// localStorage outright -- an unguarded `localStorage.getItem` THROWS there,
// which used to kill the page script and leave a blank screen. Storage
// failures are now reported instead of thrown, and a redirect counter stops
// the sign-in bounce from becoming an endless loop.
const STORE_KEYS = { token: 'lineup_token', user: 'lineup_user' };
const REDIRECT_GUARD_KEY = 'lineup_redirects';
const REDIRECT_LIMIT = 3;

function safeGet(key) {
  try { return localStorage.getItem(key); } catch (err) { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (err) { return false; }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch (err) { /* nothing to do */ }
}
// Is localStorage actually usable? A webview can expose the object and still
// throw on write, so this probes rather than checking for existence.
function storageWorks() {
  try {
    const probe = '__lineup_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch (err) {
    return false;
  }
}

// Counts consecutive "you look signed out, go to the sign-in page" redirects.
// Uses sessionStorage so it clears itself when the tab closes.
function bumpRedirectCount() {
  try {
    const n = parseInt(sessionStorage.getItem(REDIRECT_GUARD_KEY) || '0', 10) + 1;
    sessionStorage.setItem(REDIRECT_GUARD_KEY, String(n));
    return n;
  } catch (err) {
    return 0; // no sessionStorage -> cannot guard, so never block the redirect
  }
}
function clearRedirectCount() {
  try { sessionStorage.removeItem(REDIRECT_GUARD_KEY); } catch (err) { /* fine */ }
}

const Auth = {
  getToken() { return safeGet(STORE_KEYS.token); },
  getUser() {
    try { return JSON.parse(safeGet(STORE_KEYS.user) || 'null'); }
    catch { return null; }
  },
  /** Returns false when the browser refused to persist the session. */
  setSession(token, user) {
    const ok = safeSet(STORE_KEYS.token, token) && safeSet(STORE_KEYS.user, JSON.stringify(user));
    if (ok) clearRedirectCount();
    return ok;
  },
  storageWorks: storageWorks,
  clear() {
    safeRemove(STORE_KEYS.token);
    safeRemove(STORE_KEYS.user);
  },
  logout() {
    this.clear();
    clearRedirectCount();
    window.location.href = 'index.html';
  },

  // Last resort instead of a blank page: take over the document and say what
  // went wrong. Called when we would otherwise redirect in circles.
  bail(title, detail) {
    const shell = document.createElement('div');
    shell.className = 'container';
    shell.style.maxWidth = '540px';
    shell.style.paddingTop = 'var(--sp-8)';

    const card = document.createElement('div');
    card.className = 'card-panel';

    const h = document.createElement('h1');
    h.style.fontSize = '21px';
    h.style.marginBottom = 'var(--sp-3)';
    h.textContent = title;
    card.appendChild(h);

    const p = document.createElement('p');
    p.className = 'lede';
    p.textContent = detail;
    card.appendChild(p);

    const holder = document.createElement('div');
    holder.style.marginTop = 'var(--sp-4)';
    card.appendChild(holder);

    const retry = document.createElement('button');
    retry.className = 'btn-outline btn-small';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => {
      Auth.clear();
      clearRedirectCount();
      window.location.href = 'index.html';
    });
    holder.appendChild(retry);

    shell.appendChild(card);
    document.body.innerHTML = '';
    document.body.appendChild(shell);

    // If we are inside a webview, the way out is to leave it.
    if (window.InApp && window.InApp.active) {
      window.InApp.renderNotice(holder.parentNode, 'blocking');
    }
  },

  /** Redirects to the sign-in page, unless we have clearly started looping. */
  toSignIn() {
    if (bumpRedirectCount() > REDIRECT_LIMIT) {
      clearRedirectCount();
      const blocked = !storageWorks();
      this.bail(
        blocked ? "This browser isn't keeping you signed in" : 'Could not keep you signed in',
        blocked
          ? 'Your session cannot be saved here, so every page sends you back to sign in. This normally means the page is open inside an app\'s built-in browser or a private window. Open it in your normal browser and sign in there.'
          : 'Something kept sending you back to the sign-in page. Try signing in again, and if it keeps happening let the team know what you were doing.'
      );
      return;
    }
    window.location.href = 'index.html';
  },
  // opts.allowIncompleteProfile: true skips the profileComplete redirect --
  // needed by complete-profile.html itself, since its redirect target IS
  // that page (redirecting there again would loop forever).
  requireRole(role, opts = {}) {
    const user = this.getUser();
    if (!user || !this.getToken()) {
      this.toSignIn();
      return null;
    }
    if (role && user.role !== role) {
      window.location.href = user.role === 'admin' ? 'admin.html' : 'marshal.html';
      return null;
    }
    if (role === 'marshal' && !opts.allowIncompleteProfile && !user.profileComplete) {
      window.location.href = 'complete-profile.html';
      return null;
    }
    clearRedirectCount(); // we got in, so we are not looping
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
    Auth.toSignIn();
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
