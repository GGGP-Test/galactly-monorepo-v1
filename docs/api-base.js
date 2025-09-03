/* api-base.js
   - Sets API_BASE from ?api=... or localStorage('apiBase') or window.API_DEFAULT or location.origin
   - Adds sticky x-galactly-user and optional x-galactly-dev: unlim
   - Rewrites requests for /api/* and /presence/* to API_BASE
*/
(function () {
  if (window.API && window.API.__ready) return;

  function normalizeBase(v) {
    if (!v) return null;
    let s = String(v).trim();
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    return s.replace(/\/+$/, '');
  }

  const qs = new URLSearchParams(location.search);
  const qsApi   = normalizeBase(qs.get('api'));
  const saved   = normalizeBase(localStorage.getItem('apiBase') || '');
  const deflt   = normalizeBase(window.API_DEFAULT || '');
  const base    = qsApi || saved || deflt || normalizeBase(location.origin);

  // persist so all pages use the same API host
  localStorage.setItem('apiBase', base);

  // sticky uid
  const UID_KEY = 'galactly_uid';
  let uid = localStorage.getItem(UID_KEY);
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(UID_KEY, uid);
  }

  // dev-unlimited toggle
  const DEV_UNLIM = (localStorage.getItem('DEV_UNLIM') || '').toString() === '1';

  // wrap fetch
  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let url, opts;

    if (typeof input === 'string') {
      url = input;
      opts = init || {};
    } else {
      url = input.url;
      opts = Object.assign({}, init || {});
      // merge headers from Request + provided init
      opts.headers = Object.assign({}, Object.fromEntries(input.headers || []), opts.headers || {});
    }

    // rewrite to API_BASE for both /api/* and /presence/*
    if (url.startsWith('/api/')) {
      url = base + url;
    } else if (url.startsWith('/presence/')) {
      url = base + url;
    }

    const headers = new Headers(opts.headers || {});
    try { headers.set('x-galactly-user', uid); } catch {}
    if (DEV_UNLIM) {
      try { headers.set('x-galactly-dev', 'unlim'); } catch {}
    }

    opts.headers = headers;
    return _fetch(url, opts);
  };

  window.API = {
    __ready: true,
    base,
    uid,
    devUnlim: DEV_UNLIM,
    url(p) { return base + (p.startsWith('/') ? p : '/' + p); },
    setDevUnlim(on) {
      localStorage.setItem('DEV_UNLIM', on ? '1' : '0');
      location.reload();
    }
  };

  // tiny helper to show where we're pointing (optional)
  console.log('[API] base =', base, 'uid =', uid, 'dev-unlim =', DEV_UNLIM);
})();
