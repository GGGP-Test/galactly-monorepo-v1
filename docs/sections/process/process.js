// docs/sections/process/process.js
// STEP 1: Numbers-only stepper (no workflow UI yet)
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ------- inline styles (scoped) -------
  const css = `
  #section-process .proc-shell{padding:72px 16px}
  #section-process .proc-inner{max-width:1140px;margin:0 auto;display:grid;grid-template-columns:260px 1fr;gap:28px}
  @media (max-width:900px){#section-process .proc-inner{grid-template-columns:1fr}}
  #section-process .proc-hd h2{margin:0 0 8px;font:600 clamp(22px,3.4vw,30px) "Newsreader", Georgia, serif}
  #section-process .proc-hd .sub{color:#9cb1c3}

  /* vertical number stepper */
  #section-process .p-dock{position:relative}
  #section-process .p-stepper{display:flex;flex-direction:column;align-items:center;gap:18px;padding:12px 0}
  #section-process .p-step{display:grid;place-items:center; width:56px;height:56px;border-radius:999px;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10); backdrop-filter: blur(6px);
    box-shadow:0 6px 18px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.04);
    font:700 18px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#eaf0f6; cursor:pointer; user-select:none;
    transition:transform .15s ease, box-shadow .15s ease, background .15s ease}
  #section-process .p-step:hover{transform:translateY(-1px); background:rgba(255,255,255,.08)}
  #section-process .p-step.is-current{outline:0; box-shadow:0 0 0 2px rgba(230,195,107,.75), 0 10px 28px rgba(230,195,107,.18)}
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

  /* hide any future board until you ask for it */
  #section-process .p-board{display:none}
  `;
  const style = document.createElement("style");
  style.textContent = css; document.head.appendChild(style);

  // ------- safe data ingest (only to count steps) -------
  function getPD() {
    try {
      const PD = window.PROCESS_DATA;
      if (typeof PD === "function") return PD();
      return PD || null;
    } catch { return null; }
  }
  const RAW = getPD() || {};
  const cols = Array.isArray(RAW.columns) && RAW.columns.length ? RAW.columns : [
    {id:"intent"},{id:"weight"},{id:"character"},{id:"platform"}
  ];
  // steps: 0 for “start”, then one per column, then “result”
  const TOTAL = cols.length + 2; // 0 .. (TOTAL-1)

  // ------- markup (numbers only) -------
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
        <div class="p-stepper" id="pStepper">
          ${dotsHTML}
        </div>
        <div class="p-ctas">
          <button class="btn-glass" id="pPrev" type="button">Prev step</button>
          <button class="btn-glass" id="pNext" type="button">Next step</button>
        </div>
      </aside>

      <!-- Reserved for later; intentionally hidden for Step 1 -->
      <div class="p-board" id="pBoard" aria-hidden="true"></div>
    </div>
  </section>`;

  // ------- behaviour (highlight + prev/next only) -------
  const stepper = mount.querySelector("#pStepper");
  const prevBtn = mount.querySelector("#pPrev");
  const nextBtn = mount.querySelector("#pNext");
  const dotEls  = Array.from(stepper.querySelectorAll(".p-step"));

  let step = 0;
  function setStep(n){
    step = Math.max(0, Math.min(TOTAL-1, n|0));
    dotEls.forEach((el,i)=>{
      el.classList.toggle("is-current", i===step);
      el.classList.toggle("is-done", i<step);
    });
    prevBtn.disabled = (step<=0);
    nextBtn.disabled = (step>=TOTAL-1);
    // Do not reveal board yet. We’ll hook the workflow in the next step you request.
  }
  dotEls.forEach(el=> el.addEventListener("click", ()=> setStep(+el.dataset.i)));
  prevBtn.addEventListener("click", ()=> setStep(step-1));
  nextBtn.addEventListener("click", ()=> setStep(step+1));

  // initial
  setStep(0);
})();