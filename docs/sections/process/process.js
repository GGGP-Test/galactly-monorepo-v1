// docs/sections/process/process.js
// Minimal STEP 0 rail only: centered 0–5 + glass Prev/Next. No titles, no panels.
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- scoped styles ----------
  const css = `
  #section-process { position: relative; }
  #section-process .proc-only {
    min-height: 520px;
    padding: 48px 16px;
    display: grid;
    place-items: center;            /* centers the whole rail block */
  }
  #section-process .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }
  /* circles */
  #section-process .p-step {
    width: 56px; height: 56px;
    border-radius: 50%;
    display: flex;                  /* perfect centering of numbers */
    align-items: center;
    justify-content: center;
    font: 700 18px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    color: #eaf0f6;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    backdrop-filter: blur(6px);
    box-shadow: 0 6px 18px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.04);
    cursor: pointer; user-select: none;
    transition: transform .12s ease, background .15s ease, box-shadow .15s ease;
  }
  #section-process .p-step:hover { transform: translateY(-1px); background: rgba(255,255,255,.08); }
  #section-process .p-step.is-current {
    box-shadow: 0 0 0 2px rgba(230,195,107,.8), 0 10px 28px rgba(230,195,107,.18);
  }
  #section-process .p-step.is-done { opacity: .7; }

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
        ${steps.map(i=>`<button class="p-step" data-i="${i}">${i}</button>`).join("")}
        <div class="ctas">
          <button class="btn-glass" id="prevBtn" type="button">Prev step</button>
          <button class="btn-glass" id="nextBtn" type="button">Next step</button>
        </div>
      </div>
    </section>
  `;

  // ---------- behavior ----------
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
  }
  dotEls.forEach(el => el.addEventListener("click", ()=> setStep(+el.dataset.i)));
  prevBtn.addEventListener("click", ()=> setStep(step-1));
  nextBtn.addEventListener("click", ()=> setStep(step+1));

  // initial
  setStep(0);
})();