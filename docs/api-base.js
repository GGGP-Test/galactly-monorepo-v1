// api-base.js — global API base + fetch patch
(function(){
  const DEFAULT = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run'; // Render API (your backend)

  // Allow override via ?api=... or saved setting
  const q = new URLSearchParams(location.search);
  let base = q.get('api') || localStorage.getItem('apiBase') || DEFAULT;

  function normalize(v){
    if(!v) return DEFAULT;
    v = String(v).trim().replace(/\/+$/,'');
    if(!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }

  base = normalize(base);
  window.API_BASE = base;

  // Persist chosen base for future visits
  try { localStorage.setItem('apiBase', base); } catch {}

  // Patch global fetch: if request starts with /api/, rewrite to API_BASE
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input.url;
      if (url && url.startsWith('/api/')) {
        return _fetch(window.API_BASE + url, init);
      }
    } catch {}
    return _fetch(input, init);
  };

  // Helper to adjust base at runtime (used by settings UIs)
  window.__setApiBase = (v) => {
    const next = normalize(v);
    window.API_BASE = next;
    try { localStorage.setItem('apiBase', next); } catch {}
    return next;
  };
})();
// api-base.js — global API base + fetch patch
(function(){
  const DEFAULT = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run'; // Render API (your backend)

  // Allow override via ?api=... or saved setting
  const q = new URLSearchParams(location.search);
  let base = q.get('api') || localStorage.getItem('apiBase') || DEFAULT;

  function normalize(v){
    if(!v) return DEFAULT;
    v = String(v).trim().replace(/\/+$/,'');
    if(!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }

  base = normalize(base);
  window.API_BASE = base;

  // Persist chosen base for future visits
  try { localStorage.setItem('apiBase', base); } catch {}

  // Patch global fetch: if request starts with /api/, rewrite to API_BASE
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input.url;
      if (url && url.startsWith('/api/')) {
        return _fetch(window.API_BASE + url, init);
      }
    } catch {}
    return _fetch(input, init);
  };

  // Helper to adjust base at runtime (used by settings UIs)
  window.__setApiBase = (v) => {
    const next = normalize(v);
    window.API_BASE = next;
    try { localStorage.setItem('apiBase', next); } catch {}
    return next;
  };
})();
