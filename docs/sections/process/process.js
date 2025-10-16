// docs/sections/process/process.js  — PATHRAIL v3 (journey, clean)
// Mounts into <div id="section-process"></div>
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- DATA ----------
  // If a global provides data, use it. Otherwise fall back to sane defaults.
  const D = (window.PROCESS_DATA && window.PROCESS_DATA()) || {
    title: "How the scoring engine works",
    sub: "We score each lead across four lenses, then surface the fastest wins.",
    columns: [
      { id: "intent",    label: "Intent Score",    emoji: "⚡",
        nodes: [
          { id: "search",    emoji: "🔎", label: "Search velocity" },
          { id: "tech",      emoji: "🛠️", label: "Warehouse tech" },
          { id: "ltv",       emoji: "📈", label: "Customer LTV/CAC" },
          { id: "tools",     emoji: "🧰", label: "Tools interacted" },
          { id: "size",      emoji: "🏢", label: "Company size" }
        ]},
      { id: "weight",    label: "Weight Score",    emoji: "⚖️",
        nodes: [
          { id: "posting",   emoji: "🗞️", label: "Posting behaviour" },
          { id: "goodwill",  emoji: "🎁", label: "Offers / lead magnets" },
          { id: "nature",    emoji: "🏭", label: "Nature of business" },
          { id: "freq",      emoji: "🔁", label: "Purchase frequency" }
        ]},
      { id: "character", label: "Character Score", emoji: "🧠",
        nodes: [
          { id: "reviews",   emoji: "⭐", label: "Past reviews" },
          { id: "jumps",     emoji: "↔️", label: "Vendor switching" },
          { id: "values",    emoji: "💬", label: "Language → values" },
          { id: "culture",   emoji: "🌐", label: "Language → culture" }
        ]},
      { id: "platform",  label: "Platform Score",  emoji: "📡",
        nodes: [
          { id: "posts",     emoji: "🗂️", label: "# posts / platform" },
          { id: "comments",  emoji: "💬", label: "# comments / platform" },
          { id: "reply",     emoji: "✉️", label: "Intent to respond" }
        ]}
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
      { id:"intro",     title:"Score System",   body:"We only advance leads that match your persona." },
      { id:"intent",    title:"Intent score",   body:"How fast they’re likely to buy." },
      { id:"weight",    title:"Weight score",   body:"How commercially meaningful they are." },
      { id:"character", title:"Character score",body:"How they behave with suppliers & customers." },
      { id:"platform",  title:"Platform score", body:"Where they’ll most likely reply first." },
      { id:"result",    title:"Result",         body:"Prioritised list with the reasoning attached." }
    ]
  };

  // ---------- DOM ----------
  const laneTags = D.columns.map(c =>
    `<button class="lane-tag" data-col="${c.id}">
       <span class="ico">${c.emoji}</span><span>${c.label}</span>
     </button>`).join("");

  const groupsHTML = D.columns.map((c, i) => `
    <div class="pg-group" data-col="${c.id}" style="--z:${i+1}">
      <div class="pg-head chip"><span class="ico">${c.emoji}</span>${c.label}</div>
      <div class="pg-chips">
        ${c.nodes.map(n => `<button class="chip pg-chip" data-col="${c.id}" data-node="${n.id}">
          <span class="ico">${n.emoji}</span>${n.label}
        </button>`).join("")}
      </div>
    </div>`).join("");

  const railHTML = D.steps.map(s => `
    <div class="proc-step" data-step="${s.id}">
      <span class="proc-bullet" aria-hidden="true"></span>
      <h3>${s.title}</h3>
      <p>${s.body}</p>
    </div>`).join("");

  mount.innerHTML = `
  <section class="proc3" aria-label="Process">
    <div class="proc3-inner">
      <header class="proc3-hd">
        <h2>${D.title}</h2>
        <div class="sub">${D.sub}</div>
      </header>

      <div class="pg-left">
        <div class="pg-board">
          <div class="pg-tags">${laneTags}</div>
          <div class="pg-stage">
            <canvas class="pg-canvas" id="pgCanvas"></canvas>
            <div class="pg-groups">${groupsHTML}
              <div class="pg-result" data-col="result">
                <h4>🎯 ${D.result.title}</h4>
                <ul>${D.result.bullets.map(b=>`<li>${b}</li>`).join("")}</ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside class="proc-rail" id="procRail">
        <div class="proc-progress" id="procProg"></div>
        ${railHTML}
      </aside>
    </div>
  </section>`;

  const stage   = mount.querySelector(".pg-stage");
  const canvas  = document.getElementById("pgCanvas");
  const ctx     = canvas.getContext("2d");
  const groups  = Array.from(mount.querySelectorAll(".pg-group"));
  const tags    = Array.from(mount.querySelectorAll(".lane-tag"));
  const result  = mount.querySelector(".pg-result");
  const rail    = document.getElementById("procRail");
  const prog    = document.getElementById("procProg");

  // ---------- Layout ----------
  let W=0, H=0, centers=[];
  function layout(){
    const r = stage.getBoundingClientRect();
    W = Math.max(600, Math.floor(r.width));
    H = Math.max(360, Math.floor(r.height));
    canvas.width  = W; canvas.height = H;

    // Position groups evenly across stage
    const padX = 36, padY = 22;
    const cols = D.columns.length;
    centers = [];
    const colWidth = (W - padX*2) / (cols+1); // +1 space for result
    groups.forEach((g,i)=>{
      const x = padX + colWidth*(i+0.5);
      const y = H*0.48;
      g.style.transform = `translate(${x}px, ${y}px) translateZ(0)`;
      g.style.setProperty("--x", x);
      g.style.setProperty("--y", y);
      centers.push({x,y});
    });
    // Result node at last slot
    const rx = padX + colWidth*(cols+0.5);
    const ry = H*0.48;
    result.style.transform = `translate(${rx}px, ${ry}px)`;
    centers.push({x:rx,y:ry});
    drawPath();
  }

  // Path drawing (smooth snake through column centers)
  function drawPath(activeIdx = -1){
    ctx.clearRect(0,0,W,H);
    if (centers.length < 2) return;
    const glow = ctx.createLinearGradient(0,0,W,0);
    glow.addColorStop(0, "rgba(242,220,160,0.10)");
    glow.addColorStop(1, "rgba(242,220,160,0.20)");
    ctx.lineWidth = 3;
    ctx.strokeStyle = glow;
    ctx.beginPath();
    ctx.moveTo(centers[0].x, centers[0].y);
    for (let i=1;i<centers.length;i++){
      const p0 = centers[i-1], p1 = centers[i];
      const mx = (p0.x + p1.x)/2;
      ctx.bezierCurveTo(mx, p0.y, mx, p1.y, p1.x, p1.y);
    }
    ctx.stroke();

    // highlight segment when a column is active
    if (activeIdx >= 0 && activeIdx < centers.length-1){
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(242,220,160,0.55)";
      ctx.beginPath();
      const p0 = centers[activeIdx], p1 = centers[activeIdx+1];
      const mx = (p0.x + p1.x)/2;
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(mx, p0.y, mx, p1.y, p1.x, p1.y);
      ctx.stroke();
    }
  }

  // ---------- State / Interactions ----------
  function setActive(colId){
    const idx = D.columns.findIndex(c=>c.id===colId);
    groups.forEach((g,i)=>{
      const on = i===idx;
      g.classList.toggle("is-active", on);
      g.style.opacity = (colId && !on) ? 0.35 : 1;
    });
    if (idx>=0) drawPath(idx); else drawPath(-1);

    // update rail styles
    const steps = Array.from(rail.querySelectorAll(".proc-step"));
    let passed = true;
    steps.forEach(s => s.classList.remove("is-current","is-done"));
    steps.forEach(s=>{
      if (passed && s.dataset.step !== colId) s.classList.add("is-done");
      else passed=false;
    });
    const cur = rail.querySelector(`.proc-step[data-step="${colId}"]`);
    cur && cur.classList.add("is-current");
    updateProgress();
  }

  // lane tag click → jump rail and focus
  tags.forEach(t=>{
    t.addEventListener("click", ()=>{
      const id = t.dataset.col;
      const el = rail.querySelector(`[data-step="${id}"]`);
      el && el.scrollIntoView({behavior:"smooth", block:"center"});
      setActive(id);
    });
  });

  // IntersectionObserver for scroll-driven narration
  const steps = Array.from(rail.querySelectorAll(".proc-step"));
  const io = new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if (!e.isIntersecting) return;
      const id = e.target.dataset.step;
      if (id==="intro"||id==="result"){ setActive(""); return; }
      setActive(id);
    });
  },{threshold:0.55});
  steps.forEach(s=>io.observe(s));

  // Progress bar in rail
  function updateProgress(){
    const r = rail.getBoundingClientRect();
    const vh = innerHeight;
    const t = Math.max(0, Math.min(1, (vh*0.15 - r.top) / (r.height - vh*0.3)));
    prog.style.height = (t * r.height) + "px";
  }

  // Mouse parallax (lightweight)
  const board = mount.querySelector(".pg-board");
  board.addEventListener("mousemove", e=>{
    const r = board.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width/2)) / r.width;
    const dy = (e.clientY - (r.top  + r.height/2)) / r.height;
    groups.forEach((g,i)=>{
      const depth = (i+1)*0.8; // slight layering
      g.style.transform = `translate(calc(var(--x) + ${dx*depth*10}px), calc(var(--y) + ${dy*depth*6}px))`;
    });
    drawPath();
  });
  board.addEventListener("mouseleave", layout);

  // Initial
  function sizeStage(){
    // give the stage some breathing room proportional to viewport
    const h = Math.max(420, Math.min(620, Math.round(innerHeight*0.62)));
    stage.style.height = h+"px";
  }
  sizeStage(); layout(); updateProgress();
  addEventListener("resize", ()=>{ sizeStage(); layout(); updateProgress(); });

  // Click chip → also focus its lane
  mount.querySelectorAll(".pg-chip").forEach(ch=>{
    ch.addEventListener("click", ()=>{
      const id = ch.dataset.col;
      setActive(id);
      const el = rail.querySelector(`[data-step="${id}"]`);
      el && el.scrollIntoView({behavior:"smooth", block:"center"});
    });
  });
})();