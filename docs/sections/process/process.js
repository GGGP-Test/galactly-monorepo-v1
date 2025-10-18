// docs/sections/process/process.js
// Minimal STEP rail with filled accent on active + connectors between circles.
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- scoped styles ----------
  const css = `
  :root{
    /* cool complement to gold */
    --accent:#63D3FF;              /* electric cyan */
    --accent-ink:#0b1117;          /* readable text on accent */
  }
  #section-process { position: relative; }
  #section-process .proc-only {
    min-height: 520px;
    padding: 48px 16px;
    display: grid;
    place-items: center;
  }
  #section-process .rail {
    position: relative;            /* for SVG positioning */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }
  /* connectors svg sits behind the buttons */
  #section-process .rail-svg{
    position:absolute; inset:0;
    z-index:0; pointer-events:none; overflow:visible;
    filter: drop-shadow(0 0 6px rgba(99,211,255,.15));
  }
  /* circles */
  #section-process .p-step {
    position: relative;
    z-index:1;
    width: 56px; height: 56px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font: 700 18px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    color: #eaf0f6;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    backdrop-filter: blur(6px);
    box-shadow: 0 6px 18px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.04);
    cursor: pointer; user-select: none;
    transition: transform .12s ease, background .15s ease, box-shadow .15s ease, color .15s ease, border-color .15s ease;
  }
  #section-process .p-step:hover { transform: translateY(-1px); background: rgba(255,255,255,.08); }
  /* ACTIVE = filled accent (not just a ring) */
  #section-process .p-step.is-current{
    background: linear-gradient(180deg, var(--accent), #26b9ff);
    color: var(--accent-ink);
    border-color: rgba(255,255,255,.18);
    box-shadow: 0 12px 30px rgba(38,185,255,.28), 0 0 0 1px rgba(255,255,255,.05) inset;
  }
  #section-process .p-step.is-done { opacity: .85; }

  /* glass buttons */
  #section-process .ctas { display:flex; gap:10px; margin-top:16px; justify-content:center; }
  #section-process .btn-glass {
    padding: 10px 14px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,.14);
    background: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.04));
    color:#eaf0f6; font-weight:700; cursor:pointer; backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0,0,0,.30), inset 0 0 0 1px rgba(255,255,255,.06);
    transition: transform .08s ease, filter .15s ease, box-shadow .15s ease;
  }
  #section-process .btn-glass:hover { filter: brightness(1.06); }
  #section-process .btn-glass:active { transform: translateY(1px); }
  #section-process .btn-glass[disabled]{ opacity:.45; cursor:not-allowed; }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- markup ----------
  const steps = [0,1,2,3,4,5];
  mount.innerHTML = `
    <section class="proc-only" aria-label="Process">
      <div class="rail" id="rail">
        <svg class="rail-svg" id="railSvg" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>
        ${steps.map(i=>`<button class="p-step" data-i="${i}">${i}</button>`).join("")}
        <div class="ctas">
          <button class="btn-glass" id="prevBtn" type="button">Prev step</button>
          <button class="btn-glass" id="nextBtn" type="button">Next step</button>
        </div>
      </div>
    </section>
  `;

  // ---------- behavior ----------
  const rail   = mount.querySelector("#rail");
  const svg    = mount.querySelector("#railSvg");
  const dotEls = Array.from(mount.querySelectorAll(".p-step"));
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
    drawConnectors();
  }

  // draw subtle connectors between consecutive dots
  function drawConnectors(){
    if (!svg) return;
    // size svg to rail box
    const r = rail.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);

    // clear
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // collect centers
    const pts = dotEls.map(el=>{
      const b = el.getBoundingClientRect();
      return { x: (b.left + b.right)/2 - r.left, y: (b.top + b.bottom)/2 - r.top };
    });

    // draw segments
    for (let i=0;i<pts.length-1;i++){
      const a = pts[i], b = pts[i+1];
      const p = document.createElementNS("http://www.w3.org/2000/svg","line");
      p.setAttribute("x1", a.x); p.setAttribute("y1", a.y);
      p.setAttribute("x2", b.x); p.setAttribute("y2", b.y);
      // slightly brighter before the current dot
      const isTrail = i < step;
      const stroke = isTrail ? "rgba(99,211,255,.55)" : "rgba(255,255,255,.14)";
      p.setAttribute("stroke", stroke);
      p.setAttribute("stroke-width", 2);
      p.setAttribute("stroke-linecap","round");
      svg.appendChild(p);
    }
  }

  dotEls.forEach(el => el.addEventListener("click", ()=> setStep(+el.dataset.i)));
  prevBtn.addEventListener("click", ()=> setStep(step-1));
  nextBtn.addEventListener("click", ()=> setStep(step+1));
  addEventListener("resize", drawConnectors, {passive:true});

  // initial
  setStep(0);
})();