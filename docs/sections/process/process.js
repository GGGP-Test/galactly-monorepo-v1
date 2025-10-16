// docs/sections/process/process.js  — Linear Track mode (cleaner)
// Mounts into <div id="section-process"></div>
(function(){
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // -------- DATA (from process.data.js if available) --------
  const DATA = (window.PROCESS_DATA && typeof window.PROCESS_DATA === "object")
    ? window.PROCESS_DATA
    : {
        title: "How the scoring engine works",
        sub: "We score each lead across four lenses, then surface the fastest wins.",
        columns: [
          { id:"intent",    label:"Intent score",    emoji:"⚡",
            nodes:[ {id:"search",emoji:"🔎",label:"Search velocity"},
                    {id:"tools",emoji:"🧰",label:"Tools interacted"},
                    {id:"size",emoji:"🏢",label:"Company size"} ]},
          { id:"weight",    label:"Weight score",    emoji:"⚖️",
            nodes:[ {id:"posting",emoji:"🗞️",label:"Posting behaviour"},
                    {id:"offers",emoji:"🎁",label:"Offers / lead magnets"},
                    {id:"nature",emoji:"🏭",label:"Nature of business"},
                    {id:"freq",emoji:"🔁",label:"Purchase frequency"} ]},
          { id:"character", label:"Character score", emoji:"🧠",
            nodes:[ {id:"reviews",emoji:"⭐",label:"Past reviews"},
                    {id:"jumps",emoji:"↔️",label:"Vendor switching"},
                    {id:"values",emoji:"💬",label:"Language → values"},
                    {id:"culture",emoji:"🌐",label:"Language → culture"} ]},
          { id:"platform",  label:"Platform score",  emoji:"📡",
            nodes:[ {id:"posts",emoji:"🗂️",label:"# posts / platform"},
                    {id:"comments",emoji:"💬",label:"# comments / platform"},
                    {id:"reply",emoji:"✉️",label:"Intent to respond"} ]}
        ],
        result:{
          title:"Result",
          bullets:[
            "Fastest-to-buy window",
            "Likely retention horizon",
            "Advocacy potential",
            "Best first contact channel"
          ]
        },
        steps:[
          {id:"intro",title:"Score System",body:"We only advance leads that match your persona."},
          {id:"intent",title:"Intent score",body:"How fast they’re likely to buy."},
          {id:"weight",title:"Weight score",body:"How commercially meaningful they are."},
          {id:"character",title:"Character score",body:"How they behave with suppliers & customers."},
          {id:"platform",title:"Platform score",body:"Where they’ll most likely reply first."},
          {id:"result",title:"Result",body:"Prioritised list with the reasoning attached."}
        ]
      };

  // -------- CONFIG (visual knobs) --------
  const CFG = {
    stickyTopPx: 96,            // matches CSS var --proc-top
    colPadY: 14,                // vertical spacing between chips in a column
    colWidth: 180,              // target column width (chips wrap inside)
    colGap: 70,                 // gap between columns (desktop)
    colGapSm: 36,               // gap between columns (mobile)
    stagePad: 18,               // inner padding for stage layout
    flowStroke: 2,              // base flow line width
    flowActiveStroke: 4,        // active (to-step) line width
    fadeOpacity: 0.28           // non-active chips opacity
  };

  // -------- DOM scaffold --------
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

        <div class="proc-stage" id="procStage" style="--proc-top:${CFG.stickyTopPx}px">
          <div class="proc-canvas" id="procCanvas"></div>
        </div>

        <aside class="proc-rail" id="procRail">
          <div class="proc-progress" id="procProg"></div>
          ${railStepsHTML}
        </aside>
      </div>
    </section>
  `;

  // Handles
  const stage  = document.getElementById("procStage");
  const canvas = document.getElementById("procCanvas");
  const rail   = document.getElementById("procRail");
  const prog   = document.getElementById("procProg");

  // SVG flow line (one path + one active overlay)
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  Object.assign(svg, { className: "proc-svg" });
  Object.assign(svg.style, { position:"absolute", left:"0", top:"0", width:"100%", height:"100%", overflow:"visible" });
  canvas.appendChild(svg);

  const flowBase  = document.createElementNS(svgNS, "path");
  const flowActive= document.createElementNS(svgNS, "path");
  [flowBase, flowActive].forEach(p=>{
    p.setAttribute("fill","none");
    p.setAttribute("vector-effect","non-scaling-stroke");
    svg.appendChild(p);
  });

  // Column titles + nodes
  const colTitles = [];
  const nodeRefs  = [];            // { el, colIdx }
  const byCol     = DATA.columns.map(()=>[]);

  DATA.columns.forEach((col, ci) => {
    const title = document.createElement("div");
    title.className = "proc-col-title";
    title.textContent = `${col.emoji} ${col.label}`;
    canvas.appendChild(title);
    colTitles.push(title);

    col.nodes.forEach((n, ni) => {
      const el = document.createElement("button");
      el.className = "proc-node";
      el.dataset.col = col.id; el.dataset.node = n.id;
      el.innerHTML = `<span class="ico">${n.emoji}</span>${n.label}`;
      canvas.appendChild(el);
      nodeRefs.push({ el, colIdx: ci });
      byCol[ci].push(el);
    });
  });

  // Result pill
  const res = document.createElement("div");
  res.className = "proc-result";
  res.innerHTML = `<h4>🎯 ${DATA.result.title}</h4>
    <ul>${DATA.result.bullets.map(b=>`<li>${b}</li>`).join("")}</ul>`;
  canvas.appendChild(res);

  // -------- Layout (responsive) --------
  let W=0,H=0,isMobile=false,colCenters=[]; // [{x,y}]
  function layout(){
    const r = stage.getBoundingClientRect();
    W = r.width; H = r.height;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    isMobile = W < 560;

    // Stage inner box
    const pad = CFG.stagePad;
    const innerW = W - pad*2;
    const innerH = H - pad*2;

    // Column x positions (left → right)
    const gap = isMobile ? CFG.colGapSm : CFG.colGap;
    const colW = Math.min(CFG.colWidth, Math.max(140, (innerW - gap*(DATA.columns.length-1))/DATA.columns.length));
    const totalW = colW*DATA.columns.length + gap*(DATA.columns.length-1);
    const leftX = pad + (innerW - totalW)/2;

    // Vertical packing inside each column
    const titleY = pad + 8 + (isMobile ? 0 : 6);
    const stackTop = titleY + 26; // just under title
    const stackLineH = 28 + CFG.colPadY;

    // Centers for the flow path (one per column)
    colCenters = DATA.columns.map((_,i)=>{
      const x = leftX + i*(colW+gap) + colW/2;
      const y = pad + innerH*0.58; // a gentle arc-ish baseline
      return {x,y};
    });

    // Place titles and nodes
    DATA.columns.forEach((col, ci)=>{
      // title
      const t = colTitles[ci];
      t.style.left = (leftX + ci*(colW+gap) + colW/2) + "px";
      t.style.top  = titleY + "px";

      // nodes (stack)
      const stack = byCol[ci];
      const startY = stackTop + (isMobile ? 6 : 0);
      stack.forEach((el, idx)=>{
        const x = leftX + ci*(colW+gap) + colW/2;
        const y = startY + idx*stackLineH;
        el.style.left = x + "px";
        el.style.top  = y + "px";
      });
    });

    // Result pill (to the right of last column, vertically centered near centers)
    const last = colCenters[colCenters.length-1];
    res.style.left = Math.min(W - pad - 150, last.x + gap/2 + colW/2 + 90) + "px";
    res.style.top  = (last.y - 4) + "px";

    // Flow path (straight segments M + L)
    const d = colCenters.reduce((acc, p, i)=>{
      return acc + (i===0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`);
    }, "");
    flowBase.setAttribute("d", d);
    flowActive.setAttribute("d", d);

    flowBase.setAttribute("stroke", "rgba(200,220,240,.20)");
    flowBase.setAttribute("stroke-width", CFG.flowStroke);
    flowActive.setAttribute("stroke", "url(#procFlowGrad)");

    // gradient for active path
    defineGradient();

    flowActive.setAttribute("stroke-width", CFG.flowActiveStroke);
    flowActive.setAttribute("stroke-linecap", "round");

    // Reset dash to full, step logic will trim
    flowActive.removeAttribute("stroke-dasharray");
  }

  function defineGradient(){
    // build/replace a linearGradient
    let defs = svg.querySelector("defs");
    if (!defs){ defs = document.createElementNS(svgNS, "defs"); svg.insertBefore(defs, svg.firstChild); }
    let grad = defs.querySelector("#procFlowGrad");
    if (!grad){
      grad = document.createElementNS(svgNS, "linearGradient");
      grad.setAttribute("id", "procFlowGrad");
      grad.setAttribute("x1","0%"); grad.setAttribute("y1","0%");
      grad.setAttribute("x2","100%"); grad.setAttribute("y2","0%");
      defs.appendChild(grad);
    }
    grad.innerHTML = `
      <stop offset="0%"  stop-color="rgba(242,220,160,.95)"/>
      <stop offset="100%" stop-color="rgba(242,220,160,.45)"/>
    `;
  }

  layout();
  addEventListener("resize", layout, {passive:true});

  // -------- Step state & interactions --------
  const stepEls = Array.from(rail.querySelectorAll(".proc-step"));
  const stepById = Object.fromEntries(stepEls.map(el=>[el.dataset.step, el]));

  function setActive(colId){
    // rail
    stepEls.forEach(s=>s.classList.remove("is-current","is-done"));
    let passed = true;
    stepEls.forEach(s=>{
      if (passed && s.dataset.step!==colId) s.classList.add("is-done");
      else passed = false;
    });
    if (stepById[colId]) stepById[colId].classList.add("is-current");

    // nodes fade
    nodeRefs.forEach(n=>{
      const on = (DATA.columns[n.colIdx]?.id === colId);
      n.el.style.opacity = on ? "1" : (colId ? String(CFG.fadeOpacity) : "1");
      n.el.style.filter  = on ? "none" : (colId ? "grayscale(.15)" : "none");
    });

    // titles emphasis
    DATA.columns.forEach((c, i)=>{
      const t = colTitles[i];
      const on = (c.id === colId);
      t.style.filter = on ? "brightness(1.1)" : "none";
      t.style.opacity = on ? "1" : (colId ? ".75" : "1");
      t.style.boxShadow = on ? "0 0 0 1px rgba(242,220,160,.35) inset" : "none";
    });

    // active flow length up to current column index
    const idx = DATA.columns.findIndex(c=>c.id===colId);
    if (idx < 0){
      flowActive.setAttribute("stroke-dasharray","0 1"); // hide
      return;
    }

    // compute cumulative length to the current center
    const totalLen = flowActive.getTotalLength();
    // Build piecewise linear length manually to avoid browser quirks
    let cum = 0, target = 0;
    for(let i=1;i<=idx;i++){
      const a = colCenters[i-1], b = colCenters[i];
      const seg = Math.hypot(b.x-a.x, b.y-a.y);
      cum += seg;
    }
    target = cum;
    flowActive.setAttribute("stroke-dasharray", `${target} ${Math.max(0,totalLen-target)+1}`);
  }

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
      const id = e.target.dataset.step;
      if (id==="intro" || id==="result"){
        // reset to neutral
        nodeRefs.forEach(n=>{ n.el.style.opacity="1"; n.el.style.filter="none"; });
        colTitles.forEach(t=>{ t.style.opacity="1"; t.style.boxShadow="none"; t.style.filter="none"; });
        flowActive.setAttribute("stroke-dasharray","0 1");
      }else{
        setActive(id);
      }
      updateProgress();
    });
  }, {threshold: 0.55});
  stepEls.forEach(el=>io.observe(el));

  // Click chip → scroll rail to that column’s step
  nodeRefs.forEach(n=>{
    n.el.addEventListener("click", (ev)=>{
      ev.preventDefault();
      const colId = DATA.columns[n.colIdx].id;
      const tgt = stepById[colId];
      if (tgt) tgt.scrollIntoView({ behavior:"smooth", block:"center" });
    });
  });

  // Initial
  setActive("intent");
  updateProgress();
})();