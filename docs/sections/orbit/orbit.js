/* docs/sections/orbit/orbit.js
   Section 3 (Orbit) — behavior/render only (no external deps).
   - One ring, perfect circle
   - Slow rotation; stops on prefers-reduced-motion
   - Emoji icons; click opens a small info card
*/

(() => {
  const root = document.getElementById("section-orbit");
  if (!root) return;

  // --- personalize domain chip from onboarding ---
  const LS = window.localStorage;
  let host = "yourcompany.com";
  try {
    const seed = JSON.parse(LS.getItem("onb.seed") || "{}");
    host = seed?.host || host;
  } catch {}

  // --- data (mirrors your categories) — all share the same ring ---
  const nodes = [
    { id: "buyers",     label: "Buyers",       icon: "👥" },
    { id: "buyerHeat",  label: "Buyer Heat",   icon: "🔥" },
    { id: "hiring",     label: "Hiring",       icon: "🧑‍💼" },
    { id: "marketBuzz", label: "Market Buzz",  icon: "📣" },
    { id: "rfp",        label: "RFPs & Docs",  icon: "📄" },
    { id: "competition",label: "Competition",  icon: "⚔️" },
  ];

  // --- build DOM ---
  root.innerHTML = `
    <section class="orbit-section" aria-label="Where your buyers light up">
      <div class="orbit-inner">
        <div class="orbit-hd">
          <h2>Where your buyers light up</h2>
          <div class="sub">Simple orbit map of the strongest intent signals for <span style="color:var(--gold-300)">${host}</span></div>
        </div>
        <div class="orbit-panel">
          <div class="orbit-stage" id="orbitStage" role="img" aria-label="Rotating orbit of signals">
            <div class="orbit-ring" aria-hidden="true"></div>
            <div class="orbit-center" aria-hidden="true">
              <div class="orbit-core"></div>
              <span class="orbit-domain" id="orbitHost">${host}</span>
            </div>
          </div>
          <div class="orbit-card" id="orbitCard" role="dialog" aria-modal="false" aria-live="polite"></div>
        </div>
      </div>
    </section>
  `;

  const stage = document.getElementById("orbitStage");
  const card  = document.getElementById("orbitCard");
  if (!stage) return;

  // --- layout state ---
  const rect   = () => stage.getBoundingClientRect();
  const center = () => ({ x: rect().width / 2, y: rect().height / 2 });
  const RING_INSET = 0.10;               // matches .orbit-ring inset:10%
  const radius = () => (rect().width / 2) * (1 - RING_INSET); // single ring radius

  // Create node elements, evenly spaced
  const els = nodes.map((n, i) => {
    const el = document.createElement("button");
    el.className = "orbit-node";
    el.dataset.id = n.id;
    el.type = "button";
    el.innerHTML = `<span class="ico" aria-hidden="true">${n.icon}</span><span class="t">${n.label}</span>`;
    stage.appendChild(el);
    return { ...n, el, baseAngle: (i / nodes.length) * Math.PI * 2 };
  });

  // --- motion ---
  const noMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const REV_MS   = (innerWidth < 760) ? 75000 : 60000; // 75s mobile, 60s desktop
  let startTs = 0;

  function place(angleOffset) {
    const c = center();
    const r = radius();
    els.forEach((n, idx) => {
      const a = n.baseAngle + angleOffset;
      const x = c.x + r * Math.cos(a);
      const y = c.y + r * Math.sin(a);
      n.el.style.left = `${x}px`;
      n.el.style.top  = `${y}px`;
    });
  }

  function loop(ts) {
    if (!startTs) startTs = ts;
    const t = ts - startTs;
    const angle = (t / REV_MS) * (Math.PI * 2); // radians
    place(noMotion ? 0 : angle);
    if (!noMotion) requestAnimationFrame(loop);
  }

  // --- responsive & first paint ---
  const onResize = () => place(0);
  new ResizeObserver(onResize).observe(stage);
  place(0);
  if (!noMotion) requestAnimationFrame(loop);

  // --- simple info card on click ---
  function showCard(n, x, y) {
    card.innerHTML = `
      <div class="kicker">Signal • ${n.label}</div>
      <h3>${n.label}</h3>
      <div class="fine">Top activity for <strong>${host}</strong>. Clicks here will jump to step 3.</div>
    `;
    card.style.left = `${x}px`;
    card.style.top  = `${y - 20}px`;
    card.classList.add("show");
    clearTimeout((card)._hideT);
    (card)._hideT = setTimeout(() => card.classList.remove("show"), 2600);
  }

  stage.addEventListener("click", (e) => {
    const target = e.target.closest(".orbit-node");
    if (!target) return;
    const n = els.find(x => x.el === target);
    if (!n) return;
    const r = target.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    showCard(n, r.left - s.left + r.width/2, r.top - s.top);
  });

  // accessibility: keyboard focus ring & Enter triggers
  stage.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const target = document.activeElement?.closest(".orbit-node");
    if (!target) return;
    target.click();
  });
})();