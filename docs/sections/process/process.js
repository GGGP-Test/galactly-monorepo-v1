// docs/sections/process/process.js  (FLOWGRID v2 – arrows + clean layout)
// Mounts into <div id="section-process"></div>
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------------- DATA ----------------
  // If you ship process.data.js with window.PROC_DATA, we’ll use it. Otherwise we fall back.
  const D = (window.PROC_DATA && typeof window.PROC_DATA === "object") ? window.PROC_DATA : {
    title: "How the scoring engine works",
    sub: "We score each lead across four lenses, then surface the fastest wins.",
    lanes: [
      {
        id: "intent", label: "Intent Score", emoji: "⚡",
        items: [
          ["🔎","Search velocity"],
          ["🛠️","Warehouse tech"],
          ["📈","Customer LTV/CAC"],
          ["🧰","Tools interacted"],
          ["🏢","Company size"]
        ]
      },
      {
        id: "weight", label: "Weight Score", emoji: "⚖️",
        items: [
          ["🗞️","Posting behaviour"],
          ["🎁","Offers / lead magnets"],
          ["🏭","Nature of business"],
          ["🔁","Purchase frequency"]
        ]
      },
      {
        id: "character", label: "Character Score", emoji: "🧠",
        items: [
          ["⭐","Past reviews"],
          ["↔️","Vendor switching"],
          ["💬","Language → values"],
          ["🌐","Language → culture"]
        ]
      },
      {
        id: "platform", label: "Platform Score", emoji: "📡",
        items: [
          ["🗂️","# posts / platform"],
          ["💬","# comments / platform"],
          ["✉️","Intent to respond"]
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
      { id: "intro", title: "Score System", body: "We only advance leads that match your persona." },
      { id: "intent", title: "Intent score", body: "How fast they’re likely to buy." },
      { id: "weight", title: "Weight score", body: "How commercially meaningful they are." },
      { id: "character", title: "Character score", body: "How they behave with suppliers & customers." },
      { id: "platform", title: "Platform score", body: "Where they’ll most likely reply first." },
      { id: "result", title: "Result", body: "Prioritised list with the reasoning attached." }
    ]
  };

  // ---------------- DOM ----------------
  const railStepsHTML = D.steps.map(s => `
    <div class="proc-step" data-step="${s.id}">
      <span class="proc-bullet"></span>
      <h3>${s.title}</h3>
      <p>${s.body}</p>
    </div>`).join("");

  mount.innerHTML = `
  <section class="proc-section" aria-label="Process">
    <div class="proc-inner">
      <header class="proc-hd">
        <h2>${D.title}</h2>
        <div class="sub">${D.sub}</div>
      </header>

      <div class="lanes-wrap" style="position:relative">
        <div class="lanes-board" id="lanesBoard">
          <div class="lanes-head">
            ${D.lanes.map(l => `
              <button class="lens-tag" data-lane-tag="${l.id}" aria-controls="lane-${l.id}">
                <span class="ico">${l.emoji}</span> ${l.label}
              </button>`).join("")}
          </div>
          ${D.lanes.map(l => `
            <div class="lane" id="lane-${l.id}" data-lane="${l.id}">
              ${l.items.map(([ico, label]) => `
                <button class="chip" data-chip-lane="${l.id}">
                  <span class="ico">${ico}</span><span>${label}</span>
                </button>`).join("")}
            </div>`).join("")}
          <div class="lane" id="lane-result" data-lane="result">
            <div class="chip"><strong>🎯 ${D.result.title}</strong>
              <ul style="margin:6px 0 0 18px; padding:0; color:#bcd0e2">
                ${D.result.bullets.map(b=>`<li style="margin:2px 0">${b}</li>`).join("")}
              </ul>
            </div>
          </div>
        </div>
        <svg id="lanesSvg" class="lanes-svg" width="0" height="0"
             style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible"></svg>
      </div>

      <aside class="proc-rail" id="procRail">
        <div class="proc-progress" id="procProg"></div>
        ${railStepsHTML}
      </aside>
    </div>
  </section>`;

  const board = document.getElementById("lanesBoard");
  const svg = document.getElementById("lanesSvg");
  const rail = document.getElementById("procRail");
  const prog = document.getElementById("procProg");

  const laneEls = D.lanes.map(l => document.getElementById(`lane-${l.id}`));
  const tagEls  = D.lanes.map(l => document.querySelector(`[data-lane-tag="${l.id}"]`));

  // ---------------- Helpers: geometry + arrows ----------------
  function rectIn(el, root) {
    const a = el.getBoundingClientRect();
    const b = root.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }
  function midRight(r){ return [r.x + r.w, r.y + r.h/2]; }
  function midLeft(r){ return [r.x, r.y + r.h/2]; }

  function clearSvg(){ while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function pathEl(cls, d){
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("class", cls);
    p.setAttribute("d", d);
    p.setAttribute("fill","none");
    p.setAttribute("stroke","url(#lg)");
    p.setAttribute("stroke-width","1.6");
    p.setAttribute("opacity","0.65");
    p.setAttribute("vector-effect","non-scaling-stroke");
    return p;
  }
  function ensureDefs(){
    if (svg.querySelector("defs")) return;
    const defs = document.createElementNS("http://www.w3.org/2000/svg","defs");
    const lg = document.createElementNS("http://www.w3.org/2000/svg","linearGradient");
    lg.setAttribute("id","lg"); lg.setAttribute("x1","0"); lg.setAttribute("x2","1"); lg.setAttribute("y1","0"); lg.setAttribute("y2","0");
    const c1 = document.createElementNS(lg.namespaceURI,"stop"); c1.setAttribute("offset","0%"); c1.setAttribute("stop-color","#f2dca0");
    const c2 = document.createElementNS(lg.namespaceURI,"stop"); c2.setAttribute("offset","100%"); c2.setAttribute("stop-color","#b8913d");
    lg.appendChild(c1); lg.appendChild(c2); defs.appendChild(lg); svg.appendChild(defs);
  }

  function curve([x1,y1],[x2,y2], bend=0.24){
    const dx = (x2-x1), dy = (y2-y1);
    const c1x = x1 + dx * 0.35, c1y = y1 + dy * bend;
    const c2x = x2 - dx * 0.35, c2y = y2 - dy * bend;
    return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
  }

  function drawHeaderArrows(){
    ensureDefs(); clearSvg();
    // arrows from each header → next header (clean spine)
    for (let i=0;i<tagEls.length-1;i++){
      const a = rectIn(tagEls[i], board);
      const b = rectIn(tagEls[i+1], board);
      const p = pathEl("a-head", curve( midRight(a), midLeft(b), 0.18 ));
      svg.appendChild(p);
    }
  }

  function drawLaneFlow(activeIdx){
    drawHeaderArrows();
    if (activeIdx<0 || activeIdx>=laneEls.length-1) return;
    // connect chips by index from lane A -> next lane B
    const A = Array.from(laneEls[activeIdx].querySelectorAll(".chip"));
    const B = Array.from(laneEls[activeIdx+1].querySelectorAll(".chip"));
    const n = Math.min(A.length, B.length);
    for (let i=0;i<n;i++){
      const ra = rectIn(A[i], board);
      const rb = rectIn(B[i], board);
      const p = pathEl("a-chip", curve( midRight(ra), midLeft(rb), 0.28 ));
      p.setAttribute("opacity","0.5");
      svg.appendChild(p);
    }
  }

  // ---------------- Right-rail sync ----------------
  const stepEls = Array.from(rail.querySelectorAll(".proc-step"));
  const stepMap = Object.fromEntries(stepEls.map(el=>[el.dataset.step, el]));

  function setActive(laneId){
    // rail state
    stepEls.forEach(s=>s.classList.remove("is-current","is-done"));
    let passed = true;
    for (const s of stepEls){
      if (passed && s.dataset.step!==laneId) s.classList.add("is-done");
      else { passed=false; }
    }
    if (laneId && stepMap[laneId]) stepMap[laneId].classList.add("is-current");

    // lane emphasis
    laneEls.forEach(el=>{
      const on = (`lane-${laneId}` === el.id);
      el.classList.toggle("is-active", on);
    });

    // arrows
    const idx = D.lanes.findIndex(l=>l.id===laneId);
    drawLaneFlow(idx);
  }

  // progress bar
  function updateProgress(){
    const r = rail.getBoundingClientRect();
    const vh = innerHeight;
    const t = Math.max(0, Math.min(1, (vh*0.15 - r.top) / (r.height - vh*0.3)));
    prog.style.height = (t * r.height) + "px";
  }

  const io = new IntersectionObserver((entries)=>{
    for (const e of entries){
      if (!e.isIntersecting) continue;
      const id = e.target.dataset.step;
      if (id==="intro" || id==="result"){ drawHeaderArrows(); laneEls.forEach(el=>el.classList.remove("is-active")); }
      else setActive(id);
      updateProgress();
    }
  },{threshold:0.55});
  stepEls.forEach(el=>io.observe(el));

  // ---------------- Interactions ----------------
  // Clicking a lane header or chip scrolls to its explanation
  [...tagEls, ...board.querySelectorAll(".chip")].forEach(el=>{
    el.addEventListener("click", (ev)=>{
      const laneId = el.getAttribute("data-lane-tag") || el.getAttribute("data-chip-lane");
      const tgt = stepMap[laneId];
      if (tgt) tgt.scrollIntoView({behavior:"smooth", block:"center"});
    });
  });

  // Recalculate arrows on resize / fonts ready
  function refresh(){
    // size svg to board
    const r = board.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${Math.max(10, r.width)} ${Math.max(10, r.height)}`);
    drawHeaderArrows();
    const cur = document.querySelector(".proc-step.is-current");
    const id = cur ? cur.dataset.step : "intent";
    setActive(id);
  }
  addEventListener("resize", refresh, {passive:true});
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(refresh); }
  setTimeout(refresh, 80);

  // Initial state
  setActive("intent");
  updateProgress();
})();