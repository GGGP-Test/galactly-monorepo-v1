// docs/sections/process/process.js  (v2 - calmer, focused)
// Mounts into <div id="section-process"></div>
(function(){
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------------- CONFIG ----------------
  const CFG = {
    stickyTopPx: 96,
    ringGapFrac: 0.17,
    nodeFanDeg: 100,
    nodeFanStartDeg: -150,
    linkCurviness: 0.22
  };

  // ---------------- DATA ----------------
  const DATA = {
    title: "How the scoring engine works",
    sub: "We score each lead across four lenses, then surface the fastest wins.",
    columns: [
      { id:"intent",    label:"Intent Score",    emoji:"⚡",
        nodes:[
          {id:"search",emoji:"🔎",label:"Search velocity"},
          {id:"tech",emoji:"🛠️",label:"Warehouse tech"},
          {id:"ltv",emoji:"📈",label:"Customer LTV/CAC"},
          {id:"tools",emoji:"🧰",label:"Tools interacted"},
          {id:"size",emoji:"🏢",label:"Company size"}
        ]},
      { id:"weight",    label:"Weight Score",    emoji:"⚖️",
        nodes:[
          {id:"posting",emoji:"🗞️",label:"Posting behaviour"},
          {id:"goodwill",emoji:"🎁",label:"Offers / lead magnets"},
          {id:"nature",emoji:"🏭",label:"Nature of business"},
          {id:"freq",emoji:"🔁",label:"Purchase frequency"}
        ]},
      { id:"character", label:"Character Score", emoji:"🧠",
        nodes:[
          {id:"reviews",emoji:"⭐",label:"Past reviews"},
          {id:"jumps",emoji:"↔️",label:"Vendor switching"},
          {id:"values",emoji:"💬",label:"Language → values"},
          {id:"culture",emoji:"🌐",label:"Language → culture"}
        ]},
      { id:"platform",  label:"Platform Score",  emoji:"📡",
        nodes:[
          {id:"posts",emoji:"🗂️",label:"# posts / platform"},
          {id:"comments",emoji:"💬",label:"# comments / platform"},
          {id:"reply",emoji:"✉️",label:"Intent to respond"}
        ]}
    ],
    result: {
      title:"Result",
      bullets:[
        "Fastest-to-buy window",
        "Likely retention horizon",
        "Advocacy potential",
        "Best first contact channel"
      ]
    },
    steps: [
      {id:"intro",title:"Score System",body:"We only advance leads that match your persona."},
      {id:"intent",title:"Intent score",body:"How fast they’re likely to buy."},
      {id:"weight",title:"Weight score",body:"How commercially meaningful they are."},
      {id:"character",title:"Character score",body:"How they behave with suppliers & customers."},
      {id:"platform",title:"Platform score",body:"Where they’ll most likely reply first."},
      {id:"result",title:"Result",body:"Prioritised list with the reasoning attached."}
    ]
  };

  // ---------------- DOM ----------------
  const railStepsHTML = DATA.steps.map(s=>`
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

      <div class="proc-stage" id="procStage" style="--proc-top:${CFG.stickyTopPx}px">
        <div class="proc-canvas" id="procCanvas"></div>
        <div class="proc-core" aria-hidden="true"></div>
      </div>

      <aside class="proc-rail" id="procRail">
        <div class="proc-progress" id="procProg"></div>
        ${railStepsHTML}
      </aside>
    </div>
  </section>`;

  const stage  = document.getElementById("procStage");
  const canvas = document.getElementById("procCanvas");
  const rail   = document.getElementById("procRail");
  const prog   = document.getElementById("procProg");

  // SVG for dynamic links
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS,"svg");
  svg.setAttribute("class","proc-svg");
  Object.assign(svg.style,{position:"absolute",left:"0",top:"0",width:"100%",height:"100%",overflow:"visible"});
  canvas.appendChild(svg);

  // Rings, titles, nodes
  const rings=[], titles=[], nodes=[];
  const nodesByCol = DATA.columns.map(()=>[]);
  DATA.columns.forEach((col,ci)=>{
    const ring = document.createElement("div");
    ring.className="proc-ring"; ring.dataset.col=col.id;
    canvas.appendChild(ring); rings.push(ring);

    const cap = document.createElement("div");
    cap.className="proc-col-title";
    cap.textContent=`${col.emoji} ${col.label}`;
    canvas.appendChild(cap); titles.push(cap);

    const count = col.nodes.length;
    const step  = count>1 ? CFG.nodeFanDeg/(count-1) : 0;
    for(let i=0;i<count;i++){
      const angle = CFG.nodeFanStartDeg + step*i;
      const n = col.nodes[i];
      const el = document.createElement("button");
      el.className="proc-node"; el.dataset.col=col.id; el.dataset.node=n.id;
      el.innerHTML=`<span class="ico">${n.emoji}</span>${n.label}`;
      canvas.appendChild(el);
      const ref = {el, colIdx:ci, nodeIdx:i, polar:{r:0,deg:angle}};
      nodes.push(ref);
      nodesByCol[ci].push(ref);
    }
  });

  // Result pill
  const res = document.createElement("div");
  res.className="proc-result";
  res.innerHTML = `<h4>🎯 ${DATA.result.title}</h4>
    <ul>${DATA.result.bullets.map(b=>`<li>${b}</li>`).join("")}</ul>`;
  canvas.appendChild(res);

  // Layout
  let W=0,H=0,CX=0,CY=0,radii=[];
  function layout(){
    const r = stage.getBoundingClientRect();
    W=r.width; H=r.height; CX=W/2; CY=H/2;
    svg.setAttribute("viewBox",`0 0 ${W} ${H}`);

    const base = Math.min(W,H)*0.22;
    const gap  = Math.min(W,H)*CFG.ringGapFrac;
    radii = DATA.columns.map((_,i)=>base+gap*i);

    rings.forEach((ring,i)=>{
      const d=2*radii[i];
      Object.assign(ring.style,{
        width:d+"px",height:d+"px",left:(CX-radii[i])+"px",top:(CY-radii[i])+"px"
      });
    });

    titles.forEach((el,i)=>{
      el.style.left = CX+"px";
      el.style.top  = (CY - radii[i] - 18) + "px";
    });

    nodes.forEach(n=>{
      n.polar.r = radii[n.colIdx];
      const rad = n.polar.deg*Math.PI/180;
      const x = CX + n.polar.r*Math.cos(rad);
      const y = CY + n.polar.r*Math.sin(rad);
      n.el.style.left = x+"px";
      n.el.style.top  = y+"px";
    });

    const Rmax=radii[radii.length-1];
    res.style.left = (CX + Rmax + 140) + "px";
    res.style.top  = CY + "px";
  }
  layout();
  addEventListener("resize", layout, {passive:true});

  // Draw links only for active pair
  function clearLinks(){ while(svg.firstChild) svg.removeChild(svg.firstChild); }
  function drawPairLinks(fromArr, toArr){
    clearLinks();
    const curv = CFG.linkCurviness;
    fromArr.forEach(a=>{
      const ax=parseFloat(a.el.style.left), ay=parseFloat(a.el.style.top);
      const vax=ax-CX, vay=ay-CY;
      toArr.forEach(b=>{
        const bx=parseFloat(b.el.style.left), by=parseFloat(b.el.style.top);
        const vbx=bx-CX, vby=by-CY;
        const p=document.createElementNS(svgNS,"path");
        const c1x=ax+vax*curv, c1y=ay+vay*curv;
        const c2x=bx+vbx*curv, c2y=by+vby*curv;
        p.setAttribute("class","proc-link");
        p.setAttribute("d",`M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`);
        svg.appendChild(p);
      });
    });
  }

  // Step state
  const stepEls = Array.from(rail.querySelectorAll(".proc-step"));
  const stepById = Object.fromEntries(stepEls.map(el=>[el.dataset.step,el]));

  function setActive(colId){
    // Rail bullets
    stepEls.forEach(s=>s.classList.remove("is-current","is-done"));
    let passed=true;
    stepEls.forEach(s=>{
      if (passed && s.dataset.step!==colId) s.classList.add("is-done");
      else passed=false;
    });
    if (colId && stepById[colId]) stepById[colId].classList.add("is-current");

    // Node emphasis
    nodes.forEach(n=>{
      const active = DATA.columns[n.colIdx]?.id===colId;
      n.el.style.opacity = active ? "1" : (colId ? ".35" : "1");
      n.el.style.filter  = active ? "none" : (colId ? "grayscale(.2)" : "none");
    });

    // Ring emphasis
    rings.forEach((r,i)=>{
      const on = DATA.columns[i].id===colId;
      r.style.borderColor = on ? "rgba(242,220,160,.6)" : "rgba(255,255,255,.10)";
      r.style.boxShadow   = on ? "0 0 18px rgba(242,220,160,.25)" : "none";
    });

    // Links: only active pair
    const idx = DATA.columns.findIndex(c=>c.id===colId);
    if (idx<0){ clearLinks(); return; }
    const next = nodesByCol[idx+1], prev = nodesByCol[idx-1];
    if (next)      drawPairLinks(nodesByCol[idx], next);
    else if (prev) drawPairLinks(prev, nodesByCol[idx]);
    else clearLinks();
  }

  // Progress spine
  function updateProgress(){
    const r = rail.getBoundingClientRect();
    const vh = innerHeight;
    const t = Math.max(0, Math.min(1, (vh*0.15 - r.top) / (r.height - vh*0.3)));
    prog.style.height = (t * r.height) + "px";
  }

  // Observe steps
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if (!e.isIntersecting) return;
      const id=e.target.dataset.step;
      if (id==="intro" || id==="result"){ clearLinks(); rings.forEach(r=>{r.style.borderColor="rgba(255,255,255,.10)"; r.style.boxShadow="none";}); nodes.forEach(n=>{n.el.style.opacity="1"; n.el.style.filter="none";}); }
      else setActive(id);
      updateProgress();
    });
  },{threshold:0.55});
  stepEls.forEach(el=>io.observe(el));

  // Click node → scroll rail to its step
  nodes.forEach(n=>{
    n.el.addEventListener("click",(ev)=>{
      ev.preventDefault();
      const colId = DATA.columns[n.colIdx].id;
      const tgt = stepById[colId];
      if (tgt) tgt.scrollIntoView({behavior:"smooth",block:"center"});
    });
  });

  // Initial state
  setActive("intent");
  updateProgress();
})();