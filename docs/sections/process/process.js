// docs/sections/process/process.js — Linear Track v4
// Builds a left→right pipeline with 4 columns and a single highlighted link.
// Reads from window.PROCESS_DATA if provided (from process.data.js).

(function(){
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ------------ DATA ------------
  const FALLBACK = {
    title: "How the scoring engine works",
    sub: "We score each lead across four lenses, then surface the fastest wins.",
    columns: [
      { id:"intent",    label:"Intent Score",    emoji:"⚡",
        nodes:[
          {id:"search",emoji:"🔎",label:"Search velocity"},
          {id:"tech",emoji:"🛠️",label:"Warehouse tech"},
          {id:"ltv",emoji:"📈",label:"Customer LTV/CAC"},
          {id:"tools",emoji:"🧰",label:"Tools interacted"},
          {id:"size",emoji:"🏢",label:"Company size"}]},
      { id:"weight",    label:"Weight Score",    emoji:"⚖️",
        nodes:[
          {id:"posting",emoji:"🗞️",label:"Posting behaviour"},
          {id:"goodwill",emoji:"🎁",label:"Offers / lead magnets"},
          {id:"nature",emoji:"🏭",label:"Nature of business"},
          {id:"freq",emoji:"🔁",label:"Purchase frequency"}]},
      { id:"character", label:"Character Score", emoji:"🧠",
        nodes:[
          {id:"reviews",emoji:"⭐",label:"Past reviews"},
          {id:"jumps",emoji:"↔️",label:"Vendor switching"},
          {id:"values",emoji:"💬",label:"Language → values"},
          {id:"culture",emoji:"🌐",label:"Language → culture"}]},
      { id:"platform",  label:"Platform Score",  emoji:"📡",
        nodes:[
          {id:"posts",emoji:"🗂️",label:"# posts / platform"},
          {id:"comments",emoji:"💬",label:"# comments / platform"},
          {id:"reply",emoji:"✉️",label:"Intent to respond"}]}
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
  const DATA = (window.PROCESS_DATA && typeof window.PROCESS_DATA === "object")
    ? window.PROCESS_DATA
    : FALLBACK;

  // ------------ SHELL MARKUP ------------
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

      <div class="proc-stage" id="procStage">
        <div class="proc-canvas" id="procCanvas"></div>
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

  // ------------ SVG (links) ------------
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS,"svg");
  svg.setAttribute("class","proc-svg");
  svg.setAttribute("viewBox","0 0 100 100"); // will be updated in layout
  svg.style.position = "absolute";
  svg.style.inset = "0";
  canvas.appendChild(svg);

  // gradient for the highlighted link
  const defs = document.createElementNS(svgNS, "defs");
  const grad = document.createElementNS(svgNS, "linearGradient");
  grad.setAttribute("id", "procLineGrad");
  grad.setAttribute("x1","0"); grad.setAttribute("y1","0");
  grad.setAttribute("x2","1"); grad.setAttribute("y2","0");
  const stop1 = document.createElementNS(svgNS, "stop");
  stop1.setAttribute("offset","0%");
  stop1.setAttribute("stop-color","rgba(242,220,160,1)");
  const stop2 = document.createElementNS(svgNS, "stop");
  stop2.setAttribute("offset","100%");
  stop2.setAttribute("stop-color","rgba(184,145,61,1)");
  grad.appendChild(stop1); grad.appendChild(stop2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  // ------------ DOM refs we create ------------
  const titles = [];              // per column
  const nodeRefs = [];            // { el, colIdx, nodeIdx, x, y }
  const nodesByCol = DATA.columns.map(()=>[]);
  const linkPaths = [];           // base links (thin)
  let activePath = null;          // highlighted link

  // build columns (titles + node buttons)
  DATA.columns.forEach((col, ci)=>{
    const cap = document.createElement("div");
    cap.className = "proc-col-title";
    cap.textContent = `${col.emoji} ${col.label}`;
    canvas.appendChild(cap);
    titles.push(cap);

    col.nodes.forEach((n, ni)=>{
      const el = document.createElement("button");
      el.className = "proc-node";
      el.innerHTML = `<span class="ico">${n.emoji}</span>${n.label}`;
      el.dataset.col = col.id;
      el.dataset.node = n.id;
      canvas.appendChild(el);
      const ref = { el, colIdx:ci, nodeIdx:ni, x:0, y:0 };
      nodeRefs.push(ref);
      nodesByCol[ci].push(ref);
    });
  });

  // result card
  const res = document.createElement("div");
  res.className = "proc-result";
  res.innerHTML = `<h4>🎯 ${DATA.result.title}</h4>
    <ul>${DATA.result.bullets.map(b=>`<li>${b}</li>`).join("")}</ul>`;
  canvas.appendChild(res);

  // ------------ geometry / layout ------------
  let W=0, H=0, colX=[], topY=0, vStep=72;

  function layout(){
    const r = stage.getBoundingClientRect();
    W = r.width; H = Math.max(560, r.height);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // left/right margins in the stage; keep some room for result card
    const L = Math.max(28, 28);
    const Rpad = 160; // space on the right for result card
    const usable = Math.max(300, W - L - Rpad);
    const cols = DATA.columns.length;
    colX = [];
    for(let i=0;i<cols;i++){
      colX.push( L + (usable) * (i/(cols-1)) );
    }

    // column titles top
    topY = 70;
    titles.forEach((el,i)=>{
      el.style.left = `${colX[i]}px`;
      el.style.top  = `${topY}px`;
    });

    // nodes per column (stack)
    const firstNodeY = topY + 72;
    DATA.columns.forEach((col,ci)=>{
      col.nodes.forEach((_,ni)=>{
        const ref = nodesByCol[ci][ni];
        ref.x = colX[ci];
        ref.y = firstNodeY + ni * vStep;
        ref.el.style.left = `${ref.x}px`;
        ref.el.style.top  = `${ref.y}px`;
      });
    });

    // result card anchored to the last column, centered vertically around the mid stack
    const lastCol = DATA.columns.length - 1;
    const lastCount = DATA.columns[lastCol].nodes.length;
    const midY = firstNodeY + (lastCount-1) * vStep * 0.5;
    res.style.left = `${Math.min(W-120, colX[lastCol] + 160)}px`;
    res.style.top  = `${midY}px`;

    // rebuild base links (thin) once after positions are known
    rebuildBaseLinks();
  }

  function pathBetween(ax,ay,bx,by){
    // gentle S curve that bows downward slightly
    const dx = bx-ax, dy = by-ay;
    const curv = 0.35;
    const c1x = ax + dx*curv, c1y = ay + dy*curv + 40;
    const c2x = bx - dx*curv, c2y = by - dy*curv - 40;
    return `M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`;
  }

  function clearChildren(node){ while(node.lastChild) node.removeChild(node.lastChild); }

  function rebuildBaseLinks(){
    clearChildren(svg);
    svg.appendChild(defs); // keep gradient
    linkPaths.length = 0;

    for(let ci=0; ci<DATA.columns.length-1; ci++){
      const A = nodesByCol[ci];
      const B = nodesByCol[ci+1];
      A.forEach(a=>{
        B.forEach(b=>{
          const p = document.createElementNS(svgNS,"path");
          p.setAttribute("d", pathBetween(a.x,a.y,b.x,b.y));
          // base link style handled by CSS (not the last child)
          svg.appendChild(p);
          linkPaths.push(p);
        });
      });
    }
  }

  // ------------ step interactions ------------
  const stepEls = Array.from(rail.querySelectorAll(".proc-step"));
  const byId = Object.fromEntries(stepEls.map(el=>[el.dataset.step, el]));

  function setActive(colId){
    // Rail state
    stepEls.forEach(s=>s.classList.remove("is-current","is-done"));
    let passed = true;
    stepEls.forEach(s=>{
      if (passed && s.dataset.step!==colId) s.classList.add("is-done");
      else passed = false;
    });
    if (colId && byId[colId]) byId[colId].classList.add("is-current");

    // Node emphasis
    nodeRefs.forEach(n=>{
      const active = DATA.columns[n.colIdx]?.id===colId;
      n.el.style.opacity = active ? "1" : (colId ? ".35" : "1");
      n.el.style.filter  = active ? "none" : (colId ? "grayscale(.15)" : "none");
    });

    // Highlight one pair of columns with a glowing path
    if (activePath){ svg.removeChild(activePath); activePath = null; }
    const idx = DATA.columns.findIndex(c=>c.id===colId);
    if (idx<0) return;
    const next = nodesByCol[idx+1], curr = nodesByCol[idx], prev = nodesByCol[idx-1];
    const from = next ? curr : prev;
    const to   = next ? next : curr;
    if (!from || !to) return;

    // choose middle-to-middle nodes for the “story” line
    const mid = a => a[Math.floor(a.length/2)];
    const A = mid(from), B = mid(to);
    const p = document.createElementNS(svgNS,"path");
    p.setAttribute("d", pathBetween(A.x,A.y,B.x,B.y));
    p.setAttribute("stroke","url(#procLineGrad)");
    p.setAttribute("fill","none");
    p.setAttribute("stroke-width","2");
    svg.appendChild(p); // appended last → CSS highlights it
    activePath = p;
  }

  function updateProgress(){
    const r = rail.getBoundingClientRect();
    const vh = window.innerHeight;
    const t = Math.max(0, Math.min(1, (vh*0.15 - r.top) / (r.height - vh*0.3)));
    prog.style.height = (t * r.height) + "px";
  }

  // IO to drive active column
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if (!e.isIntersecting) return;
      const id = e.target.dataset.step;
      if (id==="intro" || id==="result"){
        nodeRefs.forEach(n=>{ n.el.style.opacity="1"; n.el.style.filter="none"; });
        if (activePath){ svg.removeChild(activePath); activePath = null; }
      } else {
        setActive(id);
      }
      updateProgress();
    });
  },{threshold:0.55});
  stepEls.forEach(el=>io.observe(el));

  // Click a node → scroll rail to that step
  nodeRefs.forEach(n=>{
    n.el.addEventListener("click",(ev)=>{
      ev.preventDefault();
      const colId = DATA.columns[n.colIdx].id;
      const tgt = byId[colId];
      if (tgt) tgt.scrollIntoView({behavior:"smooth", block:"center"});
    });
  });

  // initial layout & state
  layout();
  setActive("intent");
  updateProgress();
  window.addEventListener("resize", layout, {passive:true});
})();