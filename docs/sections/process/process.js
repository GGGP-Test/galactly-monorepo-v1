// docs/sections/process/process.js  (defensive build)
// Mounts into <div id="section-process"></div>
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- safe data ingest ----------
  function getProcessData() {
    try {
      const PD = window.PROCESS_DATA;
      if (typeof PD === "function") {
        const v = PD();
        if (v && typeof v === "object") return v;
      }
      if (PD && typeof PD === "object") return PD;
    } catch (e) {
      console.warn("[process] PROCESS_DATA error:", e);
    }
    return null;
  }

  // sensible complete defaults (so UI always renders)
  const DEFAULTS = {
    theme: { bg:"#0b1119", text:"#e9f1f7", muted:"#97a9bc", primary:"#E6C36B", secondary:"#7FB2FF", tertiary:"#F471B5" },
    title: "How the scoring engine works",
    sub: "We score each lead across four lenses, then surface the fastest wins.",
    columns: [
      { id:"intent", label:"Intent Score", emoji:"⚡", nodes:[
        {id:"search",emoji:"🔎",label:"Search velocity"},
        {id:"ltv",emoji:"📈",label:"Customer LTV/CAC"},
        {id:"size",emoji:"🏢",label:"Company size"},
        {id:"tech",emoji:"🛠️",label:"Warehouse tech"},
        {id:"tools",emoji:"🧰",label:"Tools interacted"},
      ]},
      { id:"weight", label:"Weight Score", emoji:"⚖️", nodes:[
        {id:"post",emoji:"📰",label:"Posting behaviour"},
        {id:"goodwill",emoji:"🎁",label:"Offers / lead magnets"},
        {id:"nature",emoji:"🏭",label:"Nature of business"},
        {id:"freq",emoji:"🔁",label:"Purchase frequency"},
      ]},
      { id:"character", label:"Character Score", emoji:"🧠", nodes:[
        {id:"reviews",emoji:"⭐",label:"Past reviews"},
        {id:"jumps",emoji:"↔️",label:"Vendor switching"},
        {id:"values",emoji:"💬",label:"Language → values"},
        {id:"culture",emoji:"🌐",label:"Language → culture"},
      ]},
      { id:"platform", label:"Platform Score", emoji:"📡", nodes:[
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

  // merge with strong defaults
  const RAW = getProcessData() || {};
  const D = {
    ...DEFAULTS,
    ...RAW,
    theme: { ...DEFAULTS.theme, ...(RAW.theme||{}) },
    columns: Array.isArray(RAW.columns) && RAW.columns.length ? RAW.columns : DEFAULTS.columns,
    steps: Array.isArray(RAW.steps) && RAW.steps.length ? RAW.steps : DEFAULTS.steps,
    result: { ...DEFAULTS.result, ...(RAW.result||{}) }
  };

  // ---------- theme vars ----------
  const setVar = (k,v)=> mount.style.setProperty(k,v);
  setVar("--p-bg", D.theme.bg);
  setVar("--p-text", D.theme.text);
  setVar("--p-muted", D.theme.muted);
  setVar("--p-primary", D.theme.primary);
  setVar("--p-secondary", D.theme.secondary);
  setVar("--p-tertiary", D.theme.tertiary);

  // ---------- markup ----------
  const railStepsHTML = (D.steps||[]).map(s=>`
    <div class="proc-step" data-step="${s.id}">
      <h3>${s.title}</h3><p>${s.body||""}</p>
    </div>`).join("");

  const laneHTML = (col)=> {
    const chips = (col.nodes||[]).map(n=>`
      <button class="p-chip" data-col="${col.id}" data-node="${n.id}">
        <span class="ico">${n.emoji||""}</span>${n.label||""}
      </button>`).join("");
    return `
      <div class="p-lane" data-col="${col.id}">
        <div class="p-lane-hd"><span class="badge">${col.emoji||""} ${col.label||""}</span></div>
        ${chips}
      </div>`;
  };

  mount.innerHTML = `
  <section class="proc-section">
    <div class="proc-inner">
      <header class="proc-hd">
        <h2>${D.title||""}</h2>
        <div class="sub">${D.sub||""}</div>
      </header>

      <div class="p-wrap">
        <aside class="p-dock" id="pDock">
          <div class="p-stepper" id="pStepper"></div>
          <div class="p-ctas">
            <button class="btn-glass" id="pPrev" type="button">Prev step</button>
            <button class="btn-glass" id="pNext" type="button">Next step</button>
          </div>
        </aside>

        <div class="p-board" id="pBoard">
          <svg id="pSvg" class="proc-svg" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
          <div class="p-lanes" id="pLanes">
            ${(D.columns||[]).map(laneHTML).join("")}
          </div>
          <div class="p-result" id="pResult">
            <h4>🎯 ${(D.result&&D.result.title)||"Result"}</h4>
            <ul>${((D.result&&D.result.bullets)||[]).map(x=>`<li>${x}</li>`).join("")}</ul>
          </div>
        </div>
      </div>

      <aside class="proc-rail">${railStepsHTML}</aside>
    </div>
  </section>`;

  // ---------- refs ----------
  const stepper = mount.querySelector("#pStepper");
  const prevBtn = mount.querySelector("#pPrev");
  const nextBtn = mount.querySelector("#pNext");
  const dock    = mount.querySelector("#pDock");
  const board   = mount.querySelector("#pBoard");
  const svg     = mount.querySelector("#pSvg");
  const lanesEl = mount.querySelector("#pLanes");
  const resultEl= mount.querySelector("#pResult");

  // ---------- stepper build ----------
  const N = (D.columns||[]).length;
  const LAST = 2 + N; // idle=0, overview=1, lanes=2..1+N, result=last
  const stepDots = [];
  for (let i=1;i<=LAST;i++){
    const el = document.createElement("div");
    el.className = "p-step";
    const name = (i===1) ? "Overview" : (i<=1+N ? (D.columns[i-2]?.label||`Step ${i}`) : "Result");
    el.innerHTML = `<div class="p-dot">${i}</div><div class="p-label">${name}</div>`;
    stepper.appendChild(el);
    stepDots.push(el);
    el.addEventListener("click", ()=> setStep(i));
  }

  // ---------- node index ----------
  const laneNodes = Array.from(lanesEl.querySelectorAll(".p-lane")).map((lane, ci)=>({
    el: lane,
    colIdx: ci,
    colId: D.columns[ci]?.id || "",
    chips: Array.from(lane.querySelectorAll(".p-chip")).map(ch=>({ el: ch, colIdx: ci, id: ch.dataset.node }))
  }));

  // ---------- svg wires ----------
  let W=0,H=0, rect=null;
  function sizeSVG(){
    rect = board.getBoundingClientRect();
    W = Math.max(1, rect.width); H = Math.max(1, rect.height);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  }
  function centerOf(el){
    const r = el.getBoundingClientRect();
    return { x: (r.left+r.right)/2 - rect.left, y: (r.top+r.bottom)/2 - rect.top };
  }
  function clearSVG(){ while(svg.firstChild) svg.removeChild(svg.firstChild); }
  function drawLink(a,b,dim=false){
    const ax=a.x, ay=a.y, bx=b.x, by=b.y, vx=bx-ax, vy=by-ay;
    const c1x=ax+vx*0.30, c1y=ay+vy*0.10, c2x=ax+vx*0.70, c2y=ay+vy*0.90;
    const p=document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("class","proc-cable"+(dim?" is-dim":""));
    p.setAttribute("d",`M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`);
    p.style.setProperty("--pulse",(2000+Math.random()*1200)+"ms");
    svg.appendChild(p);
  }
  function drawPairs(iA,iB,dense=false){
    const A = laneNodes[iA]?.chips.map(c=>({el:c.el,...centerOf(c.el)}))||[];
    const B = laneNodes[iB]?.chips.map(c=>({el:c.el,...centerOf(c.el)}))||[];
    const maxLines = dense ? 28 : 16;
    let count = 0;
    for (let i=0;i<A.length;i++){
      if (!B.length) break;
      const bi = i % B.length;
      drawLink(A[i], B[bi], false); count++;
      if (count>=maxLines) break;
      const r = Math.floor(Math.random()*B.length);
      if (r!==bi){ drawLink(A[i], B[r], true); count++; }
      if (count>=maxLines) break;
    }
  }

  // ---------- state / behaviour ----------
  let step = 0;
  function setStep(n){
    step = Math.max(0, Math.min(LAST, n|0));
    stepDots.forEach((el,i)=>{ el.classList.toggle("is-current", i+1===step); el.classList.toggle("is-done", i+1<step); });
    prevBtn.disabled = step<=1; nextBtn.disabled = step>=LAST;
    if (step>=1) dock.classList.add("is-open");
    applyFocus(); redraw();
  }
  function applyFocus(){
    const laneIdx = (step>=2 && step<=1+N) ? (step-2) : -1;
    laneNodes.forEach((ln,i)=>{
      const on = (laneIdx<0 || i===laneIdx);
      ln.el.style.opacity = on ? "1" : ".35";
      ln.el.style.filter  = on ? "none" : "grayscale(.15)";
      ln.chips.forEach(c=> c.el.classList.toggle("is-focus", i===laneIdx));
    });
    resultEl.style.opacity = (step===LAST) ? "1" : (laneIdx<0?".95":".75");
  }
  function redraw(){
    sizeSVG(); clearSVG();
    if (step===0){ board.style.opacity=".85"; return; }
    board.style.opacity="1";
    if (N<=1) return;
    if (step===1){ for (let i=0;i<N-1;i++) drawPairs(i,i+1,i===0); return; }
    if (step>=2 && step<=1+N){
      const a=step-2;
      if (a>0) drawPairs(a-1,a,true);
      if (a<N-1) drawPairs(a,a+1,true);
      return;
    }
  }

  prevBtn.addEventListener("click", ()=>setStep(step-1));
  nextBtn.addEventListener("click", ()=>setStep(step+1));
  laneNodes.forEach((ln,idx)=> ln.chips.forEach(c=> c.el.addEventListener("click",(e)=>{ e.preventDefault(); setStep(2+idx); })));

  // initial
  sizeSVG(); setStep(0);
})();