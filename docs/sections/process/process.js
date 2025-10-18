// docs/sections/process/process.js
// STEP 1 → STEP 2: numbers-only rail, then reveal the neon workflow on step==1
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // --------- STYLES (scoped) ---------
  const css = `
  #section-process .proc-shell{padding:72px 16px}
  #section-process .proc-inner{max-width:1140px;margin:0 auto;
    display:grid;grid-template-columns:260px 1fr;gap:28px;align-items:start}
  @media (max-width:900px){
    #section-process .proc-inner{grid-template-columns:1fr}
  }
  #section-process .proc-hd h2{margin:0 0 8px;font:600 clamp(22px,3.4vw,30px) "Newsreader", Georgia, serif}
  #section-process .proc-hd .sub{color:#9cb1c3}

  /* rail: numbers only (glass) */
  #section-process .p-dock{position:relative; transition:width .35s ease}
  #section-process.stage-1 .proc-inner{grid-template-columns:160px 1fr}
  #section-process .p-stepper{display:flex;flex-direction:column;align-items:center;gap:18px;padding:12px 0}
  #section-process .p-step{display:grid;place-items:center; width:56px;height:56px;border-radius:999px;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10); backdrop-filter: blur(6px);
    box-shadow:0 6px 18px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.04);
    font:700 18px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#eaf0f6; cursor:pointer; user-select:none;
    transition:transform .15s ease, box-shadow .15s ease, background .15s ease}
  #section-process .p-step:hover{transform:translateY(-1px); background:rgba(255,255,255,.08)}
  #section-process .p-step.is-current{box-shadow:0 0 0 2px rgba(230,195,107,.75), 0 10px 28px rgba(230,195,107,.18)}
  #section-process .p-step.is-done{opacity:.7}

  /* glass buttons */
  #section-process .p-ctas{display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap}
  #section-process .btn-glass{padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);
    background:linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.04));
    color:#eaf0f6; font-weight:700; cursor:pointer; backdrop-filter: blur(8px);
    box-shadow:0 8px 24px rgba(0,0,0,.30), inset 0 0 0 1px rgba(255,255,255,.06);
    transition:transform .08s ease, filter .15s ease, box-shadow .15s ease}
  #section-process .btn-glass:hover{filter:brightness(1.06)}
  #section-process .btn-glass:active{transform:translateY(1px)}
  #section-process .btn-glass[disabled]{opacity:.45; cursor:not-allowed}

  /* BOARD (hidden until step==1) */
  #section-process .p-board{position:relative;min-height:520px; display:none}
  #section-process.show-board .p-board{display:block; animation:fadeIn .35s ease both}
  @keyframes fadeIn{from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:none}}

  /* column titles */
  #section-process .col-title{position:absolute; top:0; transform:translate(-50%,-120%);
    font-weight:700; letter-spacing:.2px; color:#dfeaf3; text-shadow:0 2px 12px rgba(0,0,0,.45)}
  
  /* node base */
  #section-process .node{position:absolute; padding:10px 12px; text-align:center; color:#dfeaf3;
    font-weight:600; font-size:14px; user-select:none; cursor:default}
  /* neon stroke look */
  #section-process .neo{
    background:rgba(16,24,36,.55);
    border:1px solid rgba(242,220,160,.55);
    box-shadow:0 8px 28px rgba(0,0,0,.35), 0 0 14px rgba(242,220,160,.08), inset 0 0 0 1px rgba(255,255,255,.05);
    backdrop-filter: blur(6px);
  }
  /* shapes */
  #section-process .rect{border-radius:10px}
  #section-process .pill{border-radius:999px}
  #section-process .oval{border-radius:28px 28px 28px 28px}
  #section-process .diamond{width:180px; height:52px; padding:0; transform:rotate(45deg); border-radius:10px;
    display:grid; place-items:center}
  #section-process .diamond > span{transform:rotate(-45deg); padding:0 12px; display:block}

  /* result */
  #section-process .result{position:absolute; padding:12px 16px; border-radius:14px}
  #section-process .result h4{margin:0 0 6px; font-weight:800}
  #section-process .result ul{margin:0; padding-left:18px; color:#b9c9d8; font-size:13px}
  #section-process .result li{margin:4px 0}

  /* SVG links */
  #section-process .p-svg{position:absolute; inset:0; pointer-events:none}
  #section-process .link{stroke:rgba(242,220,160,.35); stroke-width:1.2; fill:none}
  #section-process .link.dim{stroke:rgba(242,220,160,.18)}
  `;
  const style = document.createElement("style");
  style.textContent = css; document.head.appendChild(style);

  // --------- DATA (use PROCESS_DATA if available; otherwise fallback to your diagram) ---------
  function getPD() {
    try {
      const PD = window.PROCESS_DATA;
      if (typeof PD === "function") return PD();
      return PD || null;
    } catch { return null; }
  }
  const FALLBACK = {
    columns: [
      { id:"intent", title:"Intent Score", nodes:[
        { id:"search",   label:"Number of searches / timeblock", shape:"rect" },
        { id:"tech",     label:"Technologies used at the warehouse", shape:"rect" },
        { id:"ltv",      label:"Number of customers (LTV / CAC)", shape:"rect" },
        { id:"tools",    label:"Tools interacted", shape:"rect" },
        { id:"size",     label:"Company size", shape:"diamond" }
      ]},
      { id:"weight", title:"Weight Score", nodes:[
        { id:"post",     label:"Posting behaviour", shape:"pill" },
        { id:"goodwill", label:"Goodwill offers / lead magnets", shape:"pill" },
        { id:"nature",   label:"Nature of the business", shape:"pill" },
        { id:"freq",     label:"Frequency of purchases / partnerships", shape:"pill" }
      ]},
      { id:"character", title:"Character Score", nodes:[
        { id:"reviews",  label:"Score of past reviews", shape:"oval" },
        { id:"jumps",    label:"Number of vendor jumps", shape:"oval" },
        { id:"values",   label:"Language → values", shape:"oval" },
        { id:"culture",  label:"Language → culture", shape:"oval" }
      ]},
      { id:"platform", title:"Platform Score", nodes:[
        { id:"posts",    label:"# posts / platform", shape:"diamond" },
        { id:"comments", label:"# comments / platform", shape:"diamond" },
        { id:"respond",  label:"Intent to respond", shape:"pill" }
      ]},
    ],
    result: {
      title:"Result",
      bullets:["Fastest-to-buy window","Likely retention horizon","Advocacy potential","Best first contact channel"]
    }
  };
  const RAW = getPD() || FALLBACK;

  // steps: 0 (numbers only), 1 (reveal board), then one per column zoom, then result
  const TOTAL = (RAW.columns?.length ? RAW.columns.length : 4) + 2;

  // --------- SHELL + RAIL (same as step 1) ---------
  const dots = Array.from({length: TOTAL}, (_,i)=>i);
  const dotsHTML = dots.map(i=>`<button class="p-step" data-i="${i}">${i}</button>`).join("");
  mount.innerHTML = `
  <section class="proc-shell" aria-label="Process">
    <div class="proc-inner">
      <header class="proc-hd">
        <h2>How the scoring engine works</h2>
        <div class="sub">We score each lead across four lenses, then surface the fastest wins.</div>
      </header>

      <aside class="p-dock">
        <div class="p-stepper" id="pStepper">${dotsHTML}</div>
        <div class="p-ctas">
          <button class="btn-glass" id="pPrev" type="button">Prev step</button>
          <button class="btn-glass" id="pNext" type="button">Next step</button>
        </div>
      </aside>

      <div class="p-board" id="pBoard" aria-hidden="true">
        <svg class="p-svg" id="pSVG"></svg>
      </div>
    </div>
  </section>`;

  const root    = mount.querySelector(".proc-shell");
  const inner   = mount.querySelector(".proc-inner");
  const board   = mount.querySelector("#pBoard");
  const svg     = mount.querySelector("#pSVG");
  const stepper = mount.querySelector("#pStepper");
  const prevBtn = mount.querySelector("#pPrev");
  const nextBtn = mount.querySelector("#pNext");
  const dotEls  = Array.from(stepper.querySelectorAll(".p-step"));

  // --------- BUILD BOARD (columns + nodes) ---------
  const columns = [];
  const nodesByCol = [];
  function buildBoard(){
    board.innerHTML = '<svg class="p-svg" id="pSVG"></svg>';
    columns.length = 0; nodesByCol.length = 0;

    const svgLocal = board.querySelector("#pSVG");
    const svgNS = "http://www.w3.org/2000/svg";

    RAW.columns.forEach((col, ci)=>{
      const colWrap = document.createElement("div");
      colWrap.className = "col";
      board.appendChild(colWrap);
      columns.push(colWrap);

      // title
      const title = document.createElement("div");
      title.className = "col-title";
      title.textContent = col.title || col.id;
      colWrap.appendChild(title);

      // nodes
      const list = [];
      col.nodes.forEach((n, ni)=>{
        const d = document.createElement("div");
        const clsShape = n.shape==="diamond" ? "diamond" :
                         n.shape==="oval" ? "oval" :
                         n.shape==="pill" ? "pill" : "rect";
        d.className = `node neo ${clsShape}`;
        if (clsShape==="diamond") d.innerHTML = `<span>${n.label}</span>`;
        else d.textContent = n.label;
        board.appendChild(d);
        list.push({el:d, meta:n});
      });
      nodesByCol.push(list);
    });

    // result pill
    const res = document.createElement("div");
    res.className = "result neo rect";
    res.innerHTML = `<h4>🎯 ${RAW.result?.title || "Result"}</h4>
      <ul>${(RAW.result?.bullets||[]).map(b=>`<li>${b}</li>`).join("")}</ul>`;
    board.appendChild(res);

    // layout & links
    function layout(){
      const r = board.getBoundingClientRect();
      const W = r.width, H = Math.max(520, r.height);
      svgLocal.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svgLocal.setAttribute("width", W);
      svgLocal.setAttribute("height", H);

      const topPad = 96, colH = H - topPad - 40;
      const colGap = W / (RAW.columns.length + 2); // leave space for result
      RAW.columns.forEach((col, ci)=>{
        const baseX = colGap*(ci+1);
        const list = nodesByCol[ci];
        const rows = list.length;
        const rowGap = colH/(rows+1);
        // title
        const t = board.querySelectorAll(".col-title")[ci];
        t.style.left = `${baseX}px`; t.style.top = `${topPad}px`;

        list.forEach((ref, ri)=>{
          const y = topPad + 24 + rowGap*(ri+1);
          const x = baseX;
          const el = ref.el;
          // sizes per shape
          let w=200, h=44;
          if (el.classList.contains("oval")) { w=220; h=52; }
          if (el.classList.contains("pill")) { w=220; h=48; }
          if (el.classList.contains("diamond")) { w=180; h=52; }
          el.style.left = `${x - w/2}px`;
          el.style.top  = `${y - h/2}px`;
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
          ref.pos = {x, y, w, h};
        });
      });

      // place result
      const lastX = colGap*(RAW.columns.length+0.9);
      const resBox = board.querySelector(".result");
      const RH = 140, RW = 280;
      resBox.style.left = `${lastX - RW/2}px`;
      resBox.style.top  = `${topPad + colH/2 - RH/2}px`;
      resBox.style.width = `${RW}px`;
      resBox.style.height= `${RH}px`;

      // draw all-to-all links between adjacent columns
      while (svgLocal.firstChild) svgLocal.removeChild(svgLocal.firstChild);
      for (let ci=0; ci<RAW.columns.length-1; ci++){
        const A = nodesByCol[ci], B = nodesByCol[ci+1];
        for (const a of A){
          for (const b of B){
            const p = document.createElementNS(svgNS, "path");
            const ax=a.pos.x, ay=a.pos.y, bx=b.pos.x, by=b.pos.y;
            const dx = (bx-ax)*0.32;
            const d = `M ${ax} ${ay} C ${ax+dx} ${ay}, ${bx-dx} ${by}, ${bx} ${by}`;
            p.setAttribute("d", d);
            p.setAttribute("class","link");
            svgLocal.appendChild(p);
          }
        }
      }
      // links from last column to result
      const last = nodesByCol[nodesByCol.length-1];
      const resRect = resBox.getBoundingClientRect();
      const resCenter = {
        x: lastX, y: topPad + colH/2
      };
      for (const a of last){
        const p = document.createElementNS(svgNS, "path");
        const ax=a.pos.x, ay=a.pos.y, bx=resCenter.x, by=resCenter.y;
        const dx = (bx-ax)*0.35;
        const d = `M ${ax} ${ay} C ${ax+dx} ${ay}, ${bx-dx} ${by}, ${bx} ${by}`;
        p.setAttribute("d", d);
        p.setAttribute("class","link");
        svgLocal.appendChild(p);
      }
    }
    layout();
    addEventListener("resize", layout, {passive:true});
  }

  // build once; we’ll reveal it at step==1
  buildBoard();

  // --------- STEP LOGIC ---------
  let step = 0;
  function setStep(n){
    step = Math.max(0, Math.min(TOTAL-1, n|0));
    dotEls.forEach((el,i)=>{
      el.classList.toggle("is-current", i===step);
      el.classList.toggle("is-done", i<step);
    });
    prevBtn.disabled = (step<=0);
    nextBtn.disabled = (step>=TOTAL-1);

    // STEP 2 behaviour: on step>=1 reveal board and compact rail
    const host = document.getElementById("section-process");
    host.classList.toggle("show-board", step>=1);
    host.classList.toggle("stage-1",   step>=1);
    board.setAttribute("aria-hidden", step<1 ? "true" : "false");

    // NOTE: Future steps (>=2) will zoom per-column; not implemented yet by request.
  }
  dotEls.forEach(el=> el.addEventListener("click", ()=> setStep(+el.dataset.i)));
  prevBtn.addEventListener("click", ()=> setStep(step-1));
  nextBtn.addEventListener("click", ()=> setStep(step+1));
  setStep(0);
})();