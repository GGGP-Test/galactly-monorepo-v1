// docs/sections/process/process.js
// Step rail (0–5). When step > 0 the rail docks left and a soft "lamp" wash
// blooms to the right to draw attention to the empty canvas area.
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- styles ----------
  const css = `
  :root{
    --accent:#63D3FF;           /* electric cyan for active */
    --accent-ink:#0b1117;
  }

  #section-process{position:relative}
  #section-process .proc-only{
    position:relative;
    min-height:500px;           /* slightly shorter for tighter scroll */
    padding:44px 16px;
    overflow:visible;
  }

  /* The lamp: a soft rightward glow that appears when docked */
  #section-process .lamp{
    position:absolute;
    top:50%;
    transform:translateY(-50%);
    left:0; width:0;            /* JS sets when docked */
    height:min(72vh,560px);
    pointer-events:none;
    opacity:0;
    z-index:0;
    transition:
      opacity .45s ease,
      left .45s cubic-bezier(.22,.61,.36,1),
      width .45s cubic-bezier(.22,.61,.36,1);
    /* layered gradients: cyan core + warm rim + faint scan lines */
    background:
      radial-gradient(120% 90% at 0% 50%, rgba(99,211,255,.28) 0%, rgba(99,211,255,.16) 32%, rgba(99,211,255,0) 70%),
      radial-gradient(80% 60% at 0% 50%, rgba(242,220,160,.18) 0%, rgba(242,220,160,0) 58%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 1px, transparent 1px 6px);
    filter:saturate(110%) blur(.4px);
    border-radius:16px;
  }
  /* slender divider line at the lamp's left edge */
  #section-process .lamp::before{
    content:"";
    position:absolute; inset:0 auto 0 -1px; width:2px;
    background:linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.02));
    box-shadow:0 0 10px rgba(99,211,255,.35), 0 0 26px rgba(240,210,120,.14);
    border-radius:2px;
  }

  /* Wrap that slides center → left */
  #section-process .railWrap{
    position:absolute;
    left:50%; top:50%;
    transform:translate(-50%,-50%);
    transition:left .45s cubic-bezier(.22,.61,.36,1), transform .45s cubic-bezier(.22,.61,.36,1);
    will-change:left, transform;
    z-index:2; /* above lamp */
  }
  #section-process .railWrap.is-docked{
    left:clamp(18px, 6vw, 80px);
    transform:translate(0,-50%);
  }

  #section-process .rail{
    position: relative;
    display:flex; flex-direction:column; align-items:center; gap:16px;
  }
  #section-process .rail-svg{
    position:absolute; inset:0; z-index:0; pointer-events:none; overflow:visible;
    filter: drop-shadow(0 0 6px rgba(99,211,255,.12));
  }

  /* Dots */
  #section-process .p-step{
    position:relative; z-index:1;
    width:50px; height:50px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    font:700 17px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    color:#eaf0f6; background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.12);
    backdrop-filter: blur(6px);
    box-shadow: 0 6px 16px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.04);
    cursor:pointer; user-select:none;
    transition: transform .12s ease, background .15s ease, box-shadow .15s ease, color .15s ease, border-color .15s ease;
  }
  #section-process .p-step:hover{ transform:translateY(-1px); background:rgba(255,255,255,.08); }

  /* Active: filled accent + inner glow + faint white rim */
  #section-process .p-step.is-current{
    color:var(--accent-ink);
    background:
      radial-gradient(circle at 50% 45%, rgba(255,255,255,.34), rgba(255,255,255,0) 60%),
      linear-gradient(180deg, var(--accent), #26b9ff);
    border-color:rgba(255,255,255,.22);
    box-shadow:
      0 14px 34px rgba(38,185,255,.30),
      0 0 0 2px rgba(255,255,255,.20) inset,
      0 0 18px rgba(99,211,255,.45);
  }
  #section-process .p-step.is-done{ opacity:.88 }

  /* Glass CTAs */
  #section-process .ctas{ display:flex; gap:10px; margin-top:16px; justify-content:center; }
  #section-process .btn-glass{
    padding:10px 14px; border-radius:999px;
    border:1px solid rgba(255,255,255,.14);
    background: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.04));
    color:#eaf0f6; font-weight:700; cursor:pointer; backdrop-filter: blur(8px);
    box-shadow:0 8px 24px rgba(0,0,0,.30), inset 0 0 0 1px rgba(255,255,255,.06);
    transition: transform .08s ease, filter .15s ease, box-shadow .15s ease;
  }
  #section-process .btn-glass:hover{ filter:brightness(1.06) }
  #section-process .btn-glass:active{ transform:translateY(1px) }
  #section-process .btn-glass[disabled]{ opacity:.45; cursor:not-allowed }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- markup ----------
  const steps = [0,1,2,3,4,5];
  mount.innerHTML = `
    <section class="proc-only" aria-label="Process">
      <div class="lamp" id="procLamp" aria-hidden="true"></div>
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

  // ---------- behavior ----------
  const stage   = mount.querySelector(".proc-only");
  const wrap    = mount.querySelector("#railWrap");
  const rail    = mount.querySelector("#rail");
  const svg     = mount.querySelector("#railSvg");
  const lamp    = mount.querySelector("#procLamp");
  const dotEls  = Array.from(mount.querySelectorAll(".p-step"));
  const prevBtn = mount.querySelector("#prevBtn");
  const nextBtn = mount.querySelector("#nextBtn");

  let step = 0;

  function setStep(n){
    step = Math.max(0, Math.min(steps.length-1, n|0));
    dotEls.forEach((el,i)=>{
      el.classList.toggle("is-current", i===step);
      el.classList.toggle("is-done", i<step);
    });
    prevBtn.disabled = (step<=0);
    nextBtn.disabled = (step>=steps.length-1);

    // Dock/undock
    wrap.classList.toggle("is-docked", step>0);

    drawConnectors();
    positionLamp();
  }

  // connectors between dot centers
  function drawConnectors(){
    const r = rail.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

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
      line.setAttribute("stroke-width", 2);
      line.setAttribute("stroke-linecap","round");
      svg.appendChild(line);
    }
  }

  // Lamp follows the rail's right edge and fills the remaining area
  function positionLamp(){
    if (!lamp) return;
    const stageR = stage.getBoundingClientRect();
    const wrapR  = wrap.getBoundingClientRect();

    if (step>0){
      const gap = 24; // breathing space between rail and glow
      const left = Math.max(0, wrapR.right + gap - stageR.left);
      const width = Math.max(260, stageR.right - stageR.left - left - 12);
      lamp.style.left = left + "px";
      lamp.style.width = width + "px";
      lamp.style.opacity = "0.38";  // subtle; tweakable
    }else{
      lamp.style.opacity = "0";
      lamp.style.width   = "0px";
      lamp.style.left    = "0px";
    }
  }

  // events
  dotEls.forEach(el => el.addEventListener("click", ()=> setStep(+el.dataset.i)));
  prevBtn.addEventListener("click", ()=> setStep(step-1));
  nextBtn.addEventListener("click", ()=> setStep(step+1));

  addEventListener("resize", ()=>{
    drawConnectors();
    positionLamp();
  }, {passive:true});

  // re-measure after slide completes
  wrap.addEventListener("transitionend", e=>{
    if (e.propertyName==="left" || e.propertyName==="transform"){
      drawConnectors();
      positionLamp();
    }
  });

  // initial
  setStep(0);
})();