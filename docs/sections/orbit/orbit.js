/* Section 3: “Where your buyers light up”
   - Injects HTML into #section-orbit
   - Draws the hero-like aurora
   - Places nodes on a single circular orbit and rotates them
   - Click opens metric card with per-signal details
*/

(function(){
  const container = document.getElementById('section-orbit');
  if (!container) return;

  // ---------- HTML (kept out of index.html) ----------
  container.outerHTML = `
<section class="orbit-section" id="orbit" aria-label="Where your buyers light up">
  <canvas id="orbitFx" aria-hidden="true"></canvas>
  <div class="orbit-inner">
    <div class="orbit-hd">
      <h2>Where your buyers light up</h2>
      <div class="sub">Simple orbit map of the strongest intent signals for <span id="orbitHost" style="color:var(--gold-300)"></span></div>
    </div>

    <div class="orbit-stage" id="orbitStage">
      <div class="orbit-ring"></div>

      <div class="orbit-center">
        <div class="orbit-core" aria-hidden="true"></div>
        <div class="orbit-domain" id="orbitDomain">yourcompany.com</div>
      </div>

      <!-- nodes inserted by JS -->
    </div>

    <!-- single reusable card -->
    <div class="orbit-card" id="orbitCard" role="dialog" aria-modal="false" aria-live="polite">
      <div class="kicker"><span>Signal</span><span id="cardTag">•</span></div>
      <h3 id="cardTitle">Title</h3>
      <ul id="cardList"></ul>
      <div class="heroMetric" id="cardHero">Hero metric</div>
      <div class="fine" id="cardFine"></div>
    </div>
  </div>
</section>`;

  // Resolve fresh elements
  const section = document.getElementById('orbit');
  const stage   = document.getElementById('orbitStage');
  const card    = document.getElementById('orbitCard');
  const cardTag = document.getElementById('cardTag');
  const cardTitle = document.getElementById('cardTitle');
  const cardList  = document.getElementById('cardList');
  const cardHero  = document.getElementById('cardHero');
  const cardFine  = document.getElementById('cardFine');

  // ---------- Personalization ----------
  const LS = window.localStorage;
  let host = "yourcompany.com";
  try{
    const seed = JSON.parse(LS.getItem("onb.seed")||"{}");
    if (seed?.host) host = seed.host;
  }catch{}
  const hostOut = document.getElementById('orbitHost');
  const domain  = document.getElementById('orbitDomain');
  if (hostOut) hostOut.textContent = host;
  if (domain)  domain.textContent  = host;

  // ---------- Data ----------
  const signals = [
    { id:"competition", label:"Competition",  icon:iconTarget,
      hero:`8 active competitors tracked`,
      items:[`Top mover this week: NovaPack`,`Share-of-voice: 21%`, `New overlaps in 3 regions`],
      fine:`Mentions, ads, and overlap detections for ${host} (30 days)` },
    { id:"buyers", label:"Buyers", icon:iconUser,
      hero:`87 hot buyers this week`,
      items:[`Fit score ≥ 80: 26`, `Repeat visitors: 19`, `New ABM accounts: 12`],
      fine:`Verified company traffic correlated to ICP for ${host}` },
    { id:"rfp", label:"RFPs & Docs", icon:iconFile,
      hero:`41 open RFP-like docs`,
      items:[`Gov/edu portals: 13`, `Procurement PDFs: 18`, `Fresh this week: 6`],
      fine:`Keywords auto-matched to packaging capabilities` },
    { id:"buzz", label:"Market Buzz", icon:iconMegaphone,
      hero:`3.4k neutral→positive mentions`,
      items:[`LinkedIn threads: 620`, `Forums & news: 410`, `Velocity +18% w/w`],
      fine:`Social + article velocity around your strengths` },
    { id:"hiring", label:"Hiring", icon:iconBriefcase,
      hero:`52 roles hinting at projects`,
      items:[`Ops/Packaging roles: 31`, `Green initiatives: 9`, `New plants: 5`],
      fine:`Job postings implying line changes / new suppliers` },
    { id:"heat", label:"Buyer Heat", icon:iconFlame,
      hero:`Score 92 / 100`,
      items:[`Avg. session depth: 6.2`, `Return rate 2.3×`, `Time to first buyer: 2.3 days`],
      fine:`Composite signal from web + your site for ${host}` },
  ];

  // ---------- Build nodes on a single orbital line ----------
  const nodes = [];
  const TWO_PI = Math.PI*2;
  const radiusPct = 0.40;       // 40% of min(stage w,h)
  const baseOffset = -Math.PI/2;// start at top

  function buildNodes(){
    // Clean previous (if reflow)
    stage.querySelectorAll('.orbit-node,.orbit-label').forEach(n=>n.remove());

    const count = signals.length;
    const r = Math.min(stage.clientWidth, stage.clientHeight) * radiusPct;

    signals.forEach((sig, i)=>{
      const a0 = baseOffset + (i * (TWO_PI / count));
      const n = document.createElement('button');
      n.className = 'orbit-node';
      n.setAttribute('data-id', sig.id);
      n.setAttribute('aria-label', sig.label);
      n.innerHTML = sig.icon();   // inline SVG
      stage.appendChild(n);

      const label = document.createElement('div');
      label.className = 'orbit-label';
      label.textContent