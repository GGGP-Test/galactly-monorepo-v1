// api-base.js — global API base + fetch patch (docs/)
(function(){
  const DEFAULT = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run';

  function normalize(v){
    if(!v) return DEFAULT;
    v = String(v).trim().replace(/\/+$/,'');
    if(!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }

  // Allow override via ?api=... or saved
  const q = new URLSearchParams(location.search);
  let base = normalize(q.get('api') || localStorage.getItem('apiBase') || DEFAULT);
  window.API_BASE = base;
  try { localStorage.setItem('apiBase', base); } catch {}

  // Patch global fetch: if path starts with /api/, rewrite to API_BASE
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input.url;
      if (url && url.startsWith('/api/')) {
        return _fetch(window.API_BASE + url, Object.assign({}, init));
      }
    } catch {}
    return _fetch(input, init);
  };

  window.__setApiBase = (v) => {
    const next = normalize(v);
    window.API_BASE = next;
    try { localStorage.setItem('apiBase', next); } catch {}
    return next;
  };
})();
