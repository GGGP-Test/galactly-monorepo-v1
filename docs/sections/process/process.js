// docs/sections/process/process.js
// Pathrail v3 — clean, guided, responsive (one column for the story, one for the board)
(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------- DATA ----------
  const DATA = (window.PROCESS_DATA && window.PROCESS_DATA()) || {
    title: "How the scoring engine works",
    sub: "We score each lead across four lenses, then surface the fastest wins.",
    columns: [],
    result: { title: "Result", bullets: [] },
    steps: [],
  };

  // ---------- SAFETY STYLES (scoped) ----------
  // Kept here to avoid asking you for another file. Remove if you prefer the external CSS.
  if (!document.getElementById("procV3Styles")) {
    const css = `
:root{
  --proc-rail-w: 380px;
  --proc-top: 96px;
  --proc-card: #0d1420;
  --proc-stroke: #1b2531;
  --proc-muted: #8ea7bd;
  --proc-chip: #0f1a2a;
  --proc-glow: rgba(230,195,107,.15);
}
.proc{padding:72px 16px}
.proc .inner{max-width:1140px;margin:0 auto}
.proc-hd h2{font:600 clamp(22px,3.6vw,30px) "Newsreader", Georgia, serif;margin:0 0 6px}
.proc-hd .sub{color:var(--proc-muted);font-size:14px;margin-bottom:18px}
.proc-grid{display:grid;grid-template-columns:var(--proc-rail-w) 1fr;gap:24px;align-items:start}
.proc-rail{position:sticky;top:var(--proc-top);padding:14px 0}
.proc-progress{position:absolute;left:9px;top:0;bottom:0;width:2px;background:linear-gradient(180deg,var(--proc-glow),transparent);border-radius:2px;opacity:.6}
.proc-steps{position:relative;margin-left:22px}
.proc-step{position:relative;padding:12px 0 14px 0}
.proc-step h3{margin:0 0 4px;font-weight:800;font-size:16px}
.proc-step p{margin:0;color:var(--proc-muted);font-size:14px}
.proc-bullet{position:absolute;left:-22px;top:18px;width:9px;height:9px;border-radius:50%;
  background:radial-gradient(circle at 40% 40%, var(--proc-glow), #fff0);box-shadow:0 0 0 2px rgba(255,255,255,.06)}
.proc-step.is-current h3{color:#fff}
.proc-step.is-current .proc-bullet{box-shadow:0 0 0 3px rgba(230,195,107,.25), 0 0 12px rgba(230,195,107,.4);background:radial-gradient(circle at 40% 40%, #f2dca0, #fff0)}
.proc-step.is-done .proc-bullet{background:#99a9b8}
.proc-board{display:grid;gap:16px}
.proc-group{border:1px solid var(--proc-stroke);background:linear-gradient(180deg,#0c1420,#0b111a);border-radius:14px;padding:12px 12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.proc-group .ghd{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-weight:800}
.proc-group .ghd .pill{font-size:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);padding:6px 10px;border-radius:999px}
.proc-group .chips{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.proc-chip{display:flex;align-items:center;gap:8px;justify-content:flex-start;padding:10px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.06);
  background:linear-gradient(180deg,var(--proc-chip), #0a1524);box-shadow:0 8px 20px rgba(0,0,0,.25)}
.proc-chip .ico{width:18px;text-align:center}
.proc-chip.dim{opacity:.35;filter:grayscale(.2)}
.proc-result{border:1px solid var(--proc-stroke);background:linear-gradient(180deg,#0c1420,#0b111a);border-radius:14px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.proc-result h4{margin:4px 0 8px;font-weight:800}
.proc-result ul{margin:0;padding-left:18px;color:#cfe0ee}
.proc-hint{font-size:12px;color:var(--proc-muted)}
/* micro-parallax */
.proc-board .proc-group{will-change:transform;transition:transform .25s ease-out, box-shadow .25s ease-out}
.proc-group.is-active{box-shadow:0 16px 50px rgba(230,195,107,.12), 0 0 0 1px rgba(230,195,107,.18) inset}
@media (max-width: 980px){
  :root{--proc-rail-w: 100%}
  .proc-grid{grid-template-columns:1fr}
  .proc-rail{position:static}
  .proc-step{padding:10px 0 12px}
  .proc-board .proc-group .chips{grid-template-columns:1fr}
}`;
    const style = document.createElement("style");
    style.id = "procV3Styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- MARKUP ----------
  function chipsHTML(nodes) {
    return nodes
      .map(
        (n) =>
          `<button class="proc-chip" data-node="${n.id}">
            <span class="ico">${n.emoji || "•"}</span><span class="lbl">${n.label}</span>
          </button>`
      )
      .join("");
  }

  const boardHTML = DATA.columns
    .map(
      (col) => `
      <section class="proc-group" data-col="${col.id}">
        <div class="ghd">
          <span class="pill">${col.emoji || ""} ${col.label}</span>
        </div>
        <div class="chips">${chipsHTML(col.nodes || [])}</div>
      </section>`
    )
    .join("") +
    `<section class="proc-result">
        <h4>🎯 ${DATA.result.title}</h4>
        <ul>${(DATA.result.bullets || [])
          .map((b) => `<li>${b}</li>`)
          .join("")}</ul>
        <div class="proc-hint">This is the output you act on.</div>
     </section>`;

  const stepsHTML = (DATA.steps || [])
    .map(
      (s) => `
      <div class="proc-step" data-step="${s.id}">
        <div class="proc-bullet"></div>
        <h3>${s.title}</h3>
        <p>${s.body}</p>
      </div>`
    )
    .join("");

  mount.innerHTML = `
  <section class="proc" aria-label="Process">
    <div class="inner">
      <header class="proc-hd">
        <h2>${DATA.title}</h2>
        <div class="sub">${DATA.sub}</div>
      </header>

      <div class="proc-grid">
        <aside class="proc-rail">
          <div class="proc-steps" id="procSteps">
            <div class="proc-progress" id="procProg"></div>
            ${stepsHTML}
          </div>
        </aside>

        <div class="proc-board" id="procBoard">
          ${boardHTML}
        </div>
      </div>
    </div>
  </section>`;

  // ---------- INTERACTION ----------
  const rail = mount.querySelector("#procSteps");
  const prog = mount.querySelector("#procProg");
  const steps = Array.from(mount.querySelectorAll(".proc-step"));
  const groups = Array.from(mount.querySelectorAll(".proc-group"));
  const chips = Array.from(mount.querySelectorAll(".proc-chip"));
  const prefersReduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Progress line and current step
  function updateProgress() {
    const r = rail.getBoundingClientRect();
    const vh = innerHeight;
    const t = Math.max(0, Math.min(1, (vh * 0.15 - r.top) / (r.height - vh * 0.3)));
    prog.style.height = t * r.height + "px";
  }

  function setActive(colId) {
    // steps state
    let passed = true;
    steps.forEach((s) => {
      s.classList.remove("is-current", "is-done");
    });
    steps.forEach((s) => {
      if (passed && s.dataset.step !== colId) s.classList.add("is-done");
      else passed = false;
    });
    const cur = steps.find((s) => s.dataset.step === colId);
    if (cur) cur.classList.add("is-current");

    // dim chips not in the active column
    groups.forEach((g) => {
      const active = g.dataset.col === colId;
      g.classList.toggle("is-active", active);
      g.querySelectorAll(".proc-chip").forEach((c) =>
        c.classList.toggle("dim", colId && !active)
      );
    });
  }

  // Observe steps to drive state
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const id = e.target.dataset.step;
        if (id === "intro" || id === "result") {
          groups.forEach((g) => {
            g.classList.remove("is-active");
            g.querySelectorAll(".proc-chip").forEach((c) => c.classList.remove("dim"));
          });
        } else {
          setActive(id);
        }
        updateProgress();
      });
    },
    { threshold: 0.55 }
  );
  steps.forEach((s) => io.observe(s));

  // Click chip -> scroll rail to its step
  chips.forEach((chip) => {
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      const colId = chip.closest(".proc-group")?.dataset.col;
      const tgt = steps.find((s) => s.dataset.step === colId);
      if (tgt) tgt.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  // Micro-parallax on the groups panel
  const board = mount.querySelector("#procBoard");
  let lastY = window.scrollY;
  function parallax() {
    if (prefersReduced) return;
    const rect = board.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const delta = Math.max(-1, Math.min(1, (innerHeight / 2 - center) / (innerHeight / 2)));
    groups.forEach((g, i) => {
      const depth = (i % 3) * 4; // different layers
      g.style.transform = `translateY(${delta * depth}px)`;
    });
  }

  // Initial + listeners
  updateProgress();
  setActive("intent");
  addEventListener("scroll", () => {
    updateProgress();
    parallax();
    lastY = window.scrollY;
  }, { passive: true });
  addEventListener("resize", () => {
    updateProgress();
    parallax();
  });
})();