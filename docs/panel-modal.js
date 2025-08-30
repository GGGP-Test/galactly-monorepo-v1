/* docs/panel-modal.js
 * Onboarding modal + feed helpers for free-panel.html
 * - Two paths: (A) Vendor website only  (B) Custom ICP (buyers/industries/regions)
 * - Calls /api/v1/find-now then refreshes the feed
 * - De-duplicates & interleaves platforms in the UI to avoid repetition fatigue
 * - “Confirm Proof” button for ad proof links (logs /events confirm_ad)
 * - Per-user session id is persisted in localStorage (x-galactly-user)
 */

(function(){
  // ------- session & API helpers -------
  const uidKey='galactly_uid';
  let UID=localStorage.getItem(uidKey); if(!UID){ UID='u-'+Math.random().toString(36).slice(2); localStorage.setItem(uidKey,UID); }

  // API base: prefer window.API_BASE (from api-base.js). Fallback to localStorage('api_base') or input#apiBase if present.
  function apiBase(){
    if (typeof window.API_BASE === 'string' && window.API_BASE) return window.API_BASE;
    const saved = localStorage.getItem('api_base') || '';
    if (saved) return saved.replace(/\/$/,'');
    const input = document.querySelector('#apiBase');
    if (input && input.value) return String(input.value).trim().replace(/\/$/,'');
    return location.origin; // last resort (same origin)
  }
  function API(path){ return apiBase() + path; }

  async function get(path){
    const r = await fetch(API(path), { headers: { 'x-galactly-user': UID } });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  }
  async function post(path, body){
    const r = await fetch(API(path), {
      method: 'POST',
      headers: { 'content-type':'application/json', 'x-galactly-user': UID },
      body: JSON.stringify(body||{})
    });
    if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
    return r.json();
  }

  // ------- tiny utils -------
  const $ = (sel, root=document)=> root.querySelector(sel);
  const $$ = (sel, root=document)=> Array.from(root.querySelectorAll(sel));
  const elFeed = document.getElementById('feed') || (()=>{ const d=document.createElement('div'); d.id='feed'; d.className='grid'; document.body.appendChild(d); return d; })();

  function esc(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function hostOf(u){ try{ return new URL(u).hostname; }catch{ return ''; } }
  function uniq(arr){ return Array.from(new Set(arr)); }
  function normHost(s){ if(!s) return ''; let h = String(s).trim().toLowerCase(); h = h.replace(/^https?:\/\//,'').replace(/\/.*$/,''); return h; }

  // ------- modal builder -------
  function buildModal(){
    const wrap = document.createElement('div');
    wrap.id = 'onboard-modal';
    wrap.style.cssText = `
      position:fixed; inset:0; background:rgba(10,12,16,.75); backdrop-filter:saturate(140%) blur(8px);
      display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px;
    `;
    wrap.innerHTML = `
      <div style="width:min(860px,96vw); background:#0e1421; border:1px solid #1f2a3b; border-radius:14px; padding:18px 18px 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">
          <div style="font-weight:700; font-size:18px;">Find Buyers Now</div>
          <button id="ob-close" style="background:#1e2a3b;border:1px solid #2a3b55;color:#e8ecf1;padding:6px 10px;border-radius:10px;cursor:pointer">Close</button>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:12px;">
          <button id="tab-auto" class="tab is-active">Auto (Vendor Website)</button>
          <button id="tab-custom" class="tab">Custom (ICP)</button>
          <style>
            .tab{background:#111725;border:1px solid #2a3b55;color:#e8ecf1;padding:6px 10px;border-radius:10px;cursor:pointer}
            .tab.is-active{background:#1e2a3b}
            .row{display:grid;grid-template-columns:160px 1fr;gap:10px;align-items:center;margin:8px 0}
            .hint{opacity:.75;font-size:12px}
            input,textarea{width:100%;background:#0b101a;color:#e8ecf1;border:1px solid #2a3b55;border-radius:10px;padding:8px}
            textarea{min-height:74px}
            .pill{display:inline-block;border:1px solid #2a3b55;border-radius:999px;padding:2px 8px;margin-left:6px;font-size:12px;opacity:.8}
            .cta{background:#3564ff;border:1px solid #3b6bff;color:white;padding:8px 12px;border-radius:10px;cursor:pointer}
            .cta[disabled]{opacity:.6;cursor:default}
            .bar{display:flex;gap:10px;align-items:center;margin-top:12px}
            .ok{color:#9ad} .bad{color:#f88}
          </style>
        </div>

        <div id="auto-pane">
          <div class="row"><label>Vendor Website</label><input id="ob-vendor" placeholder="e.g. acme-gummies.com"/></div>
          <div class="row"><label>Region(s)</label><input id="ob-regions" placeholder="US, CA"/></div>
          <div class="row"><div></div><div class="hint">We’ll infer industries & sample buyers directly from the site (collections, careers, press, meta tags).</div></div>
        </div>

        <div id="custom-pane" style="display:none;">
          <div class="row"><label>Industries</label><input id="ob-industries" placeholder="beverage, confectionery"/></div>
          <div class="row"><label>Region(s)</label><input id="ob-cregions" placeholder="US, CA"/></div>
          <div class="row"><label>Example Buyers</label><textarea id="ob-buyers" placeholder="one per line or comma-separated…"></textarea></div>
          <div class="row"><div></div><div class="hint">Tip: paste 5–10 brands you’d love to sell to. We’ll expand & verify activity.</div></div>
        </div>

        <div class="bar">
          <button id="ob-run" class="cta">Run Finder</button>
          <span id="ob-status" class="hint">Idle</span>
          <span class="pill">user: <span id="ob-uid"></span></span>
          <span class="pill">api: <span id="ob-api"></span></span>
        </div>
      </div>
    `;

    // wire tabs
    const autoBtn = $('#tab-auto', wrap);
    const custBtn = $('#tab-custom', wrap);
    const autoPane = $('#auto-pane', wrap);
    const custPane = $('#custom-pane', wrap);
    autoBtn.onclick = ()=>{ autoBtn.classList.add('is-active'); custBtn.classList.remove('is-active'); autoPane.style.display='block'; custPane.style.display='none'; };
    custBtn.onclick = ()=>{ custBtn.classList.add('is-active'); autoBtn.classList.remove('is-active'); custPane.style.display='block'; autoPane.style.display='none'; };

    // close
    $('#ob-close', wrap).onclick=()=> document.body.removeChild(wrap);

    // fill badges
    $('#ob-uid', wrap).textContent = UID;
    $('#ob-api', wrap).textContent = apiBase();

    // run
    $('#ob-run', wrap).onclick = async ()=>{
      const status = $('#ob-status', wrap);
      const btn = $('#ob-run', wrap);
      btn.disabled = true; status.textContent = 'Running…';

      try{
        let body = {};
        if (autoPane.style.display !== 'none'){  // Auto
          const vendor = String($('#ob-vendor', wrap).value||'').trim();
          const regions = String($('#ob-regions', wrap).value||'').trim();
          if (!vendor){ throw new Error('Vendor website is required.'); }
          body = { vendorDomain: vendor, regions: splitCSV(regions) };
        } else { // Custom
          const industries = String($('#ob-industries', wrap).value||'').trim();
          const regions = String($('#ob-cregions', wrap).value||'').trim();
          const buyers = String($('#ob-buyers', wrap).value||'').trim();
          const buyersList = dedupeDomains(splitCSVLines(buyers));
          if (!buyersList.length && !industries){ throw new Error('Fill buyers or industries.'); }
          body = { buyers: buyersList, industries: splitCSV(industries), regions: splitCSV(regions) };
        }

        const t0 = Date.now();
        const out = await post('/api/v1/find-now', body);
        status.innerHTML = `<span class="ok">OK</span> checked=${out.checked||0} • created=${out.created||0} • ${(out.tookMs||Date.now()-t0)}ms`;
        // refresh feed once
        setTimeout(fetchLeads, 800);
      }catch(e){
        status.innerHTML = `<span class="bad">Error:</span> ${esc(String(e.message||e))}`;
      }finally{
        btn.disabled = false;
      }
    };

    return wrap;
  }

  function splitCSV(s){ return (s||'').split(/[,\s]+/g).map(x=>x.trim()).filter(Boolean); }
  function splitCSVLines(s){
    return (s||'').split(/[\n,]+/g).map(x=>x.trim()).filter(Boolean);
  }
  function dedupeDomains(list){
    return uniq(list.map(normHost).filter(Boolean));
  }

  // ------- public open function & header button -------
  function ensureHeaderButton(){
    let hdr = document.querySelector('header');
    if (!hdr){
      hdr = document.createElement('header');
      hdr.style.cssText='padding:16px 20px;border-bottom:1px solid #1e2430;display:flex;justify-content:space-between;align-items:center';
      hdr.innerHTML = `<div><strong>Galactly</strong> <span class="pill" id="status">ready</span></div><div><button id="open-ob" class="cta">Find Buyers</button></div>`;
      document.body.prepend(hdr);
    } else {
      const right = hdr.querySelector('#open-ob') || (()=>{
        const btn = document.createElement('button');
        btn.id='open-ob'; btn.className='cta';
        btn.textContent='Find Buyers';
        hdr.appendChild(btn);
        return btn;
      })();
    }
    $('#open-ob').onclick = showOnboarding;
  }

  function showOnboarding(){
    const m = buildModal();
    document.body.appendChild(m);
  }

  // ------- feed fetching & rendering with platform de-dup/interleave -------
  let lastData=null;
  async function fetchLeads(){
    try{
      const r = await get('/api/v1/leads');
      lastData = r;
      render();
      const secs = Number(r.nextRefreshSec||15);
      setTimeout(fetchLeads, Math.max(5, secs)*1000);
      const status = document.getElementById('status'); if (status) status.textContent='ok';
    }catch(e){
      const status = document.getElementById('status'); if (status) status.textContent='error';
      setTimeout(fetchLeads, 6000);
    }
  }

  function interleaveByPlatform(leads){
    // Bucket by platform
    const buckets = {};
    for (const L of leads){
      const p = (L.platform||'other').toLowerCase();
      if(!buckets[p]) buckets[p]=[];
      buckets[p].push(L);
    }
    // Round-robin across platforms so consecutive cards are mixed
    const keys = Object.keys(buckets).sort(); // stable order
    const out = [];
    let added = true;
    while (added){
      added = false;
      for (const k of keys){
        if (buckets[k].length){
          out.push(buckets[k].shift());
          added = true;
        }
      }
    }
    return out;
  }

  function render(){
    if (!lastData || !Array.isArray(lastData.leads)) return;
    // De-dupe by (platform + URL) and by host repetition burst
    const seen = new Set();
    const compact = [];
    for (const L of lastData.leads){
      const key = (L.platform||'?') + '|' + (L.source_url||'');
      if (seen.has(key)) continue;
      seen.add(key);
      compact.push(L);
    }
    const mixed = interleaveByPlatform(compact);
    elFeed.innerHTML = '';
    mixed.forEach(L => elFeed.appendChild(card(L)));
  }

  function card(lead){
    const d = document.createElement('div');
    d.className='card';
    const host = hostOf(lead.source_url);
    d.innerHTML = `
      <div class="meta">${esc(lead.platform||'source')} • ${esc(host)}</div>
      <div><strong>${esc(lead.title||'Untitled')}</strong></div>
      <div>${esc(lead.snippet||'')}</div>
      <div class="btns">
        <button data-a="open">Open</button>
        ${lead.platform==='adlib_free' ? '<button data-a="confirm">Confirm Proof</button>' : ''}
        <button data-a="claim">Claim</button>
        <button data-a="own">Own</button>
        <button data-a="mute">Mute</button>
        <span class="meta" data-a="left"></span>
      </div>
    `;
    $('[data-a=open]', d).onclick = ()=> { logEvent('click', lead, {url:lead.source_url}); window.open(lead.source_url,'_blank','noopener'); };
    if ($('[data-a=confirm]', d)){
      $('[data-a=confirm]', d).onclick = async ()=>{
        await logEvent('confirm_ad', lead, { url: lead.source_url, platform: lead.platform||'adlib_free' });
        // soft visual feedback
        $('[data-a=confirm]', d).textContent = 'Confirmed';
        $('[data-a=confirm]', d).disabled = true;
      };
    }
    $('[data-a=claim]', d).onclick = ()=> claimLead(lead, d);
    $('[data-a=own]', d).onclick = ()=> ownLead(lead, d);
    $('[data-a=mute]', d).onclick = ()=> {
      logEvent('mute_domain', lead, { domain: host });
      d.style.opacity = '.4';
    };
    return d;
  }

  async function logEvent(type, lead, meta){
    try{ await post('/api/v1/events', { type, leadId: lead.id, meta: meta||{} }); }catch{}
  }
  async function claimLead(lead, cardEl){
    try{
      const r = await post('/api/v1/claim', { leadId: lead.id });
      if (r?.ok){ lead._windowId = r.windowId; lead._exp = Date.now() + (r.reservedForSec||120)*1000; tick(cardEl, lead); }
    }catch{}
  }
  async function ownLead(lead, cardEl){
    if (!lead._windowId) return;
    try{
      const r = await post('/api/v1/own', { windowId: lead._windowId });
      if (r?.ok){ logEvent('own', lead); $('[data-a=left]', cardEl).textContent = 'owned'; }
    }catch{}
  }
  function tick(cardEl, lead){
    const span = $('[data-a=left]', cardEl);
    function update(){
      if (!lead._exp) return;
      const s = Math.max(0, Math.ceil((lead._exp - Date.now())/1000));
      span.textContent = s>0 ? `reserved ${s}s` : '';
      if (s>0) requestAnimationFrame(update);
    }
    update();
  }

  // expose minimal API for other scripts (optional)
  window.GalactlyPanel = {
    openOnboarding: showOnboarding,
    refresh: fetchLeads
  };

  // boot
  ensureHeaderButton();
  fetchLeads();

  // optionally auto-open onboarding when feed is empty on first load
  setTimeout(async ()=>{
    try{
      const peek = await get('/api/v1/leads');
      if (Array.isArray(peek.leads) && peek.leads.filter(x=>x.id>0).length===0){
        showOnboarding();
      }
    }catch{}
  }, 800);
})();
