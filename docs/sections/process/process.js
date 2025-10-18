// docs/sections/process/process.js
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  /* ---------------- styles ---------------- */
  const css = `
  :root{ --accent:#63D3FF; --accent-ink:#0b1117; }

  #section-process .proc-only{ position:relative; min-height:520px; padding:44px 12px; overflow:visible; }

  /* gentle separator lamp (left edge of right area) */
  #section-process .lamp{
    position:absolute; top:50%; transform:translateY(-50%);
    left:0; width:0; height:min(72vh,560px); pointer-events:none; opacity:0; z-index:0;
    transition:opacity .45s ease, left .45s cubic-bezier(.22,.61,.36,1), width .45s cubic-bezier(.22,.61,.36,1);
    background:
      radial-gradient(120% 92% at 0% 50%, rgba(99,211,255,.22) 0%, rgba(99,211,255,.10) 34%, rgba(99,211,255,0) 70%),
      radial-gradient(80% 60% at 0% 50%, rgba(242,220,160,.10) 0%, rgba(242,220,160,0) 56%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 1px, transparent 1px 6px);
    filter:saturate(110%) blur(.35px); border-radius:16px;
  }
  #section-process .lamp::before{
    content:""; position:absolute; inset:0 auto 0 -1px; width:2px;
    background:linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.02));
    box-shadow:0 0 10px rgba(99,211,255,.28), 0 0 22px rgba(240,210,120,.12);
    border-radius:2px;
  }

  /* left steps rail */
  #section-process .railWrap{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) scale(.90);
    transition:left .45s cubic-bezier(.22,.61,.36,1), transform .45s cubic-bezier(.22,.61,.36,1); z-index:2; }
  #section-process .railWrap.is-docked{ left:clamp(18px,6vw,80px); transform:translate(0,-50%) scale(.90); }
  #section-process .rail{ position:relative; display:flex; flex-direction:column; align-items:center; gap:16px; }
  #section-process .rail-svg{ position:absolute; inset:0; z-index:0; pointer-events:none; overflow:visible;
    filter:drop-shadow(0 0 6px rgba(99,211,255,.12)); }

  #section-process .p-step{
    position:relative; z-index:1; width:50px; height:50px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    font:700 17px/1 Inter, system-ui,-apple-system, Segoe UI, Roboto, Arial, sans-serif;
    color:#eaf0f6; background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.12); backdrop-filter:blur(6px);
    box-shadow:0 6px 16px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.04);
    cursor:pointer; user-select:none; transition:transform .12s ease, background .15s ease, box-shadow .15s ease;
  }
  #section-process .p-step:hover{ transform:translateY(-1px); background:rgba(255,255,255,.08) }
  #section-process .p-step.is-current{
    color:#0b1117;
    background:radial-gradient(circle at 50% 45%, rgba(255,255,255,.34), rgba(255,255,255,0) 60%), linear-gradient(180deg, var(--accent), #26b9ff);
    border-color:rgba(255,255,255,.22);
    box-shadow:0 14px 34px rgba(38,185,255,.30), 0 0 0 2px rgba(255,255,255,.20) inset, 0 0 18px rgba(99,211,255,.45);
  }
  #section-process .p-step.is-done{ opacity:.88 }

  #section-process .ctas{ display:flex; gap:10px; margin-top:10px; justify-content:center; }
  #section-process .btn-glass{
    padding:10px 14px; border-radius:999px; border:1px solid rgba(255,255,255,.14);
    background:linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.04));
    color:#eaf0f6; font-weight:700; cursor:pointer; backdrop-filter:blur(8px);
    box-shadow:0 8px 24px rgba(0,0,0,.30), inset 0 0 0 1px rgba(255,255,255,.06);
    transition:transform .08s ease, filter .15s ease, box-shadow .15s ease;
  }
  #section-process .btn-glass:hover{ filter:brightness(1.06) } #section-process .btn-glass:active{ transform:translateY(1px) }
  #section-process .btn-glass[disabled]{ opacity:.45; cursor:not-allowed }

  /* content canvas */
  #section-process .canvas{ position:absolute; inset:0; z-index:1; pointer-events:none; }
  #section-process .canvas .copy{
    position:absolute; pointer-events:auto;
    max-width:280px; /* keep copy tight so the node has more stage */
    opacity:0; transform:translateY(8px);
    transition:opacity .38s ease, transform .38s ease;
  }
  #section-process .canvas .copy h3{
    margin:0 0 .45rem; color:#eaf0f6;
    font:600 clamp(20px,2.4vw,26px) "Newsreader", Georgia, serif;
  }
  #section-process .canvas .copy p{ margin:.35rem 0 0; font:400 15px/1.6 Inter, system-ui; color:#a7bacb }
  #section-process .canvas.show .copy{ opacity:1; transform:translateY(0) }

  /* neon node + continuation line */
  #section-process .canvas svg{ position:absolute; overflow:visible }
  .neon-stroke{ fill:rgba(11,17,23,.16); stroke:url(#gradNeon); stroke-width:2.2; border-radius:14px; }
  .cont-line{ stroke:url(#gradTrail); stroke-width:2.2; stroke-linecap:round; }
  .dash-anim{ stroke-dasharray:600; stroke-dashoffset:600; animation:draw .9s ease forwards .08s }
  .dash-anim.slow{ animation-duration:1.15s }
  @keyframes draw{ to{ stroke-dashoffset:0 } }
  .neonPulse{ animation:neonPulse 2.6s ease-in-out infinite }
  @keyframes neonPulse{
    0%,100%{ filter:drop-shadow(0 0 8px rgba(242,220,160,.35)) drop-shadow(0 0 18px rgba(99,211,255,.18)) }
    50%     { filter:drop-shadow(0 0 14px rgba(242,220,160,.55)) drop-shadow(0 0 28px rgba(99,211,255,.28)) }
  }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------------- markup ---------------- */
  const steps = [0,1,2,3,4,5];
  mount.innerHTML = `
    <section class="proc-only" aria-label="Process">
      <div class="lamp" id="procLamp" aria-hidden="true"></div>
      <div class="canvas" id="procCanvas" aria-hidden="true"></div>

      <div class="railWrap" id="railWrap">
        <div class="rail" id="rail">
          <svg class="rail-svg" id="railSvg" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>
          ${steps.map(i=>`<button class="p-step" data-i="${i}">${i}</button>`).join("")}
          <div class="ctas">
            <button class="btn-glass" id="prevBtn" type="button">Prev step</button>
            <button class="btn-glass" id="nextBtn" type="button">Next step</button>
          </div>
        </div>
      </div>
    </section>
  `;

  /* ---------------- elements ---------------- */
  const stage   = mount.querySelector(".proc-only");
  const wrap    = mount.querySelector("#railWrap");
  const rail    = mount.querySelector("#rail");
  const svgRail = mount.querySelector("#railSvg");
  const lamp    = mount.querySelector("#procLamp");
  const canvas  = mount.querySelector("#procCanvas");
  const dotEls  = Array.from(mount.querySelectorAll(".p-step"));
  const prevBtn = mount.querySelector("#prevBtn");
  const nextBtn = mount.querySelector("#nextBtn");

  /* ---------------- state ---------------- */
  let step = 0;

  /* ---------------- helpers ---------------- */
  function setStep(n){
    step = Math.max(0, Math.min(steps.length-1, n|0));
    dotEls.forEach((el,i)=>{
      el.classList.toggle("is-current", i===step);
      el.classList.toggle("is-done", i<step);
    });
    prevBtn.disabled = (step<=0);
    nextBtn.disabled = (step>=steps.length-1);

    wrap.classList.toggle("is-docked", step>0);
    drawRailConnectors();
    positionLamp();
    renderCanvas();
  }

  function drawRailConnectors(){
    const r = rail.getBoundingClientRect();
    svgRail.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    while (svgRail.firstChild) svgRail.removeChild(svgRail.firstChild);
    const pts = dotEls.map(el=>{
      const b = el.getBoundingClientRect();
      return { x:(b.left+b.right)/2 - r.left, y:(b.top+b.bottom)/2 - r.top };
    });
    for (let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      const isTrail = i < step;
      line.setAttribute("stroke", isTrail ? "rgba(99,211,255,.58)" : "rgba(255,255,255,.14)");
      line.setAttribute("stroke-width", 2); line.setAttribute("stroke-linecap","round");
      svgRail.appendChild(line);
    }
  }

  function positionLamp(){
    const s = stage.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const gap = 40;                              // bigger buffer from text
    const left = Math.max(0, w.right + gap - s.left);
    const width = Math.max(340, s.right - s.left - left - 12);
    if (step>0){
      lamp.style.left = left + "px";
      lamp.style.width = width + "px";
      lamp.style.opacity = "0.32";
    } else {
      lamp.style.opacity = "0"; lamp.style.width = "0px"; lamp.style.left = "0px";
    }
  }

  // geometry of the right free area
  function rightArea(){
    const s = stage.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const gap = 40;                               // same as lamp gap
    const left = Math.max(0, w.right + gap - s.left);
    const right= s.right - s.left - 12;
    const top  = 22;
    const height = Math.min(s.height - 44, 560);
    return { left, right, top, width: Math.max(340, right-left), height, sW:(s.right-s.left), sH:(s.bottom-s.top) };
  }

  function clearCanvas(){ while (canvas.firstChild) canvas.removeChild(canvas.firstChild); canvas.classList.remove("show"); }

  /* ---------------- Step 1 (copy LEFT of lamp, node RIGHT; full-width trail) ---------------- */
  function renderCanvas(){
    clearCanvas();
    if (step!==1) return;

    const area = rightArea();

    // SVG for the node (positioned in the right area)
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgNode.style.left = area.left + "px";
    svgNode.style.top  = area.top + "px";
    svgNode.setAttribute("width", area.width);
    svgNode.setAttribute("height", area.height);
    svgNode.setAttribute("viewBox", `0 0 ${area.width} ${area.height}`);

    // defs (neon)
    const defs = document.createElementNS(svgNode.namespaceURI, "defs");
    const gradNeon = document.createElementNS(svgNode.namespaceURI, "linearGradient");
    gradNeon.id = "gradNeon"; gradNeon.setAttribute("x1","0%"); gradNeon.setAttribute("y1","0%"); gradNeon.setAttribute("x2","100%"); gradNeon.setAttribute("y2","0%");
    [["0%","rgba(242,220,160,.95)"],["38%","rgba(255,255,255,.95)"],["72%","rgba(99,211,255,.95)"],["100%","rgba(99,211,255,.65)"]]
      .forEach(([o,c])=>{ const st=document.createElementNS(svgNode.namespaceURI,"stop"); st.setAttribute("offset",o); st.setAttribute("stop-color",c); gradNeon.appendChild(st); });
    const gradTrail = document.createElementNS(svgNode.namespaceURI, "linearGradient");
    gradTrail.id = "gradTrail"; gradTrail.setAttribute("x1","0%"); gradTrail.setAttribute("y1","0%"); gradTrail.setAttribute("x2","100%"); gradTrail.setAttribute("y2","0%");
    [["0%","rgba(242,220,160,.85)"],["45%","rgba(99,211,255,.85)"],["100%","rgba(99,211,255,.18)"]]
      .forEach(([o,c])=>{ const st=document.createElementNS(svgNode.namespaceURI,"stop"); st.setAttribute("offset",o); st.setAttribute("stop-color",c); gradTrail.appendChild(st); });
    defs.appendChild(gradNeon); defs.appendChild(gradTrail); svgNode.appendChild(defs);

    // node box on the RIGHT
    const copyW = Math.min(300, Math.max(240, area.width*0.26)); // used to compute where we place copy (left of lamp)
    const boxW = Math.min(420, area.width * 0.44);
    const boxH = 78;
    const boxX = Math.max(16, area.width * 0.54); // keep it toward the right half
    const boxY = Math.max(10, area.height * 0.18);

    const rect = document.createElementNS(svgNode.namespaceURI, "rect");
    rect.setAttribute("x", boxX); rect.setAttribute("y", boxY);
    rect.setAttribute("width", boxW); rect.setAttribute("height", boxH);
    rect.setAttribute("rx", 14); rect.setAttribute("ry", 14);
    rect.setAttribute("class","neon-stroke dash-anim neonPulse");
    svgNode.appendChild(rect);

    // label inside node
    const label = document.createElementNS(svgNode.namespaceURI, "text");
    label.setAttribute("x", boxX + 16); label.setAttribute("y", boxY + boxH/2 + 6);
    label.setAttribute("fill", "#ddeaef"); label.setAttribute("font-family", "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
    label.setAttribute("font-weight","800"); label.setAttribute("font-size","18");
    label.textContent = "yourcompany.com";
    svgNode.appendChild(label);

    canvas.appendChild(svgNode);

    // FULL-WIDTH continuation line so it truly reaches the right edge of Section 3
    const svgTrail = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svgTrail.style.left = "0px"; svgTrail.style.top = "0px";
    svgTrail.setAttribute("width", area.sW); svgTrail.setAttribute("height", area.sH);
    svgTrail.setAttribute("viewBox", `0 0 ${area.sW} ${area.sH}`);

    const defs2 = document.createElementNS(svgTrail.namespaceURI, "defs");
    const gradTrail2 = document.createElementNS(svgTrail.namespaceURI, "linearGradient");
    gradTrail2.id="gradTrail"; gradTrail2.setAttribute("x1","0%"); gradTrail2.setAttribute("y1","0%"); gradTrail2.setAttribute("x2","100%"); gradTrail2.setAttribute("y2","0%");
    [["0%","rgba(242,220,160,.85)"],["45%","rgba(99,211,255,.85)"],["100%","rgba(99,211,255,.18)"]]
      .forEach(([o,c])=>{ const st=document.createElementNS(svgTrail.namespaceURI,"stop"); st.setAttribute("offset",o); st.setAttribute("stop-color",c); gradTrail2.appendChild(st); });
    defs2.appendChild(gradTrail2); svgTrail.appendChild(defs2);

    const line = document.createElementNS(svgTrail.namespaceURI, "line");
    const x1g = area.left + boxX + boxW;
    const y1g = area.top  + boxY + boxH/2;
    const x2g = area.sW - 8;
    line.setAttribute("x1", x1g); line.setAttribute("y1", y1g);
    line.setAttribute("x2", x2g); line.setAttribute("y2", y1g);
    line.setAttribute("class","cont-line dash-anim slow neonPulse");
    svgTrail.appendChild(line);
    canvas.appendChild(svgTrail);

    // COPY COLUMN — to the LEFT of the lamp (outside the right area)
    const copy = document.createElement("div");
    copy.className = "copy";
    const copyLeft = Math.max(12, area.left - copyW - 26); // keep a buffer from lamp seam
    copy.style.left = copyLeft + "px";
    copy.style.top  = (area.top + boxY - 2) + "px";
    copy.style.maxWidth = copyW + "px";
    copy.innerHTML = `
      <h3>We start with your company.</h3>
      <p>We read your company and data to learn what matters. Then our system builds simple metrics around your strengths. With that map in hand, we move forward to find real buyers who match your persona.</p>
    `;
    canvas.appendChild(copy);

    requestAnimationFrame(()=> canvas.classList.add("show"));
  }

  /* ---------------- events ---------------- */
  dotEls.forEach(el => el.addEventListener("click", ()=> setStep(+el.dataset.i)));
  prevBtn.addEventListener("click", ()=> setStep(step-1));
  nextBtn.addEventListener("click", ()=> setStep(step+1));
  addEventListener("resize", ()=>{ drawRailConnectors(); positionLamp(); if (step===1) renderCanvas(); }, {passive:true});
  wrap.addEventListener("transitionend", e=>{ if (e.propertyName==="left"||e.propertyName==="transform"){ drawRailConnectors(); positionLamp(); if(step===1) renderCanvas(); } });

  /* ---------------- init ---------------- */
  setStep(0);
})();