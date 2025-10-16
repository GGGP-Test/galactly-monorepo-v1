/* Section 3: Orbit  — minimal, self-contained
   - Nodes evenly spaced.
   - Click a node -> snaps to top (-90°), shows a card BELOW the title, pauses rotation.
   - Click outside -> hides card and resumes rotation with ramp-up.
   - Tweak speed & diameter via the CONFIG block below.
*/
(function(){
  // ---------------- CONFIG (edit these) ----------------
  const CONFIG = {
    // Rotation speed: degrees per second at full speed (default 6 dps ~ a calm drift).
    SPEED_FULL_DPS: 6,

    // How quickly we ramp toward target speed [0..1] (higher = snappier).
    SPEED_EASE: 0.06,

    // Snap-to-top tween (ms)
    SNAP_MS: 650,

    // Orbit diameter as a fraction of the available stage (0.0..1.0).
    // This sets the ring size AND the path nodes follow so they stay perfectly aligned.
    DIAMETER_FRACTION: 0.70, // <-- tweak diameter here later

    // Initial angular offset so the first item isn't exactly at the top.
    ANGLE_OFFSET_DEG: -35
  };
  // -----------------------------------------------------

  const mount = document.getElementById("section-orbit");
  if (!mount) return;

  // Pull host/domain for center label
  const LS = window.localStorage;
  const host = (()=>{ try { return (JSON.parse(LS.getItem("onb.seed")||"{}")||{}).host || "" } catch{ return "" } })() || "yourcompany.com";

  // Data for nodes + card copy (edit text here)
  const ITEMS = [
    { id:"buyers",      label:"Buyers",       emoji:"👥", desc:"Verified companies that match your ICP and are actively exploring suppliers." },
    { id:"competition", label:"Competition",  emoji:"✖️", desc:"Signals where competitors are winning, losing, or being compared." },
    { id:"rfp",         label:"RFPs & Docs",  emoji:"📄", desc:"Recent RFPs, RFQs, specs, and procurement docs pulled from public sources." },
    { id:"market",      label:"Market Buzz",  emoji:"📣", desc:"Mentions in news, forums, and launches that imply packaging needs." },
    { id:"heat",        label:"Buyer Heat",   emoji:"🔥", desc:"On-site behavior & third-party intent that spikes for your strengths." }
  ];

  // ---------- Build DOM ----------
  mount.innerHTML = `
    <section class="orbit-section" aria-label="Where your buyers light up">
      <div class="orbit-inner">
        <div class="orbit-hd">
          <h2>Where your buyers light up</h2>
          <div class="sub">Simple orbit map of the strongest intent signals for <span style="color:var(--gold-300)">${host}</span></div>
        </div>
        <div class="orbit-panel"><div class="orbit-stage" id="orbitStage">
          <div class="orbit-ring" id="orbitRing"></div>

          <div class="orbit-center">
            <div class="orbit-core" aria-hidden="true"></div>
            <div class="orbit-domain" id="orbitHost">${host}</div>
          </div>

          ${ITEMS.map(i=>`<button class="orbit-node" data-id="${i.id}" aria-label="${i.label}">
            <span class="ico">${i.emoji}</span> ${i.label}
          </button>`).join("")}

          <div class="orbit-card" id="orbitCard" hidden>
            <div class="card-hd"><span class="emoji" id="cardEmoji"></span><span id="cardTitle"></span></div>
            <div class="card-bd" id="cardBody"></div>
          </div>
        </div></div>
      </div>
    </section>
  `;

  // Inject tiny bit of CSS so the card looks right without touching your CSS file.
  (function injectCSS(){
    if (document.getElementById("orbitInlineCSS")) return;
    const css = `
      .orbit-card{position:absolute;transform:translate(-50%,0);min-width:220px;max-width:280px;
        padding:10px 12px;border-radius:12px;background:rgba(10,16,28,.92);backdrop-filter:blur(6px);
        border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:80}
      .orbit-card .card-hd{display:flex;gap:8px;align-items:center;font-weight:700;margin-bottom:6px}
      .orbit-card .emoji{font-size:16px} .orbit-card .card-bd{font-size:13px;color:#bcd0e0;line-height:1.4}
      .orbit-node.locked{filter:brightness(1.05)}
    `;
    const s = document.createElement("style");
    s.id = "orbitInlineCSS"; s.textContent = css; document.head.appendChild(s);
  })();

  const stage = document.getElementById("orbitStage");
  const ring  = document.getElementById("orbitRing");
  const card  = document.getElementById("orbitCard");
  const cardEmoji = document.getElementById("cardEmoji");
  const cardTitle = document.getElementById("cardTitle");
  const cardBody  = document.getElementById("cardBody");
  const nodes = Array.from(stage.querySelectorAll(".orbit-node"));

  // Even spacing
  const N = ITEMS.length;
  const BASE_SPACING = 360 / N;
  const model = nodes.map((el, i) => ({ el, base: CONFIG.ANGLE_OFFSET_DEG + i*BASE_SPACING, id: ITEMS[i].id }));

  // Geometry: size ring + path from DIAMETER_FRACTION so visuals & math match
  let center = { x:0, y:0 }, radius = 0;
  function measure(){
    const s = stage.getBoundingClientRect();
    const d = Math.min(s.width, s.height) * CONFIG.DIAMETER_FRACTION;
    ring.style.width = d + "px"; ring.style.height = d + "px";
    const r = ring.getBoundingClientRect();
    center = { x: s.width/2, y: s.height/2 };
    radius = r.width/2;
  }
  measure();
  addEventListener("resize", measure, { passive:true });

  // Math helpers
  const toRad = d => d * Math.PI/180;
  const lerp = (a,b,t)=> a + (b-a)*t;
  const normDeg = d => { let x=d%360; if(x>180) x-=360; if(x<-180) x+=360; return x; };

  // State
  let angle = 0;
  let velTarget = CONFIG.SPEED_FULL_DPS/1000; // deg/ms
  let vel = velTarget;
  let locked = null;               // model entry
  let targetAngle = null;          // snap target (deg)
  let snapStart = 0;

  // Layout nodes
  function place(){
    model.forEach(m=>{
      const a = toRad((m.base + angle)%360);
      const x = center.x + radius * Math.cos(a);
      const y = center.y + radius * Math.sin(a);
      m.el.style.left = x + "px";
      m.el.style.top  = y + "px";
      // parallax-ish depth
      const depth = (Math.sin(a)+1)/2;
      m.el.style.opacity = String(0.72 + 0.22*depth);
      m.el.style.zIndex  = String(40 + Math.round(depth*60));
    });

    // If card visible, keep it locked under the locked node
    if (!card.hidden && locked){
      const rect = locked.el.getBoundingClientRect();
      const host = stage.getBoundingClientRect();
      const nodeCenterX = rect.left - host.left + rect.width/2;
      const nodeBottomY = rect.top  - host.top  + rect.height + 10; // 10px gap
      card.style.left = nodeCenterX + "px";
      card.style.top  = nodeBottomY + "px";
    }
  }

  // Animation loop
  let prev = 0;
  function tick(now){
    if (!prev) prev = now;
    const dt = Math.min(33, now - prev); prev = now;

    if (targetAngle != null){
      const t = Math.min(1, (now - snapStart)/CONFIG.SNAP_MS);
      const ease = 1 - Math.pow(1 - t, 3);
      angle = lerp(angle, targetAngle, ease);
      if (t >= 1) targetAngle = null;
    } else {
      angle += vel * dt;
      vel = lerp(vel, velTarget, CONFIG.SPEED_EASE);
    }

    place();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Show card helper
  function showCard(item, modelEntry){
    cardEmoji.textContent = item.emoji;
    cardTitle.textContent = item.label;
    cardBody.textContent  = item.desc;
    card.hidden = false;

    // initial positioning (will be refined each frame in place())
    const rect = modelEntry.el.getBoundingClientRect();
    const host = stage.getBoundingClientRect();
    card.style.left = (rect.left - host.left + rect.width/2) + "px";
    card.style.top  = (rect.top - host.top + rect.height + 10) + "px";
  }
  function hideCard(){ card.hidden = true; }

  // Interactions
  nodes.forEach((el, i)=>{
    el.addEventListener("click", (e)=>{
      e.stopPropagation();
      nodes.forEach(n=>n.classList.remove("locked"));
      el.classList.add("locked");
      locked = model[i];

      // Pause rotation smoothly and snap locked node to top (-90°)
      velTarget = 0;
      const current = (locked.base + angle) % 360;
      const desired = -90;
      const delta = normDeg(desired - current);
      targetAngle = angle + delta;
      snapStart = performance.now();

      // show card under this node
      const item = ITEMS[i];
      showCard(item, locked);
    });
  });

  // Clicking outside -> hide card, unlock, resume
  document.addEventListener("click", ()=>{
    if (!locked) return;
    locked.el.classList.remove("locked");
    locked = null;
    hideCard();
    targetAngle = null;    // drop any remaining snap
    vel = 0;               // restart slow
    velTarget = CONFIG.SPEED_FULL_DPS/1000;
  });

})();