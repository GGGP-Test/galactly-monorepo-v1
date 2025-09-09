import express from 'express';

export function mountPublic(app: express.Express){
  const r = express.Router();

  // simple ping
  r.get('/ping', (_req, res) => {
    res.json({ ok:true, pong:true, time: new Date().toISOString() });
  });

  // lightweight web panel (same origin; uses the API you already have)
  r.get('/panel', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Galactly Leads</title>
<style>
  :root{font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;}
  body{margin:24px;max-width:1100px}
  h1{margin:0 0 8px}
  .row{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin:12px 0}
  input,button,select,textarea{font:inherit;padding:8px;border:1px solid #ccc;border-radius:8px}
  button{cursor:pointer}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .card{border:1px solid #e5e7eb;border-radius:12px;padding:12px}
  .pill{display:inline-block;border-radius:999px;padding:2px 8px;border:1px solid #ddd;margin-left:8px}
  .hot{background:#ffe7e7}
  .warm{background:#fff5d6}
  pre{white-space:pre-wrap;word-wrap:break-word}
  .muted{color:#6b7280}
</style>
</head>
<body>
  <h1>Galactly Leads <span id="env" class="pill muted"></span></h1>

  <div class="row">
    <label>API key (for stage/notes/ingest):
      <input id="apiKey" placeholder="paste token…" size="44" />
    </label>
    <button id="refresh">Refresh lists</button>
    <a id="csvHot" target="_blank" class="pill">Export HOT CSV</a>
    <a id="csvWarm" target="_blank" class="pill">Export WARM CSV</a>
  </div>

  <div class="cols">
    <div class="card">
      <h3>🔥 Hot</h3>
      <div id="hot"></div>
    </div>
    <div class="card">
      <h3>🌤️ Warm</h3>
      <div id="warm"></div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <h3>Lead details / actions</h3>
    <div id="leadBox" class="muted">Select a lead…</div>

    <div class="row">
      <label>Lead ID <input id="leadId" size="8" /></label>
      <label>Stage
        <select id="stageSel">
          <option value="new">new</option>
          <option value="qualified">qualified</option>
          <option value="contacted">contacted</option>
          <option value="booked">booked</option>
          <option value="won">won</option>
          <option value="lost">lost</option>
        </select>
      </label>
      <button id="btnStage">Set stage</button>
      <label class="muted">Note <input id="noteTxt" size="36" placeholder="add a note…" /></label>
      <button id="btnNote">Add note</button>
    </div>

    <details>
      <summary>Manual ingest (one)</summary>
      <div class="row">
        <input id="ingCat" value="product" placeholder="cat"/>
        <input id="ingKw"  value="labels,rfq" placeholder="kw comma list"/>
        <input id="ingPlat" value="shopify" placeholder="platform"/>
        <input id="ingUrl"  value="https://brand-x.com/rfq/labels" placeholder="source_url" size="40"/>
        <input id="ingTitle" value="RFQ: label refresh" placeholder="title" size="32"/>
        <button id="btnIngest">Ingest</button>
      </div>
    </details>
  </div>

<script>
const $ = sel => document.querySelector(sel);
const api = (p, opt={}) => fetch(p, opt).then(r => r.ok ? r : r.text().then(t => { throw new Error(t||r.statusText)})).then(r => r.headers.get('content-type')?.includes('application/json') ? r.json() : r.text());

const envEl = $('#env');
const apiKeyEl = $('#apiKey');
const hotEl = $('#hot'), warmEl = $('#warm');
const leadBox = $('#leadBox');
const leadIdEl = $('#leadId');
const stageSel = $('#stageSel');
const noteTxt = $('#noteTxt');

function card(it){
  const why = (it.why||[]).map(w => \`\${w.label}: \${w.detail} (\${w.score})\`).join(' • ');
  return \`
    <div style="padding:8px;border-bottom:1px solid #eee">
      <div><b>#\${it.id}</b> — \${it.title||''} <span class="pill \${it.temperature}">\${it.temperature}</span></div>
      <div class="muted">\${it.platform||''} • \${it.cat||''} • \${it.host||''}</div>
      <div class="muted" style="font-size:12px">\${why}</div>
      <div style="margin-top:6px"><button data-id="\${it.id}" class="open">Open</button></div>
    </div>\`;
}

async function refresh(){
  envEl.textContent = (await api('/api/v1/config')).env || 'production';
  $('#csvHot').href  = '/api/v1/leads/export.csv?temperature=hot&limit=100';
  $('#csvWarm').href = '/api/v1/leads/export.csv?temperature=warm&limit=100';

  const hot = await api('/api/v1/leads/hot?limit=20');
  const warm = await api('/api/v1/leads/warm?limit=20');
  hotEl.innerHTML = (hot.items||[]).map(card).join('') || '<div class="muted">none</div>';
  warmEl.innerHTML = (warm.items||[]).map(card).join('') || '<div class="muted">none</div>';
  hotEl.querySelectorAll('.open').forEach(b => b.onclick = () => openLead(b.dataset.id));
  warmEl.querySelectorAll('.open').forEach(b => b.onclick = () => openLead(b.dataset.id));
}

async function openLead(id){
  const data = await api('/api/v1/leads/'+id);
  leadIdEl.value = id;
  const why = (data.why||[]).map(w => \`<li>\${w.label} — \${w.detail} (\${w.score})</li>\`).join('');
  leadBox.innerHTML = \`
    <div><b>#\${data.lead.id}</b> \${data.lead.title||''} <span class="pill \${data.temperature}">\${data.temperature}</span></div>
    <div class="muted">\${data.lead.platform||''} • \${data.lead.cat||''} • \${data.lead.host||''}</div>
    <ul>\${why}</ul>
  \`;
}

$('#refresh').onclick = refresh;

$('#btnStage').onclick = async ()=>{
  const key = apiKeyEl.value.trim();
  if(!key) return alert('paste API key first');
  const id = leadIdEl.value.trim();
  const body = JSON.stringify({ stage: stageSel.value });
  const r = await api('/api/v1/leads/'+id+'/stage', { method:'PATCH', headers:{'Content-Type':'application/json','x-api-key':key}, body });
  alert('Stage updated: '+JSON.stringify(r));
};

$('#btnNote').onclick = async ()=>{
  const key = apiKeyEl.value.trim();
  if(!key) return alert('paste API key first');
  const id = leadIdEl.value.trim();
  const body = JSON.stringify({ note: noteTxt.value });
  const r = await api('/api/v1/leads/'+id+'/notes', { method:'POST', headers:{'Content-Type':'application/json','x-api-key':key}, body });
  noteTxt.value = '';
  alert('Note saved: '+JSON.stringify(r));
};

$('#btnIngest').onclick = async ()=>{
  const key = apiKeyEl.value.trim();
  if(!key) return alert('paste API key first');
  const b = {
    cat: $('#ingCat').value, 
    kw: $('#ingKw').value.split(',').map(s=>s.trim()).filter(Boolean),
    platform: $('#ingPlat').value,
    source_url: $('#ingUrl').value,
    title: $('#ingTitle').value
  };
  const r = await api('/api/v1/leads/ingest', { method:'POST', headers:{'Content-Type':'application/json','x-api-key':key}, body: JSON.stringify(b) });
  alert('Ingested: '+JSON.stringify(r.lead||r));
  refresh();
};

refresh();
</script>
</body></html>`);
  });

  app.use('/api/v1/public', r);
}
