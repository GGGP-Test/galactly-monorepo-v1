// Global API base + fetch patch
(function(){
  const DEFAULT = 'https://<YOUR-NORTHFLANK-SVC>.app';
  const q = new URLSearchParams(location.search);
  let base = q.get('api') || localStorage.getItem('apiBase') || DEFAULT;
  function normalize(v){ if(!v) return DEFAULT; v=String(v).trim().replace(/\/+$/,''); if(!/^https?:\/\//i.test(v)) v='https://'+v; return v; }
  base = normalize(base); window.API_BASE = base; try{ localStorage.setItem('apiBase', base); }catch{}
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init)=>{ try{ const url = typeof input==='string'? input : input.url; if(url && url.startsWith('/api/')) return _fetch(window.API_BASE + url, init); }catch{} return _fetch(input, init); };
  window.__setApiBase = v => { const next = normalize(v); window.API_BASE = next; try{ localStorage.setItem('apiBase', next); }catch{} return next; };
})();
