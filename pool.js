// Small helper used by index.html to show humans online in the footer strip
(async function(){
const el = document.querySelector('#humansOnline');
if(!el) return;
async function run(){
try{
const r = await fetch('/api/v1/leads?limit=0');
const j = await r.json().catch(()=>({}));
if(j && j.humansOnline!=null) el.textContent = j.humansOnline;
}catch{ /* ignore */ }
}
run(); setInterval(run, 15000);
})();
