// In-app browser (embedded webview) detection.
//
// WHY THIS EXISTS: Google Identity Services refuses to complete a sign-in
// inside an embedded webview -- it returns `disallowed_useragent` -- so a
// marshal who opens the app from a Messenger/Facebook/Instagram link taps
// "Continue with Google", the flow dies part-way, and they are left looking
// at a blank screen. That is not something we can fix on our side; Google
// blocks it deliberately. What we CAN do is recognise the situation up front
// and tell people how to get out of it.
//
// Employee (username + password) login is unaffected -- it never leaves our
// own origin -- so it stays available in these browsers.
window.InApp = (function () {
  const ua = navigator.userAgent || '';

  // Messenger is checked before Facebook: the Messenger iOS agent contains
  // FBAN/MessengerForiOS, which would otherwise match the Facebook pattern
  // and get the wrong name in the message.
  const APPS = [
    { re: /MessengerForiOS|Orca-Android|\bMessenger\b/i, name: 'Messenger' },
    { re: /Instagram/i, name: 'Instagram' },
    { re: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i, name: 'Facebook' },
    { re: /TikTok|BytedanceWebview|musical_ly/i, name: 'TikTok' },
    { re: /MicroMessenger/i, name: 'WeChat' },
    { re: /\bLine\//i, name: 'LINE' },
    { re: /Twitter/i, name: 'X' },
    // Generic Android WebView marker -- last, so a named app wins.
    { re: /;\s*wv\)/i, name: 'this app' },
  ];

  let match = null;
  for (const app of APPS) {
    if (app.re.test(ua)) { match = app.name; break; }
  }

  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  function openInChromeUrl() {
    // Android only: an intent:// URL hands the page to Chrome. iOS has no
    // equivalent, so there the instruction has to be manual.
    if (!isAndroid) return null;
    const scheme = window.location.protocol.replace(':', '');
    const rest = window.location.host + window.location.pathname + window.location.search;
    return `intent://${rest}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  }

  function howToText() {
    if (isIOS) return 'Tap the ••• (or ⋯) button in the corner, then "Open in Safari".';
    if (isAndroid) return 'Tap the ⋮ button in the corner, then "Open in Chrome" — or use the button below.';
    return 'Open this page in your normal web browser (Chrome, Safari or Edge).';
  }

  // Copies the current URL so it can be pasted into a real browser. Falls
  // back to a hidden textarea where the async clipboard API is unavailable,
  // which is common in webviews.
  function copyLink(button) {
    const url = window.location.href;
    const done = (ok) => {
      if (!button) return;
      const original = button.dataset.label || button.textContent;
      button.dataset.label = original;
      button.textContent = ok ? 'Link copied' : 'Press and hold the address bar to copy';
      setTimeout(() => { button.textContent = button.dataset.label; }, 2600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => done(true), () => fallback());
      return;
    }
    fallback();

    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, url.length); // iOS needs the explicit range
        const ok = document.execCommand('copy');
        ta.remove();
        done(ok);
      } catch (err) {
        done(false);
      }
    }
  }

  // Builds the notice. `variant` is 'blocking' on the sign-in page (Google
  // sign-in genuinely cannot work) or 'advisory' elsewhere.
  function buildNotice(variant) {
    const wrap = document.createElement('div');
    wrap.className = 'inapp-notice' + (variant === 'blocking' ? ' inapp-notice-blocking' : '');

    const app = match || 'this app';
    const heading = variant === 'blocking'
      ? `Google sign-in doesn't work inside ${app}`
      : `You're viewing this inside ${app}`;
    const body = variant === 'blocking'
      ? `${app}'s built-in browser blocks Google sign-in, so it will fail part-way and leave a blank screen. Open this page in your normal browser and sign in there. ${howToText()}`
      : `Some things behave differently in a built-in browser. If anything looks wrong, open this page in your normal browser. ${howToText()}`;

    const h = document.createElement('p');
    h.className = 'inapp-notice-title';
    h.textContent = heading;
    wrap.appendChild(h);

    const p = document.createElement('p');
    p.className = 'inapp-notice-body';
    p.textContent = body;
    wrap.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'inapp-notice-actions';

    const chrome = openInChromeUrl();
    if (chrome) {
      const a = document.createElement('a');
      a.className = 'btn btn-primary btn-small';
      a.href = chrome;
      a.textContent = 'Open in Chrome';
      actions.appendChild(a);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn-outline btn-small';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', () => copyLink(copy));
    actions.appendChild(copy);

    wrap.appendChild(actions);
    return wrap;
  }

  return {
    /** True when we are inside a known embedded webview. */
    active: Boolean(match),
    /** Friendly app name, or null. */
    appName: match,
    isIOS: isIOS,
    isAndroid: isAndroid,
    copyLink: copyLink,
    /** Inserts the notice into `target`. Returns the element, or null. */
    renderNotice(target, variant) {
      if (!match || !target) return null;
      const el = buildNotice(variant || 'advisory');
      target.appendChild(el);
      return el;
    },
  };
})();
