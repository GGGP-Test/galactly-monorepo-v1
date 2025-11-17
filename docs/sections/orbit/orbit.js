/* Section 3: Orbit — smooth & efficient
   - Fixes post-snap "nudge" by zeroing velocity on completion.
   - Uses easeInOutCubic for a cleaner snap.
   - Freezes rotation while a node is locked (card open).
   - Starts early via local IntersectionObserver and pauses off-screen.
*/
(function(){
  const CONFIG = {
    SPEED_FULL_DPS: 6,        // degrees per second (full drift)
    SPEED_EASE: 0.06,         // velocity easing factor
    SNAP_MS: 700,             // snap duration (ms)
    DIAMETER_FRACTION: 0.70,  // orbit diameter vs stage
    ANGLE_OFFSET_DEG: -35
  };

  const mount = document.getElementById("section-orbit");
  if (!mount) return;

  // Local fade (not using global .reveal)
  mount.style.opacity = '0';
  mount.style.transition = 'opacity 260ms cubic-bezier(.22,.61,.36,1)';

  // RAF lifecycle
  let active = false;
  let rafId = null;
  function startOrbit(){
    if (active) return;
    active = true;
    mount.style.opacity = '1';
    rafId = requestAnimationFrame(tick);
  }
  function stopOrbit(){
    if (!active) return;
    active = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    mount.style.opacity = '0';
  }

  // Pull host/domain for center label
  const LS = window.localStorage;
  const host = (()=>{ try { return (JSON.parse(LS.getItem("onb.seed")||"{}")||{}).host || "" } catch{ return "" } })() || "yourcompany.com";

  // Data (we’ll replace emojis with SVGs after CSS change)
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

  // inline CSS for card (unchanged)
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

  // Geometry
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

  // Helpers
  const toRad = d => d * Math.PI/180;
  const lerp = (a,b,t)=> a + (b-a)*t;
  const normDeg = d => { let x=d%360; if(x>180) x-=360; if(x<-180) x+=360; return x; };
  const easeInOutCubic = t => (t<0.5) ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;

  // State
  let angle = 0;
  let velTarget = CONFIG.SPEED_FULL_DPS/1000; // deg/ms
  let vel = velTarget;
  let locked = null;               // model entry
  let targetAngle = null;          // snap target (deg)
  let snapStart = 0;

  // Layout
  function place(){
    model.forEach(m=>{
      const a = toRad((m.base + angle)%360);
      const x = center.x + radius * Math.cos(a);
      const y = center.y + radius * Math.sin(a);
      m.el.style.left = x + "px";
      m.el.style.top  = y + "px";
      const depth = (Math.sin(a)+1)/2;
      m.el.style.opacity = String(0.72 + 0.22*depth);
      m.el.style.zIndex  = String(40 + Math.round(depth*60));
    });

    if (!card.hidden && locked){
      const rect = locked.el.getBoundingClientRect();
      const host = stage.getBoundingClientRect();
      const nodeCenterX = rect.left - host.left + rect.width/2;
      const nodeBottomY = rect.top  - host.top  + rect.height + 10;
      card.style.left = nodeCenterX + "px";
      card.style.top  = nodeBottomY + "px";
    }
  }

  // Animation
  let prev = 0;
  function tick(now){
    if (!prev) prev = now;
    const dt = Math.min(33, now - prev); prev = now;

    if (targetAngle != null){
      const t = Math.min(1, (now - snapStart)/CONFIG.SNAP_MS);
      const k = easeInOutCubic(t);
      // interpolate from the original angle at snap start
      // to guarantee exact landing at targetAngle
      angle = lerp(angle, targetAngle, k);

      if (t >= 1){
        angle = targetAngle;   // land exactly
        targetAngle = null;
        vel = 0;               // kill any residual drift (fixes "nudge")
        velTarget = 0;
      }
    } else if (locked){
      // While a node is locked, keep it exactly at top.
      vel = 0;
      velTarget = 0;
    } else {
      angle += vel * dt;
      vel = lerp(vel, velTarget, CONFIG.SPEED_EASE);
    }

    place();
    if (active) rafId = requestAnimationFrame(tick);
  }

  // Start early & pause off-screen
  if ('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(e=>{
        if (e.isIntersecting) startOrbit();
        else stopOrbit();
      });
    },{
      root: null,
      rootMargin: '0px 0px 60% 0px', // pre-start before it fully enters
      threshold: 0.01
    });
    io.observe(mount);
  } else {
    startOrbit();
  }

  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden) stopOrbit(); else {
      const r = mount.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < vh*1.6 && r.bottom > -vh*0.6) startOrbit();
    }
  });

  // Card helpers
  function showCard(item, modelEntry){
    cardEmoji.textContent = item.emoji;
    cardTitle.textContent = item.label;
    cardBody.textContent  = item.desc;
    card.hidden = false;

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

      // Pause and snap locked node to top (-90°)
      velTarget = 0;
      const current = (locked.base + angle) % 360;
      const desired = -90;
      const delta = normDeg(desired - current);
      targetAngle = angle + delta;
      snapStart = performance.now();

      showCard(ITEMS[i], locked);
    });
  });

  // Clicking outside -> hide & resume
  document.addEventListener("click", ()=>{
    if (!locked) return;
    locked.el.classList.remove("locked");
    locked = null;
    hideCard();
    targetAngle = null;
    vel = 0;
    velTarget = CONFIG.SPEED_FULL_DPS/1000;
  });
})();