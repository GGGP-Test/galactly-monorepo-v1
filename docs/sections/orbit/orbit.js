<!-- docs/sections/orbit/orbit.js -->
<script>
(()=>{
  const mount = document.getElementById('section-orbit');
  if(!mount) return;

  // personalize domain
  const host = (()=>{try{
    return (JSON.parse(localStorage.getItem('onb.seed')||'{}').host)||'yourcompany.com';
  }catch{ return 'yourcompany.com'; }})();

  // inject HTML (no panel box, just a stage like the reference)
  mount.innerHTML = `
    <section class="orbit-section" aria-label="Where your buyers light up">
      <div class="orbit-inner">
        <div class="orbit-hd">
          <h2>Where your buyers light up</h2>
          <div class="sub">Simple orbit map of the strongest intent signals for <span style="color:var(--gold-300)">${host}</span></div>
        </div>

        <div class="orbit-stage" id="orbitStage" style="position:relative">
          <canvas id="orbitFx" aria-hidden="true" style="position:absolute;inset:-10%"></canvas>

          <div class="orbit-ring r1"></div>
          <div class="orbit-ring r2"></div>
          <div class="orbit-ring r3"></div>
          <div class="orbit-ring r4"></div>

          <div class="orbit-center">
            <div class="orbit-core" aria-hidden="true"></div>
            <div class="orbit-domain" id="orbitDomain">${host}</div>
          </div>

          <button class="orbit-node" data-id="competition" data-size="l"><span>Competition</span></button>
          <button class="orbit-node" data-id="buyers"><span>Buyers</span></button>
          <button class="orbit-node" data-id="rfp"><span>RFPs &amp; Docs</span></button>
          <button class="orbit-node" data-id="buzz"><span>Market Buzz</span></button>
          <button class="orbit-node" data-id="hiring" data-size="s"><span>Hiring</span></button>
          <button class="orbit-node" data-id="heat" data-size="l"><span>Buyer&nbsp;Heat</span></button>

          <div class="orbit-card" id="orbitCard" role="dialog" aria-modal="false" aria-live="polite">
            <div class="kicker"><span>Signal</span><span id="cardTag">•</span></div>
            <h3 id="cardTitle">Title</h3>
            <ul id="cardList"></ul>
            <div class="heroMetric" id="cardHero"></div>
            <div class="fine" id="cardFine"></div>
          </div>
        </div>
      </div>
    </section>
  `;

  // --- hero-style aurora for Section 3 ---
  (function aurora(){
    const c = document.getElementById('orbitFx');
    if(!c) return;
    const noMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = c.getContext('2d');
    const DPR = Math.max(1, Math.min(2, devicePixelRatio||1));
    function size(){
      const s = document.getElementById('orbitStage');
      const r = s.getBoundingClientRect();
      c.width = Math.floor(r.width*DPR*1.2);
      c.height= Math.floor(r.height*DPR*1.2);
      c.style.width = Math.floor(r.width*1.2)+'px';
      c.style.height= Math.floor(r.height*1.2)+'px';
      ctx.setTransform(DPR,0,0,DPR,0,0);
    }
    size(); addEventListener('resize', size);
    let t=0;
    function draw(){
      if(!c.width) return;
      t+=0.0038;
      const w=c.width/DPR,h=c.height/DPR;
      ctx.clearRect(0,0,w,h);
      const g = ctx.createRadialGradient(w*0.45, h*0.25, h*0.05, w*0.5, h*0.5, h*0.8);
      g.addColorStop(0, 'rgba(250,225,150,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
      const blobs=[
        {x:.30+Math.sin(t*.9)*.05,y:.42+Math.cos(t*.8)*.04,r:.55,a:.18},
        {x:.72+Math.cos(t*.6)*.06,y:.60+Math.sin(t*.7)*.05,r:.60,a:.14}
      ];
      blobs.forEach(b=>{
        const rg=ctx.createRadialGradient(w*b.x,h*b.y,0,w*b.x,h*b.y,Math.min(w,h)*b.r);
        rg.addColorStop(0,`rgba(230,195,107,${b.a})`);
        rg.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=rg; ctx.beginPath();
        ctx.arc(w*b.x,h*b.y,Math.min(w,h)*b.r,0,Math.PI*2); ctx.fill();
      });
      if(!noMotion) requestAnimationFrame(draw);
    }
    draw();
  })();

  // --- metrics data (click to reveal) ---
  const DATA = {
    competition:{
      title:'Competition',
      bullets:['Top 5 domains gaining share','Overlap on “sustainable pouch”','New ads in last 7 days'],
      hero:'14 rival spikes this week',
      fine:'We surface competitors where your strengths overlap; ranked by overlap × velocity × volume.'
    },
    buyers:{
      title:'Buyers',
      bullets:['87 high-intent companies','ICP fit score ≥ 80','Fresh research & repeat visits'],
      hero:'87 hot buyers detected',
      fine:'Deduped companies enriched with firmographics and recency.'
    },
    rfp:{
      title:'RFPs & Docs',
      bullets:['Municipal & enterprise RFPs','Packaging guidelines found','PDFs/Docs crawled & parsed'],
      hero:'23 relevant RFPs',
      fine:'We watch public sources + your uploads and match to your capabilities.'
    },
    buzz:{
      title:'Market Buzz',
      bullets:['Trending: “compostable film”','3 new LinkedIn topic clusters','PR/news velocity spiking'],
      hero:'+32% buzz velocity',
      fine:'Topic growth combines news + social graph + search deltas.'
    },
    hiring:{
      title:'Hiring',
      bullets:['Packaging Engineer openings','Ops roles using your materials','Geos aligned with coverage'],
      hero:'19 hiring signals',
      fine:'Hiring is a classic leading indicator of near-term buying.'
    },
    heat:{
      title:'Buyer Heat',
      bullets:['Your site: deep scroll & repeat','Email replies & meetings set','Weighted intent score'],
      hero:'Score 92 / 100',
      fine:'Composite of recency × frequency × depth × identity confidence.'
    }
  };

  // --- layout + rotation ---
  const stage = document.getElementById('orbitStage');
  const nodes = [
    { id:'competition', ring:.82, size:'l' },
    { id:'buyers',      ring:.82, size:'m' },
    { id:'rfp',         ring:.64, size:'m' },
    { id:'buzz',        ring:.50, size:'m' },
    { id:'hiring',      ring:.38, size:'s' },
    { id:'heat',        ring:.28, size:'l' }
  ].map((n,i)=>({ ...n, el: stage.querySelector(`.orbit-node[data-id="${n.id}"]`), a0: i*(Math.PI*2/6) }));

  nodes.forEach(n=> n.el && (n.el.dataset.size=n.size));

  let angle=0, prev=0;
  const noMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function center(){ return { x: stage.clientWidth/2, y: stage.clientHeight/2, r: Math.min(stage.clientWidth,stage.clientHeight)/2 }; }
  let C = center();
  addEventListener('resize', ()=>{ C=center(); layout(0); });

  function layout(delta){
    angle = (angle + delta)%(Math.PI*2);
    nodes.forEach(n=>{
      if(!n.el) return;
      const a = n.a0 + angle;
      const radius = C.r * n.ring;
      const x = C.x + radius*Math.cos(a);
      const y = C.y + radius*Math.sin(a);
      n.el.style.left = x+'px';
      n.el.style.top  = y+'px';
      const depth = (Math.sin(a)+1)/2;
      n.el.style.opacity = (0.55 + 0.45*depth).toFixed(3);
      n.el.style.zIndex  = String(100 + Math.round(depth*50));
    });
  }
  function tick(now){
    if(!prev) prev=now;
    const dt = Math.min(33, now-prev); prev=now;
    layout(noMotion?0:dt*0.0035);
    if(!noMotion) requestAnimationFrame(tick);
  }
  layout(0); if(!noMotion) requestAnimationFrame(tick);

  // --- card wiring ---
  const card = document.getElementById('orbitCard');
  const fillCard = (id, at)=>{
    const d = DATA[id]; if(!d) return;
    card.querySelector('#cardTag').textContent = `• ${id}`;
    card.querySelector('#cardTitle').textContent = d.title;
    const ul = card.querySelector('#cardList'); ul.innerHTML='';
    d.bullets.forEach(s=>{ const li=document.createElement('li'); li.textContent=s; ul.appendChild(li); });
    card.querySelector('#cardHero').textContent = d.hero;
    card.querySelector('#cardFine').textContent = d.fine;
    // position near the node
    const r = stage.getBoundingClientRect();
    const x = at.left - r.left + at.width/2;
    const y = at.top  - r.top  - 18;
    card.style.left = `${x}px`;
    card.style.top  = `${y}px`;
    card.classList.add('show');
  };
  nodes.forEach(n=>{
    if(!n.el) return;
    n.el.addEventListener('click', (e)=>{
      e.stopPropagation();
      const at = n.el.getBoundingClientRect();
      fillCard(n.id, at);
    });
  });
  document.addEventListener('click', (e)=>{
    if(!card.contains(e.target)) card.classList.remove('show');
  });
})();
</script>