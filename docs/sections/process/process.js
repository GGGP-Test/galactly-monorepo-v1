<!-- docs/sections/process/process.js -->
<script>
/* Process section (scrollytelling) — single-file renderer
   - Mounts into <div id="section-process"></div>
   - Sticky left graph, right copy rail + progress
   - Columns: Intent → Weight → Character → Platform → Result
   - All data is inline below (edit copy/emoji/points there)
*/
(function(){
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- CONFIG (safe knobs) ----------
  const CFG = {
    stickyTopPx: 96,         // must match --proc-top in CSS
    ringGapFrac: 0.17,       // gap between rings as fraction of shortest side
    nodeFanDeg: 110,         // arc sweep per column for node placement
    nodeFanStartDeg: -160,   // starting angle of that fan (clockwise = positive)
    linkCurviness: 0.22,     // 0..0.5 : how bendy the connectors are
  };

  // ---------- DATA (edit copy here) ----------
  const DATA = {
    title: "How the scoring engine works",
    sub: "We score each lead across four lenses, then surface the fastest wins.",
    columns: [
      {
        id: "intent", label: "Intent Score", emoji: "⚡",
        nodes: [
          { id:"search", emoji:"🔎", label:"Search velocity" },
          { id:"tech",    emoji:"🛠️", label:"Warehouse tech" },
          { id:"ltv",     emoji:"📈", label:"Customer LTV/CAC" },
          { id:"tools",   emoji:"🧰", label:"Tools interacted" },
          { id:"size",    emoji:"🏢", label:"Company size" },
        ]
      },
      {
        id: "weight", label: "Weight Score", emoji: "⚖️",
        nodes: [
          { id:"posting", emoji:"🗞️", label:"Posting behaviour" },
          { id:"goodwill",emoji:"🎁", label:"Offers / lead magnets" },
          { id:"nature",  emoji:"🏭", label:"Nature of business" },
          { id:"freq",    emoji:"🔁", label:"Purchase frequency" },
        ]
      },
      {
        id: "character", label: "Character Score", emoji: "🧠",
        nodes: [
          { id:"reviews", emoji:"⭐", label:"Past reviews" },
          { id:"jumps",   emoji:"↔️", label:"Vendor switching" },
          { id:"values",  emoji:"💬", label:"Language → values" },
          { id:"culture", emoji:"🌐", label:"Language → culture" },
        ]
      },
      {
        id: "platform", label: "Platform Score", emoji: "📡",
        nodes: [
          { id:"posts",   emoji:"🗂️", label:"# posts / platform" },
          { id:"comments",emoji:"💬", label:"# comments / platform" },
          { id:"reply",   emoji:"✉️", label:"Intent to respond" },
        ]
      }
    ],
    result: {
      title: "Result",
      bullets: [
        "Fastest-to-buy window",
        "Likely retention horizon",
        "Advocacy potential",
        "Best first contact channel"
      ]
    },
    steps: [
      { id:"intro",     title:"Score System",     body:"We only advance leads that match your persona." },
      { id:"intent",    title:"Intent score",     body:"How fast they’re likely to buy." },
      { id:"weight",    title:"Weight score",     body:"How commercially meaningful they are." },
      { id:"character", title:"Character score",  body:"How they behave with suppliers & customers." },
      { id:"platform",  title:"Platform score",   body:"Where they’ll most likely reply first." },
      { id:"result",    title:"Result",           body:"Prioritised list with the reasoning attached." },
    ]
  };

  // ---------- DOM ----------
  const railStepsHTML = DATA.steps.map(s => `
    <div class="proc-step" data-step="${s.id}">
      <div class="proc-bullet"></div>
      <h3>${s.title}</h3>
      <p>${s.body}</p>
    </div>`).join("");

  mount.innerHTML = `
  <section class="proc-section" aria-label="Process">
    <div class="proc-inner">
      <header class="proc-hd">
        <h2>${DATA.title}</h2>
        <div class="sub">${DATA.sub}</div>
      </header>

      <!-- STAGE -->
      <div class="proc-stage" id="procStage" style="--proc-top:${CFG.stickyTopPx}px">
        <div class="proc-canvas" id="procCanvas"></div>
        <div class="proc-core" aria-hidden="true"></div>
      </div>

      <!-- RAIL -->
      <aside class="proc-rail" id="procRail">
        <div class="proc-progress" id="procProg"></div>
        ${railStepsHTML}
      </aside>
    </div>
  </section>`;

  const stage   = document.getElementById("procStage");
  const canvas  = document.getElementById("procCanvas");
  const rail    = document.getElementById("procRail");
  const prog    = document.getElementById("procProg");

  // SVG overlay for links
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "proc-svg");
  svg.style.position = "absolute";
  svg.style.left = "0"; svg.style.top = "0"; svg.style.width="100%"; svg.style.height="100%";
  svg.style.overflow = "visible";
  canvas.appendChild(svg);

  // Build rings, titles, nodes
  const rings = [];
  const colTitles = [];
  const nodeRefs = []; // [{el, colIdx, nodeIdx, polar:{r,deg}}]
  DATA.columns.forEach((col, ci) => {
    const ring = document.createElement("div");
    ring.className = "proc-ring";
    ring.dataset.col = col.id;
    canvas.appendChild(ring);
    rings.push(ring);

    const cap = document.createElement("div");
    cap.className = "proc-col-title";
    cap.textContent = `${col.emoji} ${col.label}`;
    canvas.appendChild(cap);
    colTitles.push(cap);

    // slot angles for nodes along an arc (evenly spaced)
    const count = col.nodes.length;
    const step = (count>1) ? CFG.nodeFanDeg/(count-1) : 0;
    for(let i=0;i<count;i++){
      const a = CFG.nodeFanStartDeg + step*i;
      const n = col.nodes[i];
      const el = document.createElement("button");
      el.className = "proc-node";
      el.dataset.col = col.id; el.dataset.node = n.id;
      el.innerHTML = `<span class="ico">${n.emoji}</span>${n.label}`;
      canvas.appendChild(el);
      nodeRefs.push({ el, colIdx:ci, nodeIdx:i, polar:{ r:0, deg:a }});
    }
  });

  // Result pill
  const res = document.createElement("div");
  res.className = "proc-result";
  res.innerHTML = `<h4>🎯 ${DATA.result.title}</h4>
    <ul>${DATA.result.bullets.map(b=>`<li>${b}</li>`).join("")}</ul>`;
  canvas.appendChild(res);

  // Build dense link set: between each adjacent column (all-to-all)
  const linkRefs = [];
  DATA.columns.forEach((col, ci)=>{
    const next = DATA.columns[ci+1];
    if (!next) return;
    const a = nodeRefs.filter(n=>n.colIdx===ci);
    const b = nodeRefs.filter(n=>n.colIdx===ci+1);
    a.forEach(sa=>{
      b.forEach(sb=>{
        const p = document.createElementNS(svgNS, "path");
        p.setAttribute("class","proc-link");
        p.dataset.from = col.id; p.dataset.to = next.id;
        svg.appendChild(p);
        linkRefs.push({ path:p, from:sa, to:sb });
      });
    });
  });

  // Geometry + layout
  let W=0,H=0,CX=0,CY=0, radii=[];
  function layout(){
    const r = stage.getBoundingClientRect();
    W = r.width; H = r.height; CX=W/2; CY=H/2;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // Base radius & gaps
    const base = Math.min(W,H) * (0.22);
    const gap  = Math.min(W,H) * CFG.ringGapFrac;
    radii = DATA.columns.map((_,i)=> base + gap*i);

    rings.forEach((ring,i)=>{
      const d = 2*radii[i];
      ring.style.width=d+"px"; ring.style.height=d+"px";
      ring.style.left=(CX - radii[i])+"px";
      ring.style.top =(CY - radii[i])+"px";
    });

    // Column captions (top of ring)
    colTitles.forEach((el,i)=>{
      el.style.left = CX + "px";
      el.style.top  = (CY - radii[i] - 18) + "px";
    });

    // Node positions
    nodeRefs.forEach(n=>{
      n.polar.r = radii[n.colIdx];
      const rad = (n.polar.deg*Math.PI/180);
      const x = CX + n.polar.r*Math.cos(rad);
      const y = CY + n.polar.r*Math.sin(rad);
      n.el.style.left = x + "px";
      n.el.style.top  = y + "px";
    });

    // Result pill to the right of largest ring
    const Rmax = radii[radii.length-1];
    res.style.left = (CX + Rmax + 140) + "px";
    res.style.top  = (CY) + "px";

    // Link curves
    linkRefs.forEach(L=>{
      const a = L.from, b = L.to;
      const ax = parseFloat(a.el.style.left), ay = parseFloat(a.el.style.top);
      const bx = parseFloat(b.el.style.left), by = parseFloat(b.el.style.top);
      const mx = (ax+bx)/2, my = (ay+by)/2;

      // Bezier control points push outward from center for a nice fan
      const vax = ax - CX, vay = ay - CY;
      const vbx = bx - CX, vby = by - CY;
      const c1x = ax + vax*CFG.linkCurviness;
      const c1y = ay + vay*CFG.linkCurviness;
      const c2x = bx + vbx*CFG.linkCurviness;
      const c2y = by + vby*CFG.linkCurviness;

      L.path.setAttribute("d", `M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`);
    });
  }
  layout();
  addEventListener("resize", layout, { passive:true });

  // ---------- Rail → highlight logic ----------
  const stepEls = Array.from(rail.querySelectorAll(".proc-step"));
  const byId = Object.fromEntries(stepEls.map(el=>[el.dataset.step, el]));

  function setActive(colId){
    // Steps
    stepEls.forEach(s=>s.classList.remove("is-current","is-done"));
    let passed = true;
    stepEls.forEach(s=>{
      if (passed && s.dataset.step !== colId) s.classList.add("is-done");
      else passed = false;
    });
    if (colId && byId[colId]) byId[colId].classList.add("is-current");

    // Nodes
    nodeRefs.forEach(n=>{
      const active = (DATA.columns[n.colIdx]?.id === colId);
      n.el.classList.toggle("is-active", active);
      n.el.classList.toggle("is-dim", !!colId && !active);
    });

    // Links
    linkRefs.forEach(L=>{
      const act = (L.path.dataset.from===colId || L.path.dataset.to===colId);
      L.path.classList.toggle("is-active", act);
      if (colId) L.path.style.opacity = act ? "1" : "0.25";
      else L.path.style.opacity = "1";
    });
  }
  setActive("intent"); // first meaningful focus

  // Progress spine
  function updateProgress(){
    const r = rail.getBoundingClientRect();
    const vh = window.innerHeight;
    const start = Math.max(0, Math.min(1, (vh*0.15 - r.top) / (r.height - vh*0.3)));
    prog.style.height = (start * r.height) + "px";
  }
  updateProgress();

  // Observe steps
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if (!e.isIntersecting) return;
      const id = e.target.dataset.step;
      // only switch when a real column id or "result"
      if (id==="intro") { setActive(null); }
      else if (id==="result"){ setActive(null); }
      else { setActive(id); }
      updateProgress();
    });
  }, { root:null, threshold:0.55 });
  stepEls.forEach(el=>io.observe(el));

  // Click on nodes → jump rail to that step
  nodeRefs.forEach(n=>{
    n.el.addEventListener("click", (ev)=>{
      ev.preventDefault();
      const colId = DATA.columns[n.colIdx].id;
      const target = byId[colId];
      if (target){
        target.scrollIntoView({behavior:"smooth", block:"center"});
      }
    });
  });
})();
</script>