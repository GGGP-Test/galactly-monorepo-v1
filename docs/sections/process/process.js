// docs/sections/process/process.js
(() => {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  /* ----------------- GLOBAL REGISTRY + DEFAULT CONFIG ----------------- */
  // Other step files register themselves here, e.g. window.PROCESS_SCENES[1] = (ctx)=>{...}
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_CONFIG = Object.assign(
    {
      // Step 0 reserved knobs (kept here, even though Step 0 is visually empty for now)
      step0: {
        // example future knobs if you decide to draw in step 0 later:
        COPY_LEFT_PX: 24,
        COPY_TOP_PX: 10
      }
    },
    window.PROCESS_CONFIG || {}
  );

  /* ----------------- SCOPED STYLES (unchanged look) ----------------- */
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
  #section-process .p-step.is-done{ position:relative }
  #section-process .p-step.is-done::after{
    content:"✓"; position:absolute; inset:auto auto 6px 50%; transform:translateX(-50%); font-size:12px; opacity:.9;
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

  /* lamp seam */
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

  /* canvas + copy */
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

  /* ----------------- SHARED HELPERS ----------------- */
  const ns = "http://www.w3.org/2000/svg";

  function bounds(){
    const s = stage.getBoundingClientRect();
    const w = railWrap.getBoundingClientRect();
    const gap = 56;
    const left = Math.max(0, w.right + gap - s.left);
    const width = Math.max(380, s.right - s.left - left - 16);
    return { sLeft:s.left, sTop:s.top, sW:s.width, sH:s.height, left, width, top:18, railRight:w.right - s.left };
  }

  function mountCopy({ top, left, html }){
    const el = document.createElement("div");
    el.className = "copy";
    el.style.top  = `${top}px`;
    el.style.left = `${left}px`;
    el.innerHTML  = html;
    canvas.appendChild(el);
    requestAnimationFrame(()=> el.classList.add("show"));
    return el;
  }

  function placeLamp(){
    const b = bounds();
    // Lamp only shows when step > 0 (so Step 0 is visually empty and isolated)
    if (step>0){
      lamp.style.left  = b.left + "px";
      lamp.style.width = b.width + "px";
      lamp.style.opacity = ".32";
    } else{
      lamp.style.opacity = "0";
      lamp.style.width   = "0px";
    }
  }

  function clearCanvas(){ while (canvas.firstChild) canvas.removeChild(canvas.firstChild); }

  /* ----------------- RAIL DRAWING ----------------- */
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
      const line = document.createElementNS(ns,"line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      line.setAttribute("stroke", i<step ? "rgba(99,211,255,.70)" : "rgba(255,255,255,.12)");
      line.setAttribute("stroke-width", 2); line.setAttribute("stroke-linecap","round");
      railSvg.appendChild(line);
    }
  }

  /* ----------------- SCENE ROUTER ----------------- */
  let step = 0;

  function drawScene(){
    clearCanvas();
    if (step === 0){
      // Intentionally empty (keeps Step 0 isolated from other files)
      return;
    }
    // External scenes (step1..step5) register themselves on window.PROCESS_SCENES
    const scene = window.PROCESS_SCENES[step];
    if (typeof scene === "function"){
      scene({ canvas, bounds: bounds(), mountCopy });
    }
  }

  function setStep(n){
    step = Math.max(0, Math.min(steps.length-1, n|0));
    dots.forEach((el,i)=>{ el.classList.toggle("is-current", i===step); el.classList.toggle("is-done", i<step); });
    prevBtn.disabled = step<=0; nextBtn.disabled = step>=steps.length-1;
    railWrap.classList.toggle("is-docked", step>0);
    drawRail();
    placeLamp();
    drawScene();
  }

  /* ----------------- EVENTS + PUBLIC REPAINT ----------------- */
  dots.forEach(d=> d.addEventListener("click", ()=> setStep(+d.dataset.i)));
  prevBtn.addEventListener("click", ()=> setStep(step-1));
  nextBtn.addEventListener("click", ()=> setStep(step+1));
  addEventListener("resize", ()=>{ drawRail(); placeLamp(); drawScene(); }, {passive:true});
  railWrap.addEventListener("transitionend", e=>{
    if (e.propertyName==="left"||e.propertyName==="transform"){
      drawRail(); placeLamp(); drawScene();
    }
  });

  // expose a repaint helper so you can tweak knobs then refresh without reloading
  window.PROCESS_REPAINT = () => { drawRail(); placeLamp(); drawScene(); };

  /* ----------------- INIT ----------------- */
  function init(){
    setStep(0);
    requestAnimationFrame(()=>{ drawRail(); placeLamp(); });
  }
  if (document.readyState === "complete") init();
  else addEventListener("load", init, {once:true});
})();