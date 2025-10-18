// docs/sections/process/process.js
(() => {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  /* ----------------- SCOPED STYLES ----------------- */
  const style = document.createElement("style");
  style.textContent = `
  :root{
    --ink:#0b1117;
    --copyMax:300px;
    --accent:#63D3FF;  /* cyan */
    --accent2:#F2DCA0; /* warm gold */
  }
  #section-process{ position:relative; isolation:isolate; }
  #section-process .proc{ position:relative; min-height:560px; padding:44px 12px 40px; overflow:visible; }

  /* steps rail */
  #section-process .railWrap{
    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) scale(.88);
    z-index:5; transition:left .45s cubic-bezier(.22,.61,.36,1), transform .45s cubic-bezier(.22,.61,.36,1);
  }
  #section-process .railWrap.is-docked{ left:clamp(12px,5vw,70px); transform:translate(0,-50%) scale(.86); }
  #section-process .rail{ position:relative; display:flex; flex-direction:column; align-items:center; gap:16px; }
  #section-process .rail svg{ position:absolute; inset:0; overflow:visible; pointer-events:none; }

  #section-process .p-step{
    width:50px;height:50px;border-radius:50%;
    display:flex;align-items:center;justify-content:center; user-select:none; cursor:pointer;
    font:700 17px/1 Inter, system-ui; color:#eaf0f6;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
    backdrop-filter:blur(6px); box-shadow:0 6px 16px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.05);
    transition:transform .14s ease, background .15s ease, box-shadow .18s ease;
  }
  #section-process .p-step:hover{ transform:translateY(-1px) }
  #section-process .p-step.is-current{
    color:#07212a;
    background:radial-gradient(circle at 50% 45%, rgba(255,255,255,.34), rgba(255,255,255,0) 60%), linear-gradient(180deg, var(--accent), #26b9ff);
    border-color:rgba(255,255,255,.22);
    box-shadow:0 14px 34px rgba(38,185,255,.30), 0 0 0 2px rgba(255,255,255,.20) inset, 0 0 18px rgba(99,211,255,.45);
  }

  #section-process .ctas{ display:flex; gap:10px; margin-top:10px; }
  #section-process .btn-glass{
    padding:10px 14px; border-radius:999px; border:1px solid rgba(255,255,255,.14);
    background:linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.04));
    color:#eaf0f6; font-weight:700; cursor:pointer; backdrop-filter:blur(8px);
    box-shadow:0 8px 24px rgba(0,0,0,.30), inset 0 0 0 1px rgba(255,255,255,.06);
    transition:transform .08s ease, filter .15s ease;
  }
  #section-process .btn-glass:hover{ filter:brightness(1.06) } #section-process .btn-glass:active{ transform:translateY(1px) }
  #section-process .btn-glass[disabled]{ opacity:.45; cursor:not-allowed }

  /* lamp seam (kept) */
  #section-process .lamp{
    position:absolute; top:50%; transform:translateY(-50%); left:0; width:0;
    height:min(72vh,560px); border-radius:16px; opacity:0; pointer-events:none; z-index:1;
    background:
      radial-gradient(120% 92% at 0% 50%, rgba(99,211,255,.20) 0, rgba(99,211,255,.08) 34%, rgba(99,211,255,0) 70%),
      radial-gradient(80% 60% at 0% 50%, rgba(242,220,160,.08) 0, rgba(242,220,160,0) 56%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 6px);
    filter:saturate(110%) blur(.35px);
    transition:opacity .45s ease, left .45s cubic-bezier(.22,.61,.36,1), width .45s cubic-bezier(.22,.61,.36,1);
  }
  #section-process .lamp::before{
    content:""; position:absolute; inset:0 auto 0 -1px; width:2px; border-radius:2px;
    background:linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.03));
    box-shadow:0 0 10px rgba(99,211,255,.28), 0 0 22px rgba(240,210,120,.12);
  }

  /* right canvas + copy */
  #section-process .canvas{ position:absolute; inset:0; z-index:2; pointer-events:none; }
  #section-process .copy{
    position:absolute; max-width:var(--copyMax); pointer-events:auto;
    opacity:0; transform:translateY(6px); transition:opacity .35s ease, transform .35s ease;
  }
  #section-process .copy.show{ opacity:1; transform:translateY(0) }
  #section-process .copy h3{ margin:0 0 .45rem; color:#eaf0f6; font:600 clamp(20px,2.4vw,26px) "Newsreader", Georgia, serif; }
  #section-process .copy p{ margin:.35rem 0 0; font:400 15px/1.6 Inter, system-ui; color:#a7bacb }

  /* glow helpers */
  #section-process .glow{
    filter:
      drop-shadow(0 0 6px rgba(242,220,160,.35))
      drop-shadow(0 0 14px rgba(99,211,255,.30))
      drop-shadow(0 0 24px rgba(99,211,255,.18));
  }
  #section-process .pulse { animation:pulseGlow 2.6s ease-in-out infinite; }
  @keyframes pulseGlow{
    0%,100%{ filter: drop-shadow(0 0 6px rgba(242,220,160,.25)) drop-shadow(0 0 10px rgba(99,211,255,.22)); }
    50%   { filter: drop-shadow(0 0 10px rgba(242,220,160,.45)) drop-shadow(0 0 18px rgba(99,211,255,.45)); }
  }

  @media (max-width:900px){ :root{ --copyMax:260px } #section-process .railWrap.is-docked{ left:12px; transform:translate(0,-50%) scale(.84) } }
  @media (max-width:640px){ :root{ --copyMax:240px } #section-process .proc{ min-height:600px } #section-process .railWrap{ transform:translate(-50%,-50%) scale(.82) } }
  `;
  document.head.appendChild(style);

  /* ----------------- MARKUP ----------------- */
  const steps = [0,1,2,3,4,5];
  mount.innerHTML = `
    <section class="proc" aria-label="Process">
      <div class="lamp" id="lamp"></div>
      <div class="canvas" id="canvas"></div>

      <div class="railWrap" id="railWrap">
        <div class="rail" id="rail">
          <svg id="railSvg" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>
          ${steps.map(i=>`<button class="p-step" data-i="${i}">${i}</button>`).join("")}
          <div class="ctas">
            <button class="btn-glass" id="prevBtn" type="button">Prev step</button>
            <button class="btn-glass" id="nextBtn" type="button">Next step</button>
          </div>
        </div>
      </div>
    </section>
  `;

  /* ----------------- ELEMENTS ----------------- */
  const stage   = mount.querySelector(".proc");
  const railWrap= mount.querySelector("#railWrap");
  const rail    = mount.querySelector("#rail");
  const railSvg = mount.querySelector("#railSvg");
  const lamp    = mount.querySelector("#lamp");
  const canvas  = mount.querySelector("#canvas");
  const dots    = Array.from(mount.querySelectorAll(".p-step"));
  const prevBtn = mount.querySelector("#prevBtn");
  const nextBtn = mount.querySelector("#nextBtn");

  // Start empty (Step 0)
  let step = 0;

  /* ----------------- UTILS ----------------- */
  function setStep(n){
    step = Math.max(0, Math.min(steps.length-1, n|0));
    dots.forEach((el,i)=>{ el.classList.toggle("is-current", i===step); el.classList.toggle("is-done", i<step); });
    prevBtn.disabled = step<=0; nextBtn.disabled = step>=steps.length-1;
    railWrap.classList.toggle("is-docked", step>0);
    drawRail();
    placeLamp();
    drawScene();
  }

  function drawRail(){
    const r = rail.getBoundingClientRect();
    railSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    while (railSvg.firstChild) railSvg.removeChild(railSvg.firstChild);
    const pts = dots.map(el=>{
      const b = el.getBoundingClientRect();
      return { x:(b.left+b.right)/2 - r.left, y:(b.top+b.bottom)/2 - r.top };
    });
    for (let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      line.setAttribute("stroke", i<step ? "rgba(99,211,255,.70)" : "rgba(255,255,255,.12)");
      line.setAttribute("stroke-width", 2); line.setAttribute("stroke-linecap","round");
      railSvg.appendChild(line);
    }
  }

  function bounds(){
    const s = stage.getBoundingClientRect();
    const w = railWrap.getBoundingClientRect();
    const gap = 56; // breathing room from rail/lamp
    const left = Math.max(0, w.right + gap - s.left);
    const width = Math.max(380, s.right - s.left - left - 16);
    return { sLeft:s.left, sTop:s.top, sW:s.width, sH:s.height, left, width, top:18, railRight:w.right - s.left };
  }

  function placeLamp(){
    const b = bounds();
    if (step>0){
      lamp.style.left = b.left + "px";
      lamp.style.width = b.width + "px";
      lamp.style.opacity = ".32";
    } else {
      lamp.style.opacity = "0"; lamp.style.width="0px";
    }
  }

  function clearCanvas(){ while (canvas.firstChild) canvas.removeChild(canvas.firstChild); }

  /* ----------------- STEP 1 SCENE ----------------- */
  function drawScene(){
    clearCanvas();
    if (step!==1) return;

    const b = bounds();
    const ns = "http://www.w3.org/2000/svg";

    // --- gradient defs with continuous "liquid" motion ---
    const makeFlowGradients = (nodeMetrics) => {
      const {pillX, pillY, pillW, yMid, xTrailEnd} = nodeMetrics;
      const defs = document.createElementNS(ns,"defs");

      // flowing gradient for the node outline
      const gFlow = document.createElementNS(ns,"linearGradient");
      gFlow.id = "gradFlow";
      gFlow.setAttribute("gradientUnits","userSpaceOnUse");
      gFlow.setAttribute("x1", pillX); gFlow.setAttribute("y1", pillY);
      gFlow.setAttribute("x2", pillX + pillW); gFlow.setAttribute("y2", pillY);

      [
        ["0%","rgba(230,195,107,.95)"],  // gold
        ["35%","rgba(255,255,255,.95)"], // white
        ["75%","rgba(99,211,255,.95)"],  // cyan
        ["100%","rgba(99,211,255,.60)"]
      ].forEach(([o,c])=>{
        const s = document.createElementNS(ns,"stop");
        s.setAttribute("offset",o); s.setAttribute("stop-color",c); gFlow.appendChild(s);
      });

      const a1 = document.createElementNS(ns,"animateTransform");
      a1.setAttribute("attributeName","gradientTransform");
      a1.setAttribute("type","translate");
      a1.setAttribute("from","0 0");
      a1.setAttribute("to", `${pillW} 0`);
      a1.setAttribute("dur","6s");
      a1.setAttribute("repeatCount","indefinite");
      gFlow.appendChild(a1);

      // flowing gradient for the rightward trail
      const gTrail = document.createElementNS(ns,"linearGradient");
      gTrail.id = "gradTrailFlow";
      gTrail.setAttribute("gradientUnits","userSpaceOnUse");
      gTrail.setAttribute("x1", pillX + pillW); gTrail.setAttribute("y1", yMid);
      gTrail.setAttribute("x2", xTrailEnd);      gTrail.setAttribute("y2", yMid);

      [
        ["0%","rgba(230,195,107,.92)"],
        ["45%","rgba(99,211,255,.90)"],
        ["100%","rgba(99,211,255,.18)"]
      ].forEach(([o,c])=>{
        const s = document.createElementNS(ns,"stop");
        s.setAttribute("offset",o); s.setAttribute("stop-color",c); gTrail.appendChild(s);
      });

      const a2 = document.createElementNS(ns,"animateTransform");
      a2.setAttribute("attributeName","gradientTransform");
      a2.setAttribute("type","translate");
      a2.setAttribute("from","0 0");
      a2.setAttribute("to", `${(xTrailEnd - (pillX + pillW))} 0`);
      a2.setAttribute("dur","6s");
      a2.setAttribute("repeatCount","indefinite");
      gTrail.appendChild(a2);

      defs.appendChild(gFlow);
      defs.appendChild(gTrail);
      return defs;
    };

    // --- node svg (stroke-only rounded rectangle with flowing gradient) ---
    const nodeSVG = document.createElementNS(ns,"svg");
    const nodeW = b.width, nodeH = Math.min(560, b.sH-40);
    nodeSVG.style.position = "absolute";
    nodeSVG.style.left = b.left + "px"; nodeSVG.style.top = b.top + "px";
    nodeSVG.setAttribute("width", nodeW); nodeSVG.setAttribute("height", nodeH);
    nodeSVG.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);

    const pillW = Math.min(440, nodeW*0.48), pillH = 80;
    const pillX = Math.max(18, nodeW*0.50), pillY = Math.max(12, nodeH*0.20), r = 16;
    const yMid  = pillY + pillH/2;

    // compute trail end in *stage* space, then map into this svg's viewBox
    const xScreenEnd = b.sW - 10;
    const xTrailEnd  = xScreenEnd - b.left;

    nodeSVG.appendChild(makeFlowGradients({pillX, pillY, pillW, yMid, xTrailEnd}));

    const d = `M ${pillX+r} ${pillY} H ${pillX+pillW-r} Q ${pillX+pillW} ${pillY} ${pillX+pillW} ${pillY+r}
               V ${pillY+pillH-r} Q ${pillX+pillW} ${pillY+pillH} ${pillX+pillW-r} ${pillY+pillH}
               H ${pillX+r} Q ${pillX} ${pillY+pillH} ${pillX} ${pillY+pillH-r}
               V ${pillY+r} Q ${pillX} ${pillY} ${pillX+r} ${pillY} Z`;

    const outline = document.createElementNS(ns,"path");
    outline.setAttribute("d", d);
    outline.setAttribute("fill","none");
    outline.setAttribute("stroke","url(#gradFlow)");
    outline.setAttribute("stroke-width","2.5");
    outline.setAttribute("stroke-linejoin","round");
    outline.setAttribute("class","glow pulse");
    nodeSVG.appendChild(outline);

    // animate reveal using actual path length (clean rectangle)
    const len = outline.getTotalLength();
    outline.style.strokeDasharray  = String(len);
    outline.style.strokeDashoffset = String(len);
    outline.getBoundingClientRect();
    outline.style.transition = "stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
    requestAnimationFrame(()=> outline.style.strokeDashoffset = "0");

    const label = document.createElementNS(ns,"text");
    label.setAttribute("x", pillX + 18); label.setAttribute("y", pillY + pillH/2 + 6);
    label.setAttribute("fill","#ddeaef"); label.setAttribute("font-weight","800");
    label.setAttribute("font-size","18"); label.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
    label.textContent = "yourcompany.com";
    nodeSVG.appendChild(label);

    // flowing connector from box → right edge (same gradient, no dots/balls)
    const trail = document.createElementNS(ns,"line");
    trail.setAttribute("x1", pillX + pillW); trail.setAttribute("y1", yMid);
    trail.setAttribute("x2", xTrailEnd);     trail.setAttribute("y2", yMid);
    trail.setAttribute("stroke","url(#gradTrailFlow)");
    trail.setAttribute("stroke-width","2.5");
    trail.setAttribute("stroke-linecap","round");
    trail.setAttribute("class","glow");
    nodeSVG.appendChild(trail);

    canvas.appendChild(nodeSVG);

    // --- copy column: guarantee it's INSIDE the lamp and keep a tidy gap from the node ---
    const copy = document.createElement("div");
    copy.className = "copy";
    copy.style.top  = (b.top + pillY - 2) + "px";

    // initial guess inside lamp
    const minInsideLamp = b.left + 24;                 // inside the glow
    const fromRail      = Math.max(b.railRight + 32, minInsideLamp);
    copy.style.left     = fromRail + "px";

    copy.innerHTML = `
      <h3>We start with your company.</h3>
      <p>We read your company and data to learn what matters. Then our system builds simple metrics around your strengths.
      With that map in hand, we move forward to find real buyers who match your persona.</p>
    `;
    canvas.appendChild(copy);

    // after it’s in DOM, measure and ensure a clean gap from the node
    requestAnimationFrame(() => {
      const boxLeftAbs = b.left + pillX;
      const copyBox    = copy.getBoundingClientRect();
      const desiredGap = 40; // px
      let idealLeft = Math.min(
        copyBox.left,                                   // current
        boxLeftAbs - desiredGap - copyBox.width        // keep gap to node
      );
      idealLeft = Math.max(idealLeft, minInsideLamp);  // never outside lamp

      // set in stage coordinates
      copy.style.left = idealLeft + "px";
      copy.classList.add("show");
    });
  }

  /* ----------------- EVENTS ----------------- */
  dots.forEach(d=> d.addEventListener("click", ()=> setStep(+d.dataset.i)));
  prevBtn.addEventListener("click", ()=> setStep(step-1));
  nextBtn.addEventListener("click", ()=> setStep(step+1));
  addEventListener("resize", ()=>{ drawRail(); placeLamp(); drawScene(); }, {passive:true});
  railWrap.addEventListener("transitionend", e=>{
    if (e.propertyName==="left"||e.propertyName==="transform"){
      drawRail(); placeLamp(); drawScene();
    }
  });

  /* ----------------- INIT ----------------- */
  function init(){
    setStep(0);
    requestAnimationFrame(()=>{ drawRail(); placeLamp(); });
  }
  if (document.readyState === "complete") init();
  else addEventListener("load", init, {once:true});
})();