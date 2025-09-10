import express, { Request, Response } from "express";

/**
 * Mounts a lightweight operator console at GET /admin.
 * No extra packages. Uses same-origin API calls.
 */
export function mountAdmin(app: express.Application) {
  const router = express.Router();

  router.get("/admin", (_req: Request, res: Response) => {
    // Override the strict CSP used for JSON so inline JS/CSS can run on this page only.
    try {
      res.removeHeader("Content-Security-Policy");
    } catch {}
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';");

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Galactly • Leads Console</title>
<style>
  :root { --bg:#0b0e12; --panel:#131821; --muted:#8aa0b5; --txt:#e8f1ff; --accent:#6ea8fe; --ok:#2ecc71; --warn:#f1c40f; --hot:#ff6b6b; --warm:#ffb86b; --chip:#1c2431; }
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif}
  header{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #1c2431;background:var(--panel);position:sticky;top:0;z-index:2}
  header h1{font-size:16px;margin:0}
  .row{display:flex;gap:16px;padding:16px}
  .col{flex:1;min-width:320px;background:var(--panel);border:1px solid #1c2431;border-radius:10px}
  .col h2{margin:0;padding:12px 14px;border-bottom:1px solid #1c2431;font-size:14px}
  .pad{padding:12px 14px}
  input, select, textarea{width:100%;background:#0e141c;border:1px solid #283244;color:var(--txt);border-radius:8px;padding:10px}
  button{background:#1f2a3a;border:1px solid #2b3950;color:var(--txt);border-radius:8px;padding:8px 12px;cursor:pointer}
  button.primary{background:var(--accent);border-color:var(--accent);color:#08101b}
  .grid{width:100%;border-collapse:collapse}
  .grid th,.grid td{padding:10px;border-bottom:1px solid #1c2431;text-align:left;vertical-align:top}
  .chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:var(--chip);color:var(--muted);font-size:12px}
  .chip.hot{background:rgba(255,107,107,.15);color:var(--hot)}
  .chip.warm{background:rgba(255,184,107,.15);color:var(--warm)}
  .muted{color:var(--muted)}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  .stack{display:flex;flex-direction:column;gap:8px}
  .right{margin-left:auto}
  .small{font-size:12px}
  .sep{height:1px;background:#1c2431;margin:10px 0}
  .row.wrap{flex-wrap:wrap}
  .kbd{border:1px solid #2b3950;padding:2px 6px;border-radius:6px;background:#0e141c}
</style>
</head>
<body>
<header>
  <h1>Leads Console</h1>
  <div class="actions">
    <label class="muted small">API key</label>
    <input id="apiKey" placeholder="Paste your API key" style="width:320px" />
    <button id="saveKey">Save</button>
    <button id="logout">Clear</button>
  </div>
</header>

<div class="row wrap">
  <div class="col" style="flex:2">
    <h2>Hot / Warm</h2>
    <div class="pad actions">
      <button class="primary" id="refreshHot">Refresh Hot</button>
      <button id="refreshWarm">Refresh Warm</button>
      <span class="muted small right">Tip: press <span class="kbd">R</span> to refresh hot</span>
    </div>
    <div class="pad">
      <table class="grid" id="leadsTable">
        <thead>
          <tr><th>ID</th><th>Host</th><th>Platform</th><th>Title</th><th>Created</th><th>Temp</th><th>Why</th><th></th></tr>
        </thead>
        <tbody id="leadsTbody"></tbody>
      </table>
    </div>
  </div>

  <div class="col" style="flex:1">
    <h2>Details</h2>
    <div class="pad stack" id="details">
      <div class="muted">Select a lead…</div>
    </div>
  </div>

  <div class="col" style="flex:1">
    <h2>Ingest (single)</h2>
    <div class="pad stack">
      <input id="ingCat" placeholder="cat e.g. product" />
      <input id="ingKw" placeholder="kw (comma separated) e.g. labels, rfq" />
      <input id="ingPlatform" placeholder="platform e.g. shopify" />
      <input id="ingUrl" placeholder="source_url https://…" />
      <input id="ingTitle" placeholder="title" />
      <button class="primary" id="ingSubmit">Ingest</button>
      <div class="small muted">Requires API key.</div>
      <div class="sep"></div>
      <div class="actions">
        <button id="dlHot">Download CSV (hot)</button>
        <button id="dlWarm">Download CSV (warm)</button>
      </div>
    </div>
  </div>
</div>

<script>
const $ = (sel)=>document.querySelector(sel);
const api = {
  base: location.origin,
  key(){ return localStorage.getItem('API_KEY') || ''; },
  setKey(v){ localStorage.setItem('API_KEY', v); },
  hdr(){ const k=this.key(); return k? { 'x-api-key': k } : {}; },
  async jget(path){ const r=await fetch(this.base+path, { headers: { ...this.hdr() } }); return r.json(); },
  async jpost(path, body){ const r=await fetch(this.base+path, { method:'POST', headers:{ 'Content-Type':'application/json', ...this.hdr() }, body: JSON.stringify(body)}); return r.json(); },
  async jpatch(path, body){ const r=await fetch(this.base+path, { method:'PATCH', headers:{ 'Content-Type':'application/json', ...this.hdr() }, body: JSON.stringify(body)}); return r.json(); },
  async csv(path, filename){
    const r=await fetch(this.base+path, { headers: { ...this.hdr() }});
    if(!r.ok){ const t=await r.text(); alert('CSV error: '+t); return; }
    const blob=await r.blob();
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href);
  }
};

function fmtWhen(s){ try{ return new Date(s).toLocaleString(); }catch{ return s; } }
function whyChips(list){ return (list||[]).map(w => '<span class="chip">'+w.label+' <span class="muted small">'+(w.detail||'')+'</span></span>').join(' '); }
function tempChip(t){ const cls = t==='hot'?'chip hot':(t==='warm'?'chip warm':'chip'); return '<span class="'+cls+'">'+t+'</span>'; }

async function loadList(kind='hot'){
  const data = await api.jget('/api/v1/leads/'+kind+'?limit=50');
  const rows = (data.items||[]).map(item => {
    return \`<tr data-id="\${item.id}">
      <td><a href="#" class="open" data-id="\${item.id}">\${item.id}</a></td>
      <td>\${item.host||''}</td>
      <td>\${item.platform||''}</td>
      <td>\${item.title||''}</td>
      <td class="small muted">\${fmtWhen(item.created_at)}</td>
      <td>\${tempChip(item.temperature||kind)}</td>
      <td>\${whyChips(item.why)}</td>
      <td><button data-id="\${item.id}" class="open">Open</button></td>
    </tr>\`;
  }).join('');
  $('#leadsTbody').innerHTML = rows || '<tr><td colspan="8" class="muted">No items</td></tr>';
}

async function openLead(id){
  const data = await api.jget('/api/v1/leads/'+id);
  const lead = data.lead || data; // endpoint returns { ok, lead, why } OR { ok, temperature, lead, why }
  const why = data.why || lead.why || [];
  const block = \`
    <div class="stack">
      <div><b>#\${lead.id}</b> — \${lead.title||''}</div>
      <div class="small muted">\${lead.host||''} • \${lead.platform||''} • \${fmtWhen(lead.created_at)}</div>
      <div>\${tempChip((lead.temperature)||data.temperature||'')}</div>
      <div>\${whyChips(why)}</div>
      <div class="sep"></div>
      <label>Stage</label>
      <div class="actions">
        <select id="stageSel">
          <option value="new">new</option>
          <option value="qualified">qualified</option>
          <option value="contacted">contacted</option>
          <option value="proposal">proposal</option>
          <option value="won">won</option>
          <option value="lost">lost</option>
        </select>
        <button id="saveStage" class="primary">Save</button>
      </div>
      <label>Note</label>
      <textarea id="noteTxt" rows="3" placeholder="Add a note…"></textarea>
      <div class="actions">
        <button id="saveNote">Add note</button>
        <button id="reveal" title="Re-run reveal scoring (GET /reveal/:id)">Reveal</button>
      </div>
      <div class="sep"></div>
      <div class="small muted">Requires API key for stage/note.</div>
    </div>\`;
  $('#details').innerHTML = block;

  $('#saveStage').onclick = async () => {
    const k = api.key(); if(!k){ alert('Set API key first'); return; }
    const body = { stage: ($('#stageSel') as any).value };
    const r = await api.jpatch('/api/v1/leads/'+id+'/stage', body);
    alert(JSON.stringify(r));
  };
  $('#saveNote').onclick = async () => {
    const k = api.key(); if(!k){ alert('Set API key first'); return; }
    const note = ($('#noteTxt') as any).value.trim();
    if(!note){ alert('Write a note first'); return; }
    const r = await api.jpost('/api/v1/leads/'+id+'/notes', { note });
    alert(JSON.stringify(r));
    ($('#noteTxt') as any).value='';
  };
  $('#reveal').onclick = async () => {
    const r = await api.jget('/api/v1/reveal/'+id);
    alert(JSON.stringify(r));
  };
}

async function ingestOne(){
  const body = {
    cat: ($('#ingCat') as any).value.trim() || 'product',
    kw: ($('#ingKw') as any).value.split(',').map(s=>s.trim()).filter(Boolean),
    platform: ($('#ingPlatform') as any).value.trim() || 'shopify',
    source_url: ($('#ingUrl') as any).value.trim(),
    title: ($('#ingTitle') as any).value.trim()
  };
  if(!body.source_url || !body.title){ alert('source_url and title are required'); return; }
  const r = await api.jpost('/api/v1/leads/ingest', body);
  alert(JSON.stringify(r));
  await loadList('hot');
}

function hookTableClicks(){
  $('#leadsTbody').addEventListener('click', (e)=>{
    const t = e.target as HTMLElement;
    const btn = t.closest('button.open') as HTMLButtonElement;
    const link = t.closest('a.open') as HTMLAnchorElement;
    const id = (btn?.dataset.id) || (link?.dataset.id);
    if(id){ e.preventDefault(); openLead(id); }
  });
}

function wire() {
  // key
  const saved = api.key(); if(saved) $('#apiKey').value = saved;
  $('#saveKey').onclick = ()=>{ api.setKey(($('#apiKey') as any).value.trim()); alert('Saved'); };
  $('#logout').onclick = ()=>{ localStorage.removeItem('API_KEY'); ($('#apiKey') as any).value=''; alert('Cleared'); };

  // lists
  $('#refreshHot').onclick = ()=> loadList('hot');
  $('#refreshWarm').onclick = ()=> loadList('warm');

  // ingest
  $('#ingSubmit').onclick = ingestOne;

  // CSV
  $('#dlHot').onclick = ()=> api.csv('/api/v1/leads/export.csv?temperature=hot&limit=100', 'leads_hot.csv');
  $('#dlWarm').onclick = ()=> api.csv('/api/v1/leads/export.csv?temperature=warm&limit=100', 'leads_warm.csv');

  // shortcuts
  window.addEventListener('keydown', (ev)=>{ if(ev.key==='r' || ev.key==='R'){ loadList('hot'); }});

  hookTableClicks();
  loadList('hot');
}
document.addEventListener('DOMContentLoaded', wire);
</script>
</body>
</html>`;

    res.status(200).send(html);
  });

  app.use(router);
}
