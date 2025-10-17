// docs/sections/process/process.js
// Mounts into <div id="section-process"></div>
// Works with docs/sections/process/process.data.js and process.css
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- DATA ----------
  const D = (window.PROCESS_DATA && typeof window.PROCESS_DATA === "object")
    ? window.PROCESS_DATA
    : {
        theme: {
          bg: "#0b1119",
          text: "#e9f1f7",
          muted: "#97a9bc",
          primary: "#E6C36B",
          secondary: "#7FB2FF",
          tertiary: "#F471B5",
        },
        title: "How the scoring engine works",
        sub: "We score each lead across four lenses, then surface the fastest wins.",
        columns: [
          { id: "intent", label: "Intent Score", emoji: "⚡", nodes: [
            {id:"search",emoji:"🔎",label:"Search velocity"},
            {id:"ltv",emoji:"📈",label:"Customer LTV/CAC"},
            {id:"size",emoji:"🏢",label:"Company size"},
            {id:"tech",emoji:"🛠️",label:"Warehouse tech"},
            {id:"tools",emoji:"🧰",label:"Tools interacted"},
          ]},
          { id: "weight", label: "Weight Score", emoji: "⚖️", nodes: [
            {id:"post",emoji:"📰",label:"Posting behaviour"},
            {id:"goodwill",emoji:"🎁",label:"Offers / lead magnets"},
            {id:"nature",emoji:"🏭",label:"Nature of business"},
            {id:"freq",emoji:"🔁",label:"Purchase frequency"},
          ]},
          { id: "character", label: "Character Score", emoji: "🧠", nodes: [
            {id:"reviews",emoji:"⭐",label:"Past reviews"},
            {id:"jumps",emoji:"↔️",label:"Vendor switching"},
            {id:"values",emoji:"💬",label:"Language → values"},
            {id:"culture",emoji:"🌐",label:"Language → culture"},
          ]},
          { id: "platform", label: "Platform Score", emoji: "📡", nodes: [
            {id:"posts",emoji:"🗂️",label:"# posts / platform"},
            {id:"comments",emoji:"💬",label:"# comments / platform"},
            {id:"reply",emoji:"✉️",label:"Intent to respond"},
          ]},
        ],
        result: {
          title:"Result",
          bullets:["Fastest-to-buy window","Likely retention horizon","Advocacy potential","Best first contact channel"]
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

  // ---------- THEME → CSS VARS ----------
  const setVar = (k, v) => mount.style.setProperty(k, v);
  setVar("--p-bg", D.theme.bg || "#0b1119");
  setVar("--p-text", D.theme.text || "#e9f1f7");
  setVar("--p-muted", D.theme.muted || "#97a9bc");
  setVar("--p-primary", D.theme.primary || "#E6C36B");
  setVar("--p-secondary", D.theme.secondary || "#7FB2FF");
  setVar("--p-tertiary", D.theme.tertiary || "#F471B5");

  // ---------- MARKUP ----------
  const railStepsHTML = D.steps.map(s => `
    <div class="proc-step" data-step="${s.id}">
      <h3>${s.title}</h3>
      <p>${s.body}</p>
    </div>`).join("");

  function laneHTML(col){
    const chips = col.nodes.map(n => `
      <button class="p-chip" data-col="${col.id}" data-node="${n.id}" aria-label="${n.label}">
        <span class="ico">${n.emoji||""}</span>${n.label}
      </button>`).join("");
    return `
      <div class="p-lane" data-col="${col.id}">
        <div class="p-lane-hd"><span class="badge">${col.emoji||""} ${col.label}</span></div>
        ${chips}
      </div>`;
  }

  mount.innerHTML = `
  <section class="proc-section">
    <div class="proc-inner">
      <header class="proc-hd">
        <h2>${D.title}</h2>
        <div class="sub">${D.sub}</div>
      </header>

      <div class="p-wrap">
        <aside class="p-dock" id="pDock" aria-label="Process steps">
          <div class="p-stepper" id="pStepper"></div>
          <div class="p-ctas">
            <button class="btn-glass" id="pPrev" type="button" aria-label="Previous step">Prev step</button>
            <button class="btn-glass" id="pNext" type="button" aria-label="Next step">Next step</button>
          </div>
        </aside>

        <div class="p-board" id="pBoard" aria-label="Flow board">
          <svg id="pSvg" class="proc-svg" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
          <div class="p-lanes" id="pLanes">
            ${D.columns.map(laneHTML).join("")}
          </div>
          <div class="p-result" id="pResult">
            <h4>🎯 ${D.result.title}</h4>
            <ul>${(D.result.bullets||[]).map(x=>`<li>${x}</li>`).join("")}</ul>
          </div>
        </div>
      </div>

      <aside class="proc-rail">${railStepsHTML}</aside>
    </div>
  </section>`;

  // ---------- EL REFS ----------
  const stepper = mount.querySelector("#pStepper");
  const prevBtn  = mount.querySelector("#pPrev");
  const nextBtn  = mount.querySelector("#pNext");
  const dock     = mount.querySelector("#pDock");
  const lanesEl  = mount.querySelector("#pLanes");
  const board    = mount.querySelector("#pBoard");
  const svg      = mount.querySelector("#pSvg");
  const resultEl = mount.querySelector("#pResult");

  // ---------- STEPPER ----------
  // We model steps like:
  // 0 = idle (numbers only, board dim)
  // 1 = overview (show all)
  // 2..(1+N) = lane focus (by column order)
  // last = result focus
  const N = D.columns.length;
  const LAST = 2 + N; // [0 idle] [1 overview] [2..1+N lanes] [last result]
  const stepDots = [];
  for (let i = 1; i <= LAST; i++) {
    const el = document.createElement("div");
    el.className = "p-step";
    el.innerHTML = `<div class="p-dot">${i}</div><div class="p-label">${i===1?"Overview":(i<=1+N?D.columns[i-2].label:"Result")}</div>`;
    stepper.appendChild(el);
    stepDots.push(el);
    el.addEventListener("click", ()=> setStep(i));
  }

  // ---------- NODES INDEX ----------
  const laneNodes = Array.from(lanesEl.querySelectorAll(".p-lane")).map((lane, ci) => {
    const colId = D.columns[ci].id;
    const chips = Array.from(lane.querySelectorAll(".p-chip")).map(ch => ({
      el: ch, colIdx: ci, id: ch.dataset.node
    }));
    return { el: lane, colIdx: ci, colId, chips };
  });

  // ---------- SVG CABLES ----------
  let W=0,H=0, boardRect=null;
  function sizeSVG(){
    boardRect = board.getBoundingClientRect();
    W = boardRect.width; H = boardRect.height;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  }
  sizeSVG(); addEventListener("resize", ()=>{ sizeSVG(); layoutAndDraw(); }, {passive:true});

  function centerOf(el){
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.right)/2 - boardRect.left, y: (r.top + r.bottom)/2 - boardRect.top };
  }
  function clearSVG(){ while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function drawLink(a, b, dim=false){
    const ax=a.x, ay=a.y, bx=b.x, by=b.y;
    const vx = (bx-ax), vy=(by-ay);
    const c1x = ax + vx*0.30, c1y = ay + vy*0.10;
    const c2x = ax + vx*0.70, c2y = ay + vy*0.90;
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("class", "proc-cable" + (dim?" is-dim":""));
    p.setAttribute("d", `M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`);
    p.style.setProperty("--pulse", (2000 + Math.random()*1200) + "ms");
    svg.appendChild(p);
  }
  function drawPairs(colA, colB, dense=false){
    const A = laneNodes[colA].chips.map(c=>({el:c.el, ...centerOf(c.el)}));
    const B = laneNodes[colB].chips.map(c=>({el:c.el, ...centerOf(c.el)}));
    const maxLines = dense ? 28 : 16;
    let count = 0;
    for (let i=0;i<A.length;i++){
      // pair in order and a few cross pairs for organic feel
      const bi = Math.min(B.length-1, i % B.length);
      drawLink(A[i], B[bi], false); count++;
      if (count >= maxLines) break;
      const rand = Math.floor(Math.random()*B.length);
      if (rand !== bi){ drawLink(A[i], B[rand], true); count++; }
      if (count >= maxLines) break;
    }
  }

  // ---------- STATE ----------
  let step = 0; // idle
  const noMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setStep(next){
    step = Math.max(0, Math.min(LAST, next|0));
    // stepper visuals
    stepDots.forEach((el, i) => {
      el.classList.toggle("is-current", i+1 === step);
      el.classList.toggle("is-done", i+1 < step);
    });
    prevBtn.disabled = step <= 1;
    nextBtn.disabled = step >= LAST;

    // First interaction opens labels (numbers-only → labeled)
    if (step >= 1) dock.classList.add("is-open");

    applyFocus();
    layoutAndDraw();
  }

  function applyFocus(){
    // lane emphasis
    const activeLane = (step>=2 && step<=1+N) ? (step-2) : -1;
    laneNodes.forEach((ln, idx) => {
      ln.el.style.opacity = (activeLane < 0 || idx === activeLane) ? "1" : ".35";
      ln.el.style.filter  = (activeLane < 0 || idx === activeLane) ? "none" : "grayscale(.15)";
      ln.chips.forEach(c => c.el.classList.toggle("is-focus", idx === activeLane));
    });
    // result emphasis
    resultEl.style.opacity = (step===LAST) ? "1" : (activeLane<0 ? ".95" : ".75");
  }

  function layoutAndDraw(){
    if (!board.isConnected) return;
    sizeSVG(); clearSVG();
    if (step === 0){ // idle – board dim, no cables
      board.style.opacity = ".85";
      return;
    }
    board.style.opacity = "1";

    if (step === 1){
      // Overview: draw light cables between each adjacent column, denser from 1→2
      for (let i=0;i<N-1;i++) drawPairs(i, i+1, i===0);
      return;
    }
    if (step >= 2 && step <= 1+N){
      const a = step-2;
      const hasNext = a < N-1, hasPrev = a > 0;
      if (hasPrev) drawPairs(a-1, a, true);
      if (hasNext) drawPairs(a, a+1, true);
      return;
    }
    if (step === LAST){
      // Result focus: faint all lanes, no new cables (keep minimal)
      return;
    }
  }

  // ---------- CTAS ----------
  prevBtn.addEventListener("click", () => setStep(step-1));
  nextBtn.addEventListener("click", () => setStep(step+1));

  // Clicking a chip jumps to its lane
  laneNodes.forEach((ln, idx) => {
    ln.chips.forEach(c => c.el.addEventListener("click",(e)=>{ e.preventDefault(); setStep(2+idx); }));
  });

  // ---------- RAIL SYNC (right copy) ----------
  const railSteps = Array.from(mount.querySelectorAll(".proc-step"));
  const byId = Object.fromEntries(D.steps.map(s => [s.id, s]));
  function syncRail(){
    railSteps.forEach(el => el.classList.remove("is-current"));
    if (step===1){ mount.querySelector('.proc-step[data-step="intro"]')?.classList.add("is-current"); return; }
    if (step>=2 && step<=1+N){
      const id = D.columns[step-2].id; mount.querySelector(`.proc-step[data-step="${id}"]`)?.classList.add("is-current"); return;
    }
    if (step===LAST){ mount.querySelector(`.proc-step[data-step="result"]`)?.classList.add("is-current"); }
  }

  // keep rail in sync whenever we change step
  const _setStep = setStep;
  setStep = function(n){ _setStep(n); syncRail(); };
  // kick off in idle; first user click reveals overview
  setStep(0);
  if (noMotion) setTimeout(()=>setStep(1), 60); // accessibility: show overview immediately if reduced motion

})();