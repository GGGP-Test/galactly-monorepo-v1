(function(){
  const DEFAULT = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run';
  const q = new URLSearchParams(location.search);
  let base = q.get('api') || localStorage.getItem('apiBase') || DEFAULT;
  function norm(v){
    if(!v) return DEFAULT;
    v = String(v).trim().replace(/\/+$/,'');
    if(!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }
  base = norm(base);
  window.API_BASE = base;
  try { localStorage.setItem('apiBase', base); } catch {}

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

  window.__setApiBase = (v) => {
    const next = norm(v);
    window.API_BASE = next;
    try { localStorage.setItem('apiBase', next); } catch {}
    return next;
  };
})();
