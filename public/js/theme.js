// Light/dark theme control for the admin console.
//
// Resolution order: an explicit choice the user has made (stored in this
// browser) wins; otherwise the OS/browser preference is followed live.
// The initial value is stamped onto <html> by a small inline snippet in
// admin.html's <head> so the page never flashes light before this file
// loads -- this module only handles the toggle and OS-change tracking.
//
// Deliberately scoped to admin.html: no other page loads this or sets
// data-theme, so sign-in, complete-profile and the marshal sign-up page
// always render in the light theme.
(function () {
  const KEY = 'lineup_theme';
  const root = document.documentElement;

  function storedChoice() {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (err) {
      return null; // private mode / storage blocked -- fall back to the OS
    }
  }

  function current() {
    return root.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  const btn = document.getElementById('themeToggle');

  function paintToggle(theme) {
    if (!btn) return;
    const dark = theme === 'dark';
    const icon = btn.querySelector('.theme-icon');
    const name = btn.querySelector('.theme-name');
    if (icon) icon.textContent = dark ? '☾' : '☀';
    if (name) name.textContent = dark ? 'Dark' : 'Light';
    btn.setAttribute('aria-pressed', String(dark));
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  function apply(theme) {
    root.dataset.theme = theme;
    paintToggle(theme);
    // Rating tints are written as inline styles when a card renders, so a
    // theme flip leaves them on the old ramp (maroon tints are invisible on
    // dark). Tell the page to repaint whatever is on screen.
    window.dispatchEvent(new CustomEvent('lineup:themechange', { detail: { theme: theme } }));
  }

  if (btn) {
    btn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (err) { /* not fatal */ }
      apply(next);
    });
  }

  // Keep following the OS until the user actually picks a side.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onOsChange = (e) => {
      if (!storedChoice()) apply(e.matches ? 'dark' : 'light');
    };
    if (mq.addEventListener) mq.addEventListener('change', onOsChange);
    else if (mq.addListener) mq.addListener(onOsChange); // older Safari
  }

  paintToggle(current());
})();
