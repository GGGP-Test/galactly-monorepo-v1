<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Leads Console — Free Panel (V3)</title>
  <link rel="icon" href="data:,"><!-- prevent favicon 404 -->
  <style>
    :root { --bg:#0e1621; --card:#131c26; --muted:#7e8a9a; --text:#e7eef7; --btn:#3a86ff; --ok:#16a34a; --warn:#f59e0b; }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font:14px/1.35 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial}
    .wrap{display:grid;grid-template-columns:420px 1fr;gap:16px;padding:18px}
    .panel{background:var(--card);border:1px solid #1f2b3a;border-radius:10px;padding:14px;min-width:0}
    h1{margin:0 0 8px;font-size:18px}
    label{display:block;margin:12px 0 6px;color:#9fb1c6;font-weight:600}
    input,select,textarea{width:100%;background:#0b121a;color:var(--text);border:1px solid #223144;border-radius:8px;padding:10px 12px}
    textarea{min-height:120px;resize:vertical;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace}
    .row{display:grid;grid-template-columns:1fr auto auto;gap:8px}
    .row-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .row-3{display:grid;grid-template-columns:1fr 120px 140px;gap:8px}
    button{background:#1f2b3a;color:#dbe7f6;border:1px solid #2a3b53;border-radius:8px;padding:9px 12px;cursor:pointer}
    button.primary{background:var(--btn);border-color:#2b5fd6;color:#fff}
    button.ok{background:#14351e;border-color:#1f6f3e;color:#a7f3d0}
    button.warn{background:#3c2e12;border-color:#a16207;color:#fde68a}
    button:disabled{opacity:.55;cursor:not-allowed}
    .tags{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 0}
    .tag, .pill{font:12px/1.1 ui-monospace,monospace;background:#0b121a;border:1px dashed #2a3b53;color:#9fb1c6;padding:4px 8px;border-radius:999px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px 8px;border-bottom:1px solid #1f2b3a;text-align:left}
    th{color:#9fb1c6;font-weight:600;position:sticky;top:0;background:var(--card)}
    .temp-warm{color:#fde68a}
    .muted{color:var(--muted)}
    @media (max-width:1000px){ .wrap{grid-template-columns:1fr} }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel" id="left">
      <h1>Leads Console — Free Panel (V3)</h1>

      <label for="base">API base</label>
      <div class="row">
        <input id="base" placeholder="https://p01--your-app.code.run"/>
        <button id="apply" class="primary">Apply</button>
        <button id="clearList">Clear list</button>
      </div>

      <label for="root">API root (prefixed to paths)</label>
      <div class="row">
        <input id="root" placeholder="(blank for none, example: /api or /api/v1)"/>
        <button id="health" class="ok">Health</button>
        <button id="probe" class="warn">Probe</button>
      </div>

      <label for="key">API key (optional for read; required for write)</label>
      <div class="row">
        <input id="key" placeholder="paste key"/>
        <button id="saveKey">Save</button>
        <button id="clrKey">Clear</button>
      </div>

      <div class="tags" id="quickTags"></div>

      <label>Action</label>
      <select id="action">
        <option value="find-buyers" selected>Find buyers (one per click)</option>
        <option value="find-one">Find one (strict)</option>
      </select>

      <label for="host">Supplier host</label>
      <input id="host" placeholder="peekpackaging.com"/>

      <label>Region / Radius</label>
      <div class="row-2">
        <select id="region">
          <option>US/CA</option><option>US/NY</option><option>US/WA</option><option>US/TX</option>
        </select>
        <select id="radius">
          <option>25 mi</option><option selected>50 mi</option><option>100 mi</option>
        </select>
      </div>

      <label>Path for action (relative to API root)</label>
      <div class="row-3">
        <input id="path" value="/leads/find-buyers"/>
        <select id="method">
          <option>GET</option><option>POST</option>
        </select>
        <select id="fallbacks">
          <option value="auto">Auto-probe on 404</option>
          <option value="none" selected>No fallbacks</option>
        </select>
      </div>

      <div class="row" style="margin-top:10px">
        <div></div>
        <button id="find" class="primary">Find buyers</button>
        <button id="dlCSV">Download CSV</button>
      </div>

      <label>HTTP log</label>
      <textarea id="httpLog" readonly></textarea>
    </div>

    <div class="panel" id="right">
      <div class="row" style="grid-template-columns:1fr auto;align-items:center">
        <div class="muted" id="count">0 items</div>
        <div>
          <span class="pill" id="pillHealth">health: unknown</span>
          <span class="pill" id="pillRoutes">routes: (tap Probe)</span>
          <span class="pill" id="pillRoot">root: (auto)</span>
        </div>
      </div>
      <div style="overflow:auto; margin-top:10px; max-height:76vh;">
        <table id="tbl">
          <thead>
          <tr>
            <th style="width:48px;">#</th>
            <th>Host</th>
            <th>Platform</th>
            <th>Title</th>
            <th>Created</th>
            <th>Temp</th>
            <th>Why (human-readable)</th>
          </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  </div>

<script>
(() => {
  // ---------- state ----------
  const S = { base:'', root:'', key:'', items:[], routes:null, lastOK:null };

  // ---------- dom ----------
  const $ = s => document.querySelector(s);
  const UI = {
    base:$('#base'), apply:$('#apply'), clearList:$('#clearList'),
    root:$('#root'), health:$('#health'), probe:$('#probe'),
    key:$('#key'), saveKey:$('#saveKey'), clrKey:$('#clrKey'),
    action:$('#action'), host:$('#host'), region:$('#region'), radius:$('#radius'),
    path:$('#path'), method:$('#method'), fallbacks:$('#fallbacks'),
    find:$('#find'), dlCSV:$('#dlCSV'),
    log:$('#httpLog'), rows:$('#rows'), count:$('#count'),
    pillHealth:$('#pillHealth'), pillRoutes:$('#pillRoutes'), pillRoot:$('#pillRoot'),
    tags:$('#quickTags')
  };

  // ---------- utils ----------
  const log = (line) => {
    const ts = new Date().toLocaleTimeString('en-US',{hour12:false});
    UI.log.value += `[${ts}] ${line}\n`; UI.log.scrollTop = UI.log.scrollHeight;
  };
  const stripQuotes = s => (s||'').trim().replace(/^["']+|["']+$/g,'');
  const ensureScheme = s => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : (s ? `https://${s}` : s);
  const trimSlashes = s => s.replace(/\/+$/,'');
  const leadingSlash = s => s ? ('/' + s.replace(/^\/+/,'').replace(/\/+$/,'')) : '';

  function sanitizeBase(raw){ let s = stripQuotes(raw); s = ensureScheme(s); return trimSlashes(s); }
  function sanitizeRoot(raw){ let r = stripQuotes(raw||''); return r ? leadingSlash(r) : ''; }

  function buildURL(path){
    const base = sanitizeBase(S.base);
    if (!base) throw new Error('Missing API base');
    const root = sanitizeRoot(S.root);
    const p = ('/' + String(path||'').replace(/^\/+/, ''));
    return new URL(root + p, base + '/').toString();
  }

  async function call(method, path, body){
    try{
      const url = buildURL(path);
      const headers = {'Content-Type':'application/json'};
      if (S.key) headers['Authorization'] = `Bearer ${S.key}`;
      const init = { method, headers };

      if (method === 'GET'){
        const u = new URL(url);
        if (body && typeof body === 'object'){
          for (const [k,v] of Object.entries(body)) u.searchParams.set(k, v);
        }
        log(`${method}  —  ${u.pathname}${u.search}`);
        const res = await fetch(u, {headers});
        return wrap(res);
      } else {
        if (body) init.body = JSON.stringify(body);
        log(`${method}  —  ${new URL(url).pathname}`);
        const res = await fetch(url, init);
        return wrap(res);
      }
    } catch(err){
      console.error(err); log(`ERR  —  ${err.message}`); return {ok:false,error:err.message};
    }
  }
  async function wrap(res){
    let data=null; try{ data=await res.json(); }catch{}
    const ok = res.ok && (data?.ok ?? true);
    if (ok) S.lastOK = `${res.status} — ${res.url}`;
    return { ok, status:res.status, data, url:res.url };
  }

  // ---------- health/probe ----------
  async function doHealth(){
    const r = await call('GET','/healthz');
    UI.pillHealth.textContent = `health: ${r.ok?'200':r.status} @ /healthz`;
    UI.pillHealth.style.borderColor = r.ok ? '#1f6f3e' : '#a11';
    return r.ok;
  }
  async function probeRoutes(){
    const cand = ['/routes','/_routes','/endpoints','/openapi.json','/swagger.json'];
    for (const p of cand){
      const r = await call('GET', p);
      if (r.ok){
        S.routes = r.data?.routes || r.data;
        UI.pillRoutes.textContent = `routes: 200 — GET ${p}`;
        return true;
      }
    }
    UI.pillRoutes.textContent = `routes: none`; return false;
  }

  // ---------- results / rendering ----------
  function normalizeLead(raw={}, q={}){
    const pick = (...keys)=> keys.find(k=> raw[k]!==undefined);
    let host = raw.host ?? raw.domain;
    if (!host && raw.url){ try{ host=new URL(raw.url).hostname }catch{} }
    host = host || q.host || '';

    const title = raw.title ?? raw.label ?? raw.context?.label ?? `Buyer lead for ${host}`;
    const created = raw.created ?? raw.date ?? raw.time ?? new Date().toISOString();
    const temp = raw.temp ?? raw.temperature ?? raw.heat ?? 'warm';
    const whyText = raw.whyText ?? raw.why ?? raw.reason ?? raw.context?.whyText ?? `API matched (${q.region}, ${q.radius})`;
    const platform = raw.platform ?? 'web';

    return { host, platform, title, created, temp, whyText };
  }

  function pushMany(items){
    S.items = (items||[]).concat(S.items||[]);
    S.items = S.items.slice(0, 200);
    localStorage.setItem('items', JSON.stringify(S.items));
    render();
  }

  function render(){
    UI.rows.innerHTML='';
    (S.items||[]).forEach((it,i)=>{
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td>${i+1}</td>
        <td>${it.host||''}</td>
        <td>${it.platform||''}</td>
        <td>${it.title||''}</td>
        <td>${it.created||''}</td>
        <td class="temp-${it.temp||''}">${it.temp||''}</td>
        <td>${it.whyText||''}</td>`;
      tr.onclick=()=>alert(`Result #${i+1} — ${it.host}\n\n`+JSON.stringify(it,null,2));
      UI.rows.appendChild(tr);
    });
    UI.count.textContent = `${(S.items||[]).length} item${S.items.length===1?'':'s'}`;
  }

  // ---------- actions ----------
  async function findBuyers(){
    if (!sanitizeBase(S.base)){ log('ERR — base is empty/invalid'); return; }

    // choose default path when user switches the action
    let path = UI.path.value.trim();
    if (!path){
      path = UI.action.value === 'find-one' ? '/buyers/find-one' : '/leads/find-buyers';
      UI.path.value = path;
    }

    const q = {
      host: UI.host.value.trim(),
      region: UI.region.value.trim(),
      radius: UI.radius.value.trim()
    };
    const method = UI.method.value;

    let r = method==='GET' ? await call('GET', path, q) : await call('POST', path, q);

    if (!r.ok && UI.fallbacks.value==='auto'){
      const tries = [
        ['/buyers/find-buyers', method],
        ['/buyers/find-one', 'GET'],
        ['/leads/find-one', 'GET'],
        ['/find-one', 'GET'],
        ['/find', 'GET'],
      ];
      for (const [p,m] of tries){
        r = m==='GET' ? await call('GET', p, q) : await call(m, p, q);
        if (r.ok) break;
      }
    }

    if (!r.ok){ log(`${r.status} — request failed`); return; }

    // ---- NEW: map real payloads if present
    let rawItems = [];
    const d = r.data;
    if (Array.isArray(d?.items)) rawItems = d.items;
    else if (d?.item) rawItems = [d.item];
    else if (Array.isArray(d)) rawItems = d;

    let items = rawItems.map(x => normalizeLead(x, q));

    // fallback if server returned an ok without items
    if (!items.length){
      items = [normalizeLead({}, q)];
      items[0].whyText = `Compat shim matched (${q.region}, ${q.radius})`;
    }

    pushMany(items);
  }

  function toCSV(items){
    const cols = ['host','platform','title','created','temp','whyText'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const rows = (items||[]).map(it => cols.map(c => esc(it[c])).join(','));
    return [cols.join(','), ...rows].join('\r\n');
  }
  function download(name, text){
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([text],{type:'text/csv'}));
    a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- bootstrap / persistence ----------
  function applyBase(){
    const sanitized = sanitizeBase(UI.base.value);
    S.base = sanitized; UI.base.value = sanitized;
    localStorage.setItem('base', sanitized);
    const on = !!sanitized;
    [UI.find, UI.health, UI.probe].forEach(b=>b.disabled=!on);
    UI.pillRoot.textContent = `root: (auto)`;
    log('Base applied');
  }

  function load(){
    S.base = sanitizeBase(localStorage.getItem('base') || UI.base.value);
    S.root = sanitizeRoot(localStorage.getItem('root') || UI.root.value);
    S.key  = stripQuotes(localStorage.getItem('key') || '');

    UI.base.value=S.base; UI.root.value=S.root; UI.key.value=S.key;

    try{ S.items = JSON.parse(localStorage.getItem('items')||'[]')||[]; }catch{ S.items=[]; }

    const on = !!S.base; [UI.find,UI.health,UI.probe].forEach(b=>b.disabled=!on);
    render();
  }

  // ---------- wire ----------
  function bind(){
    UI.apply.onclick = applyBase;
    UI.clearList.onclick = () => { S.items=[]; localStorage.removeItem('items'); render(); };
    UI.saveKey.onclick = () => { S.key = UI.key.value.trim(); localStorage.setItem('key', S.key); log('API key saved'); };
    UI.clrKey.onclick  = () => { S.key=''; UI.key.value=''; localStorage.removeItem('key'); log('API key cleared'); };

    UI.health.onclick = async () => { if (!sanitizeBase(S.base)) return; await doHealth(); };
    UI.probe.onclick  = async () => { if (!sanitizeBase(S.base)) return; await probeRoutes(); };

    UI.find.onclick = findBuyers;
    UI.dlCSV.onclick = () => download('leads.csv', toCSV(S.items));

    // default path when action changes (don’t override a manual path)
    UI.action.onchange = () => {
      if (!UI.path.value.trim()){
        UI.path.value = UI.action.value === 'find-one' ? '/buyers/find-one' : '/leads/find-buyers';
      }
    };

    // quick region tags
    UI.tags.innerHTML='';
    ['US/CA','US/NY','US/TX','US/WA'].forEach(x=>{
      const b=document.createElement('button');
      b.className='pill'; b.textContent=x; b.onclick=()=>UI.region.value=x; UI.tags.appendChild(b);
    });
  }

  bind(); load();
})();
</script>
</body>
</html>