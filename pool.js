/* Galactly Live Pool — minimal, self-contained, design-safe injector
* - Appends a live leads list to #live-pool (or creates it at end of <body>)
* - Polls your API: /api/v1/leads (preferred) or /api/v1/peek fallback
* - Shows platform tags; hides generic/boring sources; small explain icon per lead
* - Light presence ping; if backend returns humansOnline, we show it
*/
(function(){
const API_BASE = (window.API_BASE || localStorage.getItem('apiBase') || '').replace(/\/+$/,'');
if(!API_BASE){ console.warn('[pool] window.API_BASE not set'); }


// Gentle CSS, scoped to .gltly-pool only
const css = `
.gltly-pool{color:#fff}
.gltly-pool .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.gltly-card{background:linear-gradient(180deg,#0b1025,#0a0f1f);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px 12px 10px;position:relative}
.gltly-card a.title{color:#86f7d6;font-weight:600;line-height:1.35;display:block;margin-bottom:6px;text-decoration:none}
.gltly-card small{color:#a5afc1}
.gltly-row{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-top:8px}
.gltly-tags{display:flex;gap:6px;flex-wrap:wrap}
.gltly-tag{font-size:12px;color:#a5afc1;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 8px}
.gltly-empty{opacity:.9;background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.12);border-radius:12px;padding:14px}
.gltly-top{display:flex;align-items:center;justify-content:space-between;margin:12px 0 14px}
.gltly-top h3{margin:0;font-size:18px}
.gltly-pres{font-size:13px;color:#a5afc1}
.gltly-cta{margin-top:8px;display:inline-block;color:#0b0f1f;background:#86f7d6;border-radius:10px;padding:6px 10px;font-weight:600;text-decoration:none}
.gltly-why{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;border:1px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;cursor:pointer}
.gltly-why:hover{background:rgba(255,255,255,.06)}
.gltly-tip{position:absolute;right:12px;top:38px;z-index:9;max-width:360px;background:#0c1022;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
.gltly-tip h4{margin:0 0 6px;font-size:14px}
.gltly-tip p{margin:0 0 8px;color:#a5afc1;font-size:13px}
`;
const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);


function qs(s, p=document){ return p.querySelector(s); }
function qsa(s, p=document){ return Array.from(p.querySelectorAll(s)); }
function h(html){ const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }


// Create mount if missing
let mount = qs('#live-pool');
if(!mount){ mount = document.createElement('div'); mount.id = 'live-pool'; document.body.appendChild(mount); }


// Container
const root = h(`
<section class="gltly-pool">
<div class="gltly-top">
<h3>🔥 Live packaging leads</h3>
<div class="gltly-pres" id="gltly-pres">&nbsp;</div>
</div>
<div class="grid" id="gltly-grid"></div>
</section>
`);
mount.appendChild(root);
const grid = qs('#gltly-grid', root);
const pres = qs('#gltly-pres', root);


// Domain filters — ditch boring, low-intent, or directory noise
const BAD_DOMAINS = [
/(^|\.)sam\.gov$/i, /(^|\.)beta\.sam\.gov$/i, /(^|\.)fbo\.gov$/i,
/(^|\.)yellowpages\./i, /(^|\.)yelp\./i, /(^|\.)angi\./i, /(^|\.)thumbtack\./i,
/(^|\.)pinterest\./i, /(^|\.)facebook\./i, /(^|\.)instagram\./i,
/(^|\.)mapquest\./i, /(^|\.)indeed\./i, /(^|\.)glassdoor\./i,
/(^|\.)upwork\./i, /(^|\.)fiverr\./i
];
})();
