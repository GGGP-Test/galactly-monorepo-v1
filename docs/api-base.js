// api-base.js — sets window.API_BASE and adds x-galactly-user; plus small helpers.
(function(){
  const DEFAULT = (window.API_DEFAULT || 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run').replace(/\/$/,'');
  const qs = new URLSearchParams(location.search);
  function normalize(v){
    if(!v) return DEFAULT;
    let s = String(v).trim().replace(/\/$/,'');
    if(!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  }
  let apiBase = normalize(qs.get('api') || localStorage.getItem('apiBase') || DEFAULT);
  window.API_BASE = apiBase;

  const UID_KEY='galactly_uid';
  let uid = localStorage.getItem(UID_KEY);
  if(!uid){ uid = 'u-'+Math.random().toString(36).slice(2); localStorage.setItem(UID_KEY, uid); }

  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    let url, headers;
    if (typeof input === 'string') { url = input; headers = new Headers((init && init.headers) || undefined); }
    else { url = input && input.url; headers = new Headers((init && init.headers) || (input && input.headers) || undefined); }
    try { headers.set('x-galactly-user', uid); } catch {}
    if (url && (url.startsWith('/api/') || url.startsWith('api/'))) {
      const abs = url.startsWith('/') ? apiBase + url : apiBase + '/' + url;
      return _fetch(abs, { ...(init||{}), headers });
    }
    return _fetch(typeof input === 'string' ? url : new Request(url, { ...(init||{}), headers }));
  };

  async function get(path){ const r=await fetch(apiBase + (path.startsWith('/')?path:'/'+path)); if(!r.ok) throw new Error('GET '+path); return r.json(); }
  async function post(path, body){ const r=await fetch(apiBase + (path.startsWith('/')?path:'/'+path), { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body||{}) }); if(!r.ok) throw new Error('POST '+path); return r.json(); }

  function setBase(v){ apiBase = normalize(v); window.API_BASE = apiBase; try{ localStorage.setItem('apiBase', apiBase); }catch{} return apiBase; }

  window.API = { get base(){return apiBase;}, setBase, uid, get, post };
})();
