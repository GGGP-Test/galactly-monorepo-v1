// api-base.js — tiny helper to point the UI at your backend and
// automatically add the x-galactly-user header. Also exposes
// convenient API helpers.
(function(){
  const DEFAULT = (window.API_DEFAULT || 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run').replace(/\/$/,'');

  // ------- resolve API base (query > saved > default) -------
  const qs = new URLSearchParams(location.search);
  function normalize(v){
    if(!v) return DEFAULT;
    let s = String(v).trim();
    s = s.replace(/\/$/,'');
    if(!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  }
  let apiBase = normalize(qs.get('api') || localStorage.getItem('apiBase') || DEFAULT);
  window.API_BASE = apiBase; // legacy global

  // ------- user id (sticky) -------
  const UID_KEY = 'galactly_uid';
  let uid = localStorage.getItem(UID_KEY);
  if(!uid){ uid = 'u-' + Math.random().toString(36).slice(2); localStorage.setItem(UID_KEY, uid); }

  // ------- url helpers -------
  function apiURL(path){
    const p = String(path||'');
    const rel = p.startsWith('/') ? p : ('/' + p);
    return apiBase + rel;
  }
  function sseURL(path){
    const url = new URL(apiURL(path));
    url.searchParams.set('uid', uid);
    return url.toString();
  }

  // ------- fetch patch (adds base + user header) -------
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    let url, headers;
    if (typeof input === 'string') {
      url = input;
      headers = new Headers(init && init.headers || undefined);
    } else {
      url = input && input.url;
      headers = new Headers((init && init.headers) || (input && input.headers) || undefined);
    }

    // add sticky user header
    try { headers.set('x-galactly-user', uid); } catch {}

    // rewrite relative API calls
    if (url && (url.startsWith('/api/') || url.startsWith('api/'))) {
      const abs = url.startsWith('/') ? apiBase + url : apiBase + '/' + url;
      return _fetch(abs, { ...(init||{}), headers });
    }
    // otherwise call through (but ensure header still present if same-origin API was absolute)
    return _fetch(typeof input === 'string' ? url : new Request(url, { ...(init||{}), headers }));
  };

  // ------- small JSON helpers -------
  async function get(path){
    const r = await fetch(apiURL(path));
    if(!r.ok) throw new Error('GET '+path+' '+r.status);
    return r.json();
  }
  async function post(path, body){
    const r = await fetch(apiURL(path), { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body||{}) });
    if(!r.ok) throw new Error('POST '+path+' '+r.status);
    return r.json();
  }

  // ------- allow runtime switch -------
  function setBase(v){
    apiBase = normalize(v);
    window.API_BASE = apiBase;
    try { localStorage.setItem('apiBase', apiBase); } catch {}
    return apiBase;
  }

  // expose a tiny API namespace
  window.API = {
    get base(){ return apiBase; },
    setBase,
    uid,
    url: apiURL,
    sseURL,
    get, post
  };
})();
