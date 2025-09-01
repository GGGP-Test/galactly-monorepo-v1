// api-base.js — resolve API base and always attach x-galactly-user
(function () {
  const DEFAULT = (window.API_DEFAULT || '').replace(/\/$/, '') ||
                  'https://p01--animated-cellar--vz4ftkwrzdfs.code.run';

  const qs = new URLSearchParams(location.search);
  function normalize(v) {
    if (!v) return DEFAULT;
    let s = String(v).trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  }

  let apiBase = normalize(qs.get('api') || localStorage.getItem('apiBase') || DEFAULT);
  window.API_BASE = apiBase;

  const UID_KEY = 'galactly_uid';
  let uid = localStorage.getItem(UID_KEY);
  if (!uid) { uid = 'u-' + Math.random().toString(36).slice(2); localStorage.setItem(UID_KEY, uid); }

  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    let url, headers;
    if (typeof input === 'string') {
      url = input;
      headers = new Headers((init && init.headers) || undefined);
    } else {
      url = input && input.url;
      headers = new Headers((init && init.headers) || (input && input.headers) || undefined);
    }
    try { headers.set('x-galactly-user', uid); } catch {}

    const needsRewrite = url && (url.startsWith('/api/') || url.startsWith('api/'));
    if (needsRewrite) {
      const abs = url.startsWith('/') ? apiBase + url : apiBase + '/' + url;
      return _fetch(abs, { ...(init||{}), headers });
    }
    return _fetch(typeof input === 'string' ? url : new Request(url, { ...(init||{}), headers }));
  };

  function setBase(v) {
    apiBase = normalize(v);
    window.API_BASE = apiBase;
    try { localStorage.setItem('apiBase', apiBase); } catch {}
    return apiBase;
  }

  window.API = {
    get base(){ return apiBase; },
    setBase,
    uid,
    url: (p)=> (apiBase + (p.startsWith('/') ? p : '/' + p)),
    sseURL: (p)=> {
      const u = new URL(apiBase + (p.startsWith('/') ? p : '/' + p));
      u.searchParams.set('uid', uid);
      return u.toString();
    }
  };
})();
