/* Section 3: Orbit
   - Pane removed; aurora is section-wide (CSS).
   - Single ring; ~8% smaller diameter.
   - Click a node → tween to top and pause rotation.
   - Click outside → resume rotation with gentle ramp-up.
*/
(function(){
  const mount = document.getElementById("section-orbit");
  if (!mount) return;

  // ---- helpers ----
  const LS = window.localStorage;
  const host =
    (() => { try{ return (JSON.parse(LS.getItem("onb.seed")||"{}")||{}).host || "" } catch{ return "" } })()
    || "yourcompany.com";

  // ---- build DOM ----
  mount.innerHTML = `
    <section class="orbit-section" aria-label="Where your buyers light up">
      <div class="orbit-inner">
        <div class="orbit-hd">
          <h2>Where your buyers light up</h2>
          <div class="sub">Simple orbit map of the strongest intent signals for <span style="color:var(--gold-300)">${host}</span></div>
        </div>
        <div class="orbit-panel">
          <div class="orbit-stage" id="orbitStage">
            <div class="orbit-ring"></div>

            <div class="orbit-center">
              <div class="orbit-core" aria-hidden="true"></div>
              <div class="orbit-domain" id="orbitHost">${host}</div>
            </div>

            <!-- nodes -->
            <button class="orbit-node" data-id="competition"><span class="ico">✖️</span> Competition</button>
            <button class="orbit-node" data-id="buyers"><span class="ico">👥</span> Buyers</button>
            <button class="orbit-node" data-id="rfp"><span class="ico">📄</span> RFPs & Docs</button>
            <button class="orbit-node" data-id="buzz"><span class="ico">📣</span> Market Buzz</button>
            <button class="orbit-node" data-id="heat"><span class="ico">🔥</span> Buyer Heat</button>
          </div>
        </div>
      </div>
    </section>
  `;

  const stage = document.getElementById("orbitStage");
  const ring  = stage.querySelector(".orbit-ring");
  const nodes = Array.from(stage.querySelectorAll(".orbit-node"));

  // Equally spaced base angles (degrees)
  const baseAngles = [10, 76, 200, 260, 320];
  const model = nodes.map((el, i) => ({ el, base: baseAngles[i] || (i * (360/nodes.length)) }));

  // Rotation state
  let angle = 0;                      // global rotation offset (deg)
  let velTarget = 0.018;              // deg per ms at full speed
  let vel = velTarget;                // current velocity
  let locked = null;                  // {el, base} when a node is locked
  let angTarget = null;               // number (deg) when tweening to top
  let tweenStart = 0, tweenDur = 650; // ms

  // geometry
  const center = { x:0, y:0 };
  let radius = 0;
  function measure(){
    const s = stage.getBoundingClientRect();
    const r = ring.getBoundingClientRect();
    center.x = s.width/2;
    center.y = s.height/2;
    radius = (r.width)/2;
  }
  measure();
  addEventListener("resize", measure, { passive:true });

  function toRad(d){ return d * Math.PI / 180; }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function normalizeDeg(d){
    let x = d % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x;
  }

  // layout
  function place(){
    model.forEach(m=>{
      const a = toRad((m.base + angle) % 360);
      const x = center.x + radius * Math.cos(a);
      const y = center.y + radius * Math.sin(a);
      m.el.style.left = x + "px";
      m.el.style.top  = y + "px";
      const depth = (Math.sin(a)+1)/2;
      m.el.style.opacity = String(0.68 + 0.26*depth);
      m.el.style.zIndex  = String(50 + Math.round(depth*50));
    });
  }

  // loop
  let prev = 0;
  function tick(now){
    if (!prev) prev = now;
    const dt = Math.min(33, now - prev); prev = now;

    if (angTarget != null){
      const t = Math.min(1, (now - tweenStart)/tweenDur);
      const ease = 1 - Math.pow(1 - t, 3);
      angle = lerp(angle, angTarget, ease);
      if (t >= 1){ angTarget = null; }
    } else {
      angle += vel * dt;
      vel = lerp(vel, velTarget, 0.06);
    }

    place();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- interactions ----
  nodes.forEach((el, i)=>{
    el.addEventListener("click", (e)=>{
      e.stopPropagation();
      nodes.forEach(n=>n.classList.remove("locked"));
      el.classList.add("locked");
      locked = model[i];

      // Pause rotation smoothly
      velTarget = 0;
      // Bring this node to the top (-90deg)
      const current = (locked.base + angle) % 360;
      const desired = -90;
      const delta = normalizeDeg(desired - current);
      angTarget = angle + delta;
      tweenStart = performance.now();
    });
  });

  // Click outside → unlock + resume slowly to full speed
  document.addEventListener("click", ()=>{
    if (!locked) return;
    locked.el.classList.remove("locked");
    locked = null;
    angTarget = null;
    vel = 0;
    velTarget = 0.018;
  });
})();