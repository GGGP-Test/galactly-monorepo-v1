// docs/sections/process/process.js  — Linear Track v3 (fix SVG.className crash)
// Mounts into <div id="section-process"></div>
(function(){
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------------- DATA ----------------
  // If you also load process.data.js, put a global window.PROCESS_DATA there.
  // This script will use it if present; otherwise it uses the defaults below.
  const DATA = (window.PROCESS_DATA && typeof window.PROCESS_DATA === "object")
    ? window.PROCESS_DATA
    : {
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

  // ---------------- SVG (flow lines) ----------------
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS,"svg");
  // IMPORTANT: never set svg.className = 'x' on SVG; use setAttribute instead:
  svg.setAttribute("class","proc-svg");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.overflow = "visible";
  canvas.appendChild(svg);

  // gradient for the highlighted link
  const defs = document.createElementNS(svgNS, "defs");
  const grad = document.createElementNS(svgNS, "linearGradient");
  grad.setAttribute("id","procLineGrad");
  grad.setAttribute("x1","0"); grad.setAttribute("y1","0");
  grad.setAttribute("x2","1"); grad.setAttribute("y2","0");
  const st1 = document.createElementNS(svgNS,"stop"); st1.setAttribute("offset","0%");  st1.setAttribute("stop-color","#f2dca0");
  const st2 = document.createElementNS(svgNS,"stop"); st2.setAttribute("offset","100%"); st2.setAttribute("stop-color","#b8913d");
  grad.appendChild(st1); grad.appendChild(st2); defs.appendChild(grad); svg.appendChild(defs);

  // ---------------- Build columns & nodes ----------------
  const colTitles = [];
  const nodeRefs  = [];         // {el, colIdx, nodeIdx, x, y}
  const nodesByCol= DATA.columns.map(()=>[]);

  DATA.columns.forEach((col, ci)=>{
    const cap = document.createElement("div");
    cap.className = "proc-col-title";
    cap.textContent = `${col.emoji} ${col.label}`;
    canvas.appendChild(cap);
    colTitles.push(cap);

    col.nodes.forEach((n, ni)=>{
      const el = document.createElement("button");
      el.className = "proc-node";
      el.dataset.col  = col.id;
      el.dataset.node = n.id;
      el.innerHTML = `<span class="ico">${n.emoji}</span>${n.label}`;
      canvas.appendChild(el);
      const ref = { el, colIdx:ci, nodeIdx:ni, x:0, y:0 };
      nodeRefs.push(ref);
      nodesByCol[ci].push(ref);
    });
  });

  // Result card
  const res = document.createElement("div");
  res.className = "proc-result";
  res.innerHTML = `<h4>🎯 ${DATA.result.title}</h4>
    <ul>${DATA.result.bullets.map(b=>`<li>${b}</li>`).join("")}</ul>`;
  canvas.appendChild(res);

  // ---------------- Layout ----------------
  let W=0, H=0, leftPad=24, rightPad=24, topPad=18, bottomPad=18;
  let colXs = [];

  function layout(){
    const r = stage.getBoundingClientRect();
    W = r.width; H = Math.max(520, r.height); // guarantee height for sticky area
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // horizontal track: four columns equally spaced
    const cols = DATA.columns.length;
    const trackLeft  = 28;
    const trackRight = W - 28;
    const usableW = Math.max(260, trackRight - trackLeft);
    colXs = Array.from({length: cols}, (_,i)=> trackLeft + (usableW)*(i/(cols-1)));

    // column titles near the top of each column
    colTitles.forEach((el,i)=>{
      const x = colXs[i];
      const y = 60; // title row
      el.style.left = x + "px";
      el.style.top  = y + "px";
    });

    // nodes: stack each column vertically with even spacing
    const bandTop = 120;
    const bandBot = H - 140;
    const bandsH  = Math.max(220, bandBot - bandTop);

    DATA.columns.forEach((col, ci)=>{
      const list = nodesByCol[ci];
      const count = list.length || 1;
      const gap = count>1 ? (bandsH - 16) / (count - 1) : 0;
      list.forEach((ref, idx)=>{
        ref.x = colXs[ci];
        ref.y = bandTop + idx*gap;
        ref.el.style.left = ref.x + "px";
        ref.el.style.top  = ref.y + "px";
      });
    });

    // result card sits after the last column mid-band
    const resX = colXs[colXs.length-1] + 140;
    const resY = bandTop + bandsH*0.55;
    res.style.left = resX + "px";
    res.style.top  = resY + "px";

    // redraw links for current state
    drawLinks(currentColId);
  }

  // ---------------- Links drawing ----------------
  function wipeSVG(){
    // keep <defs>, clear the rest
    const keep = defs;
    while (svg.lastChild) {
      if (svg.lastChild === keep) break;
      svg.removeChild(svg.lastChild);
    }
    // Now remove all after defs
    while (defs.nextSibling) svg.removeChild(defs.nextSibling);
  }

  function bezierPath(ax, ay, bx, by){
    // curved slightly toward the bottom for a calm flow
    const dx = bx - ax;
    const c1x = ax + dx*0.35, c1y = ay + 60;
    const c2x = bx - dx*0.35, c2y = by + 60;
    return `M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`;
  }

  function drawLinks(colId){
    wipeSVG();
    if (!colId) return;

    const idx = DATA.columns.findIndex(c=>c.id===colId);
    if (idx < 0) return;

    const from = nodesByCol[idx];
    const to   = nodesByCol[idx+1] || nodesByCol[idx-1];
    if (!from || !to) return;

    // base (thin) links
    from.forEach(a=>{
      to.forEach(b=>{
        const p = document.createElementNS(svgNS,"path");
        p.setAttribute("d", bezierPath(a.x,a.y,b.x,b.y));
        svg.appendChild(p);
      });
    });

    // highlight overlay (thicker, gradient)
    const overlay = document.createElementNS(svgNS,"path");
    // pick a representative mid path (median pair)
    const a = from[Math.floor(from.length/2)];
    const b = to[Math.floor(to.length/2)];
    overlay.setAttribute("d", bezierPath(a.x,a.y,b.x,b.y));
    overlay.setAttribute("stroke", "url(#procLineGrad)");
    overlay.setAttribute("fill", "none");
    svg.appendChild(overlay);
  }

  // ---------------- Interaction / state ----------------
  const stepEls = Array.from(rail.querySelectorAll(".proc-step"));
  const stepById = Object.fromEntries(stepEls.map(el=>[el.dataset.step, el]));
  let currentColId = "intent";

  function setActive(colId){
    currentColId = colId || null;

    // Right rail bullets
    stepEls.forEach(s=>s.classList.remove("is-current","is-done"));
    let passed=true;
    stepEls.forEach(s=>{
      if (passed && s.dataset.step!==colId) s.classList.add("is-done");
      else passed=false;
    });
    if (colId && stepById[colId]) stepById[colId].classList.add("is-current");

    // Node emphasis
    nodeRefs.forEach(n=>{
      const active = DATA.columns[n.colIdx]?.id===colId;
      n.el.style.opacity = active ? "1" : (colId ? ".38" : "1");
      n.el.style.filter  = active ? "none" : (colId ? "grayscale(.2)" : "none");
    });

    drawLinks(currentColId);
  }

  // progress spine
  function updateProgress(){
    const r = rail.getBoundingClientRect();
    const vh = window.innerHeight;
    const t = Math.max(0, Math.min(1, (vh*0.15 - r.top) / (r.height - vh*0.3)));
    prog.style.height = (t * r.height) + "px";
  }

  // observe rail steps
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if (!e.isIntersecting) return;
      const id = e.target.dataset.step;
      if (id==="intro" || id==="result"){ setActive(null); }
      else setActive(id);
      updateProgress();
    });
  }, { threshold: 0.55 });
  stepEls.forEach(el=>io.observe(el));

  // node click -> scroll its step into view
  nodeRefs.forEach(n=>{
    n.el.addEventListener("click",(ev)=>{
      ev.preventDefault();
      const colId = DATA.columns[n.colIdx].id;
      const tgt = stepById[colId];
      if (tgt) tgt.scrollIntoView({behavior:"smooth", block:"center"});
    });
  });

  // initial paint
  layout();
  setActive("intent");
  updateProgress();
  window.addEventListener("resize", layout, { passive:true });
})();