// docs/sections/process/process.js
// Score Carousel v1 — 3D ring of category panels driven by the left rail.
// One-file drop-in. Uses window.PROCESS_DATA() if present.
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- Data ----------
  const DATA =
    (window.PROCESS_DATA && window.PROCESS_DATA()) || {
      title: "How the scoring engine works",
      sub: "We score each lead across four lenses, then surface the fastest wins.",
      columns: [],
      result: { title: "Result", bullets: [] },
      steps: [],
    };

  // ---------- Scoped CSS (kept inline so you can preview without another file) ----------
  if (!document.getElementById("proc3dStyles")) {
    const css = `
:root{
  --railW: 380px;
  --topStick: 96px;
  --card:#0c1420;
  --stroke:#1b2531;
  --muted:#8ea7bd;
  --chip:#0e1930;
  --gold:#e6c36b;
  --glow: rgba(230,195,107,.16);
}
.proc3 { padding: 72px 16px; }
.proc3 .inner { max-width: 1140px; margin: 0 auto; }
.proc3-hd h2 { margin:0 0 6px; font:600 clamp(22px,3.6vw,30px) "Newsreader", Georgia, serif;}
.proc3-hd .sub { color: var(--muted); font-size:14px; margin-bottom: 18px; }

.proc3-grid { display:grid; grid-template-columns: var(--railW) 1fr; gap:24px; align-items:start; }

.proc3-rail { position: sticky; top: var(--topStick); padding: 14px 0; }
.proc3-steps { position:relative; margin-left: 22px; }
.proc3-progress { position:absolute; left:9px; top:0; bottom:0; width:2px; background:linear-gradient(180deg,var(--glow),transparent); border-radius:2px; opacity:.7; }
.proc3-step { position:relative; padding:12px 0 14px; }
.proc3-step h3 { margin:0 0 4px; font-weight:800; font-size:16px; }
.proc3-step p { margin:0; color:var(--muted); font-size:14px; }
.proc3-bullet { position:absolute; left:-22px; top:18px; width:9px; height:9px; border-radius:50%;
  background:radial-gradient(circle at 40% 40%, var(--glow), #fff0);
  box-shadow:0 0 0 2px rgba(255,255,255,.06);
}
.proc3-step.is-current h3 { color:#fff; }
.proc3-step.is-current .proc3-bullet { box-shadow:0 0 0 3px rgba(230,195,107,.25), 0 0 12px rgba(230,195,107,.45);
  background:radial-gradient(circle at 40% 40%, #f2dca0, #fff0);
}
.proc3-step.is-done .proc3-bullet{ background:#9aacc0; }

.stage { position:relative; height: 520px; border-radius:16px;
  background: radial-gradient(1200px 520px at 60% 40%, rgba(230,195,107,.08), transparent 60%),
              linear-gradient(180deg,#0b121d,#0b1119);
  border:1px solid var(--stroke);
  overflow:hidden;
}
@media (max-width: 980px){ .stage{ height: 520px; } }
@media (max-width: 760px){ .stage{ height: 500px; } }

.r3d-wrap { position:absolute; inset:0; perspective: 1200px; perspective-origin: 60% 50%; }
.r3d-belt { position:absolute; left:50%; top:50%; transform-style: preserve-3d; transition: transform .9s cubic-bezier(.2,.8,.2,1); }

.panel { position:absolute; width: 380px; transform-style: preserve-3d;
  border:1px solid var(--stroke); border-radius:16px; padding:12px; color:#dbe8f5;
  background: linear-gradient(180deg, #0e1726, #0b1322);
  box-shadow:0 20px 60px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.05) inset;
}
.panel .ph { display:flex; align-items:center; gap:10px; margin-bottom:10px; font-weight:800; }
.panel .ph .pill { font-size:12px; border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.03); padding:6px 10px; border-radius:999px; }
.panel .chips { display:grid; grid-template-columns:1fr; gap:8px; }
.chip { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:999px;
  border:1px solid rgba(255,255,255,.06);
  background: linear-gradient(180deg, var(--chip), #0a1524);
  box-shadow:0 8px 18px rgba(0,0,0,.25);
}
.chip .ico{ width:18px; text-align:center; }
.panel.result { background: linear-gradient(180deg, #0f1d2e, #0c1626); }
.panel.result ul{ margin:4px 0 0; padding-left:18px; }
.panel.result h4{ margin:6px 0 6px; }

.panel.is-front { box-shadow:0 30px 90px rgba(230,195,107,.18), 0 0 0 1px rgba(230,195,107,.18) inset; }
.panel.dim .chip { opacity:.35; filter:grayscale(.2); }

.stage-tip{ position:absolute; right:12px; bottom:12px; font-size:12px; color:var(--muted); background:rgba(255,255,255,.04);
  border:1px solid var(--stroke); border-radius:10px; padding:6px 8px; }

@media (max-width: 980px){
  :root{ --railW: 100%; }
  .proc3-grid{ grid-template-columns:1fr; }
  .proc3-rail{ position: static; }
}
@media (max-width: 640px){
  .r3d-wrap{ perspective: 900px; }
  .panel{ width: 300px; }
}
    `;
    const style = document.createElement("style");
    style.id = "proc3dStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- Markup ----------
  function chipsHTML(nodes = []) {
    return nodes
      .map(
        (n) => `
      <button class="chip" data-node="${n.id}">
        <span class="ico">${n.emoji || "•"}</span>
        <span class="lbl">${n.label}</span>
      </button>`
      )
      .join("");
  }

  const panelsHTML = DATA.columns
    .map(
      (col) => `
      <section class="panel" data-col="${col.id}">
        <div class="ph"><span class="pill">${col.emoji || ""} ${col.label}</span></div>
        <div class="chips">${chipsHTML(col.nodes)}</div>
      </section>`
    )
    .join("") +
    `
    <section class="panel result" data-col="result">
      <div class="ph"><span class="pill">🎯 ${DATA.result.title}</span></div>
      <h4>What you get</h4>
      <ul>${(DATA.result.bullets || []).map((b) => `<li>${b}</li>`).join("")}</ul>
    </section>
  `;

  const stepsHTML = (DATA.steps || [])
    .map(
      (s) => `
      <div class="proc3-step" data-step="${s.id}">
        <div class="proc3-bullet"></div>
        <h3>${s.title}</h3>
        <p>${s.body}</p>
      </div>`
    )
    .join("");

  mount.innerHTML = `
  <section class="proc3" aria-label="Process">
    <div class="inner">
      <header class="proc3-hd">
        <h2>${DATA.title}</h2>
        <div class="sub">${DATA.sub}</div>
      </header>

      <div class="proc3-grid">
        <aside class="proc3-rail">
          <div class="proc3-steps" id="steps">
            <div class="proc3-progress" id="prog"></div>
            ${stepsHTML}
          </div>
        </aside>

        <div class="stage" id="stage">
          <div class="r3d-wrap">
            <div class="r3d-belt" id="belt">
              ${panelsHTML}
            </div>
          </div>
          <div class="stage-tip">Drag to rotate • Click a chip or step</div>
        </div>
      </div>
    </div>
  </section>`;

  // ---------- 3D layout ----------
  const belt = mount.querySelector("#belt");
  const panels = Array.from(mount.querySelectorAll(".panel"));
  const steps = Array.from(mount.querySelectorAll(".proc3-step"));
  const prog = mount.querySelector("#prog");
  const stage = mount.querySelector("#stage");
  const prefersReduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let radius = 480; // distance from center
  let angleStep = (Math.PI * 2) / panels.length;
  let currentIdx = 0;
  let rotY = 0;

  function layout3D() {
    const w = stage.clientWidth;
    radius = Math.max(380, Math.min(620, Math.floor(w * 0.55)));
    angleStep = (Math.PI * 2) / panels.length;
    const panelW = panels[0]?.offsetWidth || 360;
    // place each panel around the ring
    panels.forEach((p, i) => {
      const ang = i * angleStep;
      const x = Math.sin(ang) * radius;
      const z = Math.cos(ang) * radius;
      p.style.transform = `translate3d(${-panelW / 2 + x}px,-180px,${z}px) rotateY(${ang}rad)`;
    });
    updateFrontClass();
    updateBelt();
  }

  function updateBelt() {
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2 + 40;
    belt.style.transform = `translate3d(${cx}px,${cy}px,0) rotateY(${rotY}rad)`;
  }

  function snapTo(index) {
    currentIdx = (index + panels.length) % panels.length;
    rotY = -currentIdx * angleStep;
    updateBelt();
    updateFrontClass();
    dimByActive();
  }

  function updateFrontClass() {
    const frontIdx = ((Math.round(-rotY / angleStep) % panels.length) + panels.length) % panels.length;
    panels.forEach((p, i) => p.classList.toggle("is-front", i === frontIdx));
  }

  function dimByActive() {
    const front = panels.findIndex((p) => p.classList.contains("is-front"));
    panels.forEach((p, i) => p.classList.toggle("dim", i !== front));
  }

  // ---------- Rail logic ----------
  function updateProgress() {
    const rail = mount.querySelector("#steps");
    const r = rail.getBoundingClientRect();
    const vh = innerHeight;
    const t = Math.max(0, Math.min(1, (vh * 0.15 - r.top) / (r.height - vh * 0.3)));
    prog.style.height = t * r.height + "px";
  }

  function setActiveById(colId) {
    // mark steps
    let passed = true;
    steps.forEach((s) => s.classList.remove("is-current", "is-done"));
    steps.forEach((s) => {
      if (passed && s.dataset.step !== colId) s.classList.add("is-done");
      else passed = false;
    });
    const cur = steps.find((s) => s.dataset.step === colId);
    if (cur) cur.classList.add("is-current");

    // rotate belt to that panel
    const idx = panels.findIndex((p) => p.dataset.col === colId);
    if (idx >= 0) snapTo(idx);
    // intro/result relaxes dimming
    if (colId === "intro" || colId === "result") {
      panels.forEach((p) => p.classList.remove("dim"));
    }
  }

  // Observe step entries -> drive rotation
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        setActiveById(e.target.dataset.step);
        updateProgress();
      });
    },
    { threshold: 0.55 }
  );
  steps.forEach((s) => io.observe(s));

  // Click chip → scroll left rail to that step (and rotate)
  mount.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      const colId = chip.closest(".panel")?.dataset.col;
      const tgt = steps.find((s) => s.dataset.step === colId);
      if (tgt) tgt.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveById(colId);
    });
  });

  // Drag rotate
  let dragging = false, prevX = 0, v = 0, raf = 0;
  const onDown = (e) => { dragging = true; prevX = e.clientX || (e.touches && e.touches[0].clientX) || 0; belt.style.transition = "none"; cancelAnimationFrame(raf); };
  const onMove = (e) => {
    if (!dragging) return;
    const x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const dx = x - prevX;
    prevX = x;
    v = dx * 0.0045;
    rotY += v;
    updateBelt();
    updateFrontClass();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    // inertial snap
    const target = Math.round(-rotY / angleStep);
    const dest = -target * angleStep;
    belt.style.transition = prefersReduced ? "transform .35s ease-out" : "transform .9s cubic-bezier(.2,.8,.2,1)";
    rotY = dest;
    updateBelt();
    updateFrontClass();
    dimByActive();
  };
  stage.addEventListener("mousedown", onDown);
  stage.addEventListener("touchstart", onDown, { passive: true });
  addEventListener("mousemove", onMove, { passive: true });
  addEventListener("touchmove", onMove, { passive: true });
  addEventListener("mouseup", onUp, { passive: true });
  addEventListener("touchend", onUp, { passive: true });

  // Init
  layout3D();
  snapTo(0);
  updateProgress();

  addEventListener("resize", layout3D, { passive: true });
  addEventListener("scroll", updateProgress, { passive: true });
})();