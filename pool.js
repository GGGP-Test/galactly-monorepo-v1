(function(){
async function fetchAll(base,q,limit){
const types = ($('#type')?.value||'all') === 'all' ? CONFIG.fanOutTypes : [ $('#type')?.value || 'web' ];
const tasks = types.map((t,i)=> new Promise(res=> setTimeout(res, i*180)).then(()=>peekOne(base,q,t,Math.min(10,limit))));
const groups = await Promise.allSettled(tasks);
let all = [];
for(const g of groups){ if(g.status==='fulfilled') all = all.concat(g.value); }
all = dedupe(all);
// score + filter hot
const enriched = all.map(it=>{ const r=scoreAndWhy(it); return {...it, __score:r.score, __why:r.why}; });
const hot = enriched.filter(it=> it.__score >= 7).sort((a,b)=> b.__score - a.__score);
return hot.slice(0, limit);
}


// Render into #lead-pool
async function runOnce(){
const base = apiBase(); if(!base){ console.warn('[pool] Missing API_BASE'); return; }
const limit = parseInt($('#limit')?.value||CONFIG.limit, 10) || CONFIG.limit;
const q = ($('#q')?.value?.trim()) || CONFIG.defaultQuery;


const listHost = $('#lead-pool');
if (!listHost) return;
// Provide an inner UL if you don’t already have one
let ul = listHost.querySelector('ul');
if(!ul){ ul = document.createElement('ul'); ul.style.cssText='list-style:none;padding:0;margin:18px 0'; listHost.appendChild(ul); }


ul.innerHTML = '<li style="opacity:.8">Fetching fresh leads…</li>';
try {
const items = await fetchAll(base,q,limit);
ul.innerHTML = '';
if(!items.length){
const li=document.createElement('li'); li.style.cssText='opacity:.8'; li.textContent = 'No hot items. AI filters generic portals.'; ul.appendChild(li); return;
}
for(const it of items){ const li = makeItem(it); if(li) ul.appendChild(li); }
} catch (e){
ul.innerHTML = `<li style="opacity:.8">Error: ${escapeHtml(e.message||e)}</li>`;
}
}


function bindUI(){
$('#search')?.addEventListener('click', runOnce);
// Optional: Enter to search
$('#q')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ runOnce(); }});
}


function start(){
bindUI();
runOnce();
setInterval(runOnce, CONFIG.refreshMs);
}


// Kickoff when DOM ready
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
