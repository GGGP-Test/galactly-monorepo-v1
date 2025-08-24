/* Galactly Live Pool — minimal, self-contained, design-safe injector
</div>
</article>
`);
const tip = qs('.gltly-tip', c);
const why = qs('.gltly-why', c);
const reasons = explainFor(item);
tip.innerHTML = `<h4>Why this?</h4>
<p>${reasons.map(r=>escapeHtml(r)).join(' • ')}</p>
<p><a href="${item.url}" target="_blank" rel="noopener">Open original source ↗</a></p>`;
let open=false;
why.addEventListener('click', (e)=>{ e.stopPropagation(); open=!open; tip.style.display=open?'block':'none'; });
document.addEventListener('click', ()=>{ open=false; tip.style.display='none'; });
return c;
}


function escapeHtml(s){ return String(s).replace(/[&<>\"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }


// Merge & dedupe by URL (without query/hash)
function normalizeUrl(u){ try{ const x=new URL(u); x.hash=''; x.search=''; return x.toString(); }catch{ return u; } }
function dedupe(items){ const seen=new Set(); const out=[]; for(const it of items){ const k=normalizeUrl(it.url); if(!seen.has(k)){ seen.add(k); out.push(it); } } return out; }


// Presence: ping /status occasionally; show humansOnline if backend returns it on /leads
function heartbeat(){ if(!API_BASE) return; fetch(API_BASE+"/api/v1/status").catch(()=>{}); }
setInterval(heartbeat, 25_000); heartbeat();


async function fetchLeads(){
if(!API_BASE) return {items:[], humansOnline:undefined};
// Preferred: /leads (server may aggregate + include humansOnline)
try{
const r = await fetch(API_BASE+"/api/v1/leads?limit=24");
if(r.ok){ const j = await r.json(); return {items:(j.items||[]), humansOnline:j.humansOnline}; }
}catch{}
// Fallback: a single CSE pass via /peek with a precision query
try{
const q = encodeURIComponent("(packaging OR pouch OR carton OR label OR laminat* OR corrugated) (rfp OR rfq OR tender OR buyer OR sourcing OR procurement OR vendor)");
const r = await fetch(API_BASE+`/api/v1/peek?q=${q}&type=web&limit=10`);
if(r.ok){ const j = await r.json(); return {items:(j.items||[])}; }
}catch{}
return {items:[]};
}


function render(items){
grid.innerHTML='';
const clean = dedupe(items.filter(x=>x && x.title && x.url && !isBad(x.url)));
if(!clean.length){ grid.appendChild(h(`<div class="gltly-empty"><small>No hot leads right now. Keep this tab open — we update continuously.</small></div>`)); return; }
for(const it of clean){ grid.appendChild(card(it)); }
}


async function tick(){
try{
const {items, humansOnline} = await fetchLeads();
render(items||[]);
if(typeof humansOnline === 'number') pres.textContent = `Users online: ${humansOnline}`;
const presHeader = document.getElementById('presence-pill');
if(presHeader && typeof humansOnline === 'number') presHeader.textContent = `Users online: ${humansOnline}`;
}catch(e){ console.warn('[pool]', e); }
}


tick();
setInterval(tick, 20_000);
})();
