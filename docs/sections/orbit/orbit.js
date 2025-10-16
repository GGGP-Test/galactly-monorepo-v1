/* Orbit section — centered, single circle, even spacing, lock + card on click */
(function () {
  const CFG = (window.ORBIT_DATA || {});
  const TITLE = CFG.title || "Where your buyers light up";
  const SPEED = typeof CFG.speed === "number" ? CFG.speed : 0.18;    // rad/s
  const RADIUS_PCT = typeof CFG.radiusPct === "number" ? CFG.radiusPct : 0.34;
  const DATA = Array.isArray(CFG.nodes) ? CFG.nodes.slice() : [];

  // ---- mount target ----
  const host = document.getElementById("section-orbit");
  if (!host) return;

  // build minimal DOM (no pane)
  host.innerHTML = `
    <section class="orbit-sec" aria-label="${TITLE}">
      <div class="orbit-wrap" style="position:relative; height:520px">
        <canvas class="orbit-canvas" aria-hidden="true"></canvas>
        <div class="orbit-sun" aria-hidden="true">
          <div class="orbit-sun-core"></div>
          <div class="orbit-sun-label" id="orbitHost"></div>
        </div>
        <div class="orbit-chips" aria-live="polite"></div>
      </div>
    </section>
  `;

  // tiny CSS only for the info card (chips/sun/orbit already styled by orbit.css)
  (function injectCardCSS() {
    const id = "orbit-card-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      .orbit-card{
        position:absolute; max-width:300px; padding:12px 14px; border-radius:12px;
        background:rgba(12,18,28,.90); backdrop-filter:blur(8px);
        border:1px solid rgba(255,255,255,.10); color:#e9f1f7; z-index:4;
        box-shadow:0 12px 30px rgba(0,0,0,.35); transform:translate(-50%, 10px);
        font:13px/1.45 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }
      .orbit-card h4{margin:0 0 6px; font-weight:700; font-size:13px}
      .orbit-card .desc{color:#9db2c5; font-size:12px}
      .orbit-chip{position:absolute; z-index:3; transform:translate(-50%,-50%)} /* safety */
      .orbit-sun{position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:2}
      .orbit-sun-core{
        width:84px; height:84px; border-radius:50%;
        background: radial-gradient(ellipse at 40% 40%, #ffd978 0%, #f0b93e 48%, #c08f1d 100%);
        box-shadow: 0 0 48px rgba(240,185,62,.45), 0 0 140px rgba(240,185,62,.25);
        animation: orbitSunGlow 2.4s ease-in-out infinite;
      }
      .orbit-sun-label{
        margin-top:10px; text-align:center; font-size:12px; color:#cfe0ee;
        background:rgba(12,18,28,.6); border:1px solid rgba(255,255,255,.08); padding:6px 10px; border-radius:999px;
      }
      @keyframes orbitSunGlow{
        0%{ filter:brightness(1.0)}
        50%{ filter:brightness(1.18)}
        100%{ filter:brightness(1.0)}
      }
    `;
    document.head.appendChild(s);
  })();

  // set domain label from LS or placeholder
  try {
    const seed = JSON.parse(localStorage.getItem("onb.seed") || "{}");
    document.getElementById("orbitHost").textContent = seed?.host || "yourcompany.com";
  } catch {
    const el = document.getElementById("orbitHost");
    if (el) el.textContent = "yourcompany.com";
  }

  const wrap = host.querySelector(".orbit-wrap");
  const chipsLayer = host.querySelector(".orbit-chips");
  const canvas = host.querySelector(".orbit-canvas");
  const ctx = canvas.getContext("2d");
  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  // build chips
  const chips = DATA.map((n, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "orbit-chip chip";
    b.setAttribute("data-id", n.id);
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = `
      <span class="chip-emoji" aria-hidden="true" style="margin-right:8px">${n.emoji || ""}</span>
      <span class="chip-label">${n.label}</span>
    `;
    chipsLayer.appendChild(b);
    return { el: b, meta: n, baseAngle: 0, currentAngle: 0 };
  });

  let W = 0, H = 0, CX = 0, CY = 0, R = 0;
  let last = performance.now();
  let spin = true;
  let offset = 0;             // global rotation offset (radians)
  let locked = null;          // {el, meta, baseAngle, currentAngle}
  let animLock = null;        // lock animation state
  const TOP_ANGLE = -Math.PI / 2;

  function layout() {
    const rect = wrap.getBoundingClientRect();
    W = Math.floor(rect.width);
    H = Math.floor(rect.height);
    CX = W / 2;
    CY = H / 2;

    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    R = Math.floor(Math.min(W, H) * RADIUS_PCT);

    // even spacing
    const step = (Math.PI * 2) / Math.max(1, chips.length);
    chips.forEach((c, i) => {
      c.baseAngle = i * step;          // fixed even angles
      c.currentAngle = c.baseAngle;    // reset
    });
  }

  function drawOrbit() {
    ctx.clearRect(0, 0, W, H);

    // faint aurora wash, consistent with Section 1 vibe
    const g = ctx.createRadialGradient(CX, CY, R * 0.15, CX, CY, R * 1.8);
    g.addColorStop(0, "rgba(230,195,107,0.06)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // single orbit ring
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.stroke();
  }

  function positionChips() {
    chips.forEach((c) => {
      // angle when spinning vs locked
      const a = (locked && c === locked)
        ? c.currentAngle
        : c.baseAngle + offset;

      const x = CX + Math.cos(a) * R;
      const y = CY + Math.sin(a) * R;

      c.el.style.left = x + "px";
      c.el.style.top = y + "px";
    });
  }

  function tick(now) {
    const dt = (now - last) / 1000; // seconds
    last = now;

    if (spin) {
      offset = (offset + SPEED * dt) % (Math.PI * 2);
    }

    // animate lock-to-top if active
    if (animLock) {
      const { start, from, to, dur } = animLock;
      const p = Math.min(1, (now - start) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      locked.currentAngle = from + (to - from) * ease;
      if (p >= 1) animLock = null;
    }

    drawOrbit();
    positionChips();
    requestAnimationFrame(tick);
  }

  function showCard(forChip) {
    hideCard();
    const card = document.createElement("div");
    card.className = "orbit-card";
    card.setAttribute("role", "dialog");
    card.innerHTML = `
      <h4>${forChip.meta.emoji || ""} ${forChip.meta.label}</h4>
      <div class="desc">${forChip.meta.desc || ""}</div>
    `;
    wrap.appendChild(card);

    // place directly under the chip
    const chipRect = forChip.el.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const cx = chipRect.left + chipRect.width / 2 - wrapRect.left;
    const cy = chipRect.top + chipRect.height - wrapRect.top;

    card.style.left = cx + "px";
    card.style.top = (cy + 12) + "px";
    card.dataset.orbitCard = "1";
  }

  function hideCard() {
    const old = wrap.querySelector(".orbit-card");
    if (old) old.remove();
  }

  function lockChip(c) {
    if (locked === c) return;
    spin = false;

    // freeze everyone at their current angle
    chips.forEach(ch => ch.currentAngle = ch.baseAngle + offset);

    locked = c;
    locked.el.setAttribute("aria-pressed", "true");

    // animate to the top
    const FROM = locked.currentAngle;
    const TO = TOP_ANGLE;
    animLock = { start: performance.now(), from: FROM, to: TO, dur: 650 };

    showCard(locked);
  }

  function unlock() {
    if (!locked) return;
    locked.el.setAttribute("aria-pressed", "false");
    locked = null;
    animLock = null;
    hideCard();

    // resume spin gently (ramp up)
    let t0 = null;
    const startSpeed = 0.02; // gentle start
    const targetSpeed = SPEED;
    function ramp(ts) {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / 600);
      const cur = startSpeed + (targetSpeed - startSpeed) * p;
      offset = (offset + cur * (1/60)) % (Math.PI * 2);
      if (p < 1 && !locked) {
        requestAnimationFrame(ramp);
      } else {
        spin = true;
      }
    }
    requestAnimationFrame(ramp);
  }

  // chip handlers
  chips.forEach((c) => {
    c.el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (locked && locked === c) {
        unlock();
      } else {
        lockChip(c);
      }
    });
  });

  // click outside to unlock
  wrap.addEventListener("click", () => unlock());

  // initial layout + run
  layout();
  positionChips();
  drawOrbit();
  requestAnimationFrame(tick);
  window.addEventListener("resize", layout);
})();
