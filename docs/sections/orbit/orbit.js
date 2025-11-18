/* Section 4: Orbit — Lucide icons (MIT), smooth snap, perf gating */
(function(){
  const ICON_STYLE = { color:'#dbe8f2', stroke:1.0, sizePct:38 };

  const CONFIG = {
    SPEED_FULL_DPS: 6,
    SPEED_EASE: 0.06,
    SNAP_MS: 700,
    DIAMETER_FRACTION: 0.70,
    ANGLE_OFFSET_DEG: -35
  };

  const mount = document.getElementById("section-orbit");
  if (!mount) return;

  // Fade lifecycle
  mount.style.opacity = '0';
  mount.style.transition = 'opacity 260ms cubic-bezier(.22,.61,.36,1)';

  let active = false, rafId = null;
  function startOrbit(){ if(active) return; active=true; mount.style.opacity='1'; rafId=requestAnimationFrame(tick); }
  function stopOrbit(){  if(!active) return; active=false; if(rafId) cancelAnimationFrame(rafId); rafId=null; mount.style.opacity='0'; }

  // Lucide loader (MIT)
  let lucideReady;
  function loadScriptOnce(src){
    return new Promise((resolve, reject)=>{
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function ensureLucide(){
    if (!lucideReady){
      lucideReady = loadScriptOnce('https://unpkg.com/lucide@latest/dist/umd/lucide.min.js')
        .then(()=>{ if(!window.lucide) throw new Error('Lucide failed to load'); });
    }
    return lucideReady;
  }

  // Icons
  const ICON_NAME = {
    events:'calendar', competition:'trophy', rfp:'file-text', market:'megaphone', search:'search'
  };

  // Items + copy
  const ITEMS = [
    { id:"events",       label:"Events",       icon:ICON_NAME.events,
      desc:"Trade shows, launches and line expansions—time-bound moments that create immediate packaging needs." },
    { id:"competition",  label:"Competition",  icon:ICON_NAME.competition,
      desc:"Where rivals are shortlisted or win deals—perfect for targeted displacement plays." },
    { id:"rfp",          label:"RFPs & Docs",  icon:ICON_NAME.rfp,
      desc:"Fresh RFPs/RFQs, packaging specs and bid results from public procurement sources." },
    { id:"market",       label:"Market",       icon:ICON_NAME.market,
      desc:"News and social signals that hint at new SKUs, rebrands or channel moves." },
    { id:"search",       label:"Search",       icon:ICON_NAME.search,
      desc:"High-intent queries across Google/LinkedIn (e.g., “custom corrugated boxes”, “eco packaging supplier”)." }
  ];

  // ---------- Build DOM ----------
  // NOTE: we set --proc-title-pad-x here. Increase/decrease to move the title away from the edge.
  mount.innerHTML = `
    <section class="orbit-section" aria-label="Where your buyers light up"
             style="--proc-title-pad-x:16px; --proc-title-gap:4px; --proc-title-margin-top:120px;">
      <!-- Direct child to match Section 3 selectors -->
      <h2 class="proc-title">Where your <span class="accent-gold nowrap">buyers</span> light up</h2>

      <div class="orbit-inner">
        <div class="orbit-hd">
          <div class="sub">Signals from search, events, RFPs, market news and competitor moves.</div>
        </div>

        <div class="orbit-panel">
          <div class="orbit-stage" id="orbitStage"
               style="--icon-color:${ICON_STYLE.color};--icon-stroke:${ICON_STYLE.stroke}px;--icon-size:${ICON_STYLE.sizePct}%">
            <div class="orbit-ring" id="orbitRing"></div>
            <div class="orbit-center"><div class="orbit-core" aria-hidden="true"></div></div>

            ${ITEMS.map(i=>`<button class="orbit-node" data-id="${i.id}" aria-label="${i.label}">
                <span class="ico"><i data-lucide="${i.icon}"></i></span>
              </button>`).join("")}

            <div class="orbit-card" id="orbitCard" hidden>
              <div class="card-hd"><span class="icon" id="cardIcon"><i data-lucide="${ITEMS[0].icon}"></i></span><span id="cardTitle"></span></div>
              <div class="card-bd" id="cardBody"></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  // ---- Enforce same X padding + typography (works even if Section-3 CSS is scoped) ----
  (function injectCSS(){
    // include both the title padding rule and Lucide styling
    const id = "orbitInlineCSS";
    if (document.getElementById(id)) return;
    const css = `
      /* Give the Section-4 title the same horizontal inset system as Section 3 */
      .orbit-section > h2.proc-title{
        padding-inline: var(--proc-title-pad-x, 48px);
        margin-top: var(--proc-title-margin-top, 120px);
      }

      .orbit-card{position:absolute;transform:translate(-50%,0);min-width:220px;max-width:280px;
        padding:10px 12px;border-radius:12px;background:rgba(10,16,28,.92);backdrop-filter:blur(6px);
        border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:80}
      .orbit-card .card-hd{display:flex;gap:8px;align-items:center;font-weight:700;margin-bottom:6px}
      .orbit-card .icon{display:inline-grid;place-items:center;width:18px;height:18px}
      .orbit-card .card-bd{font-size:13px;color:#bcd0e0;line-height:1.4}
      .orbit-node.locked{filter:brightness(1.05)}

      .orbit-node .ico{ display:grid; place-items:center; width:100%; height:100%; color: var(--icon-color); }
      .orbit-node .ico svg,
      .orbit-card .icon svg{
        display:block;
        width: var(--icon-size) !important;
        height: var(--icon-size) !important;
        stroke: currentColor !important;
        fill: none;
        stroke-width: var(--icon-stroke) !important;
        stroke-linecap: round; stroke-linejoin: round;
        vector-effect: non-scaling-stroke; shape-rendering: geometricPrecision;
        opacity: .95;
      }
      .orbit-node:hover .ico svg,
      .orbit-node:focus-visible .ico svg{ opacity: 1; }
      .orbit-card .icon{ color: var(--icon-color); }
    `;
    const s = document.createElement("style");
    s.id = id; s.textContent = css; document.head.appendChild(s);
  })();

  // Copy exact typography from Section 3 title if available
  (function syncProcTitleStyles(){
    const src = document.querySelector('#section-process .proc-title');
    const dst = mount.querySelector('section.orbit-section > h2.proc-title');
    if (!src || !dst) return;
    const cs = getComputedStyle(src);
    const props = [
      'fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing',
      'textTransform','textShadow','fontFeatureSettings','fontVariationSettings',
      'textRendering','-webkitFontSmoothing','-mozOsxFontSmoothing'
    ];
    props.forEach(p=>{ dst.style[p] = cs.getPropertyValue(p) || cs[p]; });
    ['marginBottom'].forEach(p=>{ dst.style[p] = cs[p]; });
  })();

  // Render icons
  function renderIcons(scope){
    if (!window.lucide) return;
    window.lucide.createIcons({ nameAttr:'data-lucide',
      attrs:{ width:24, height:24, color:'currentColor', stroke:'currentColor', 'stroke-width': ICON_STYLE.stroke }}, scope);
  }
  ensureLucide().then(()=> renderIcons(mount));

  // Refs
  const stage = document.getElementById("orbitStage");
  const ring  = document.getElementById("orbitRing");
  const card  = document.getElementById("orbitCard");
  const cardIcon = document.getElementById("cardIcon");
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
  let velTarget = CONFIG.SPEED_FULL_DPS/1000;
  let vel = velTarget;
  let locked = null;
  let targetAngle = null;
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
      angle = lerp(angle, targetAngle, k);
      if (t >= 1){
        angle = targetAngle; targetAngle = null; vel = 0; velTarget = 0;
      }
    } else if (locked){
      vel = 0; velTarget = 0;
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
      entries.forEach(e=>{ if (e.isIntersecting) startOrbit(); else stopOrbit(); });
    },{ root:null, rootMargin:'0px 0px 60% 0px', threshold:0.01 });
    io.observe(mount);
  } else { startOrbit(); }

  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden) stopOrbit(); else {
      const r = mount.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < vh*1.6 && r.bottom > -vh*0.6) startOrbit();
    }
  });

  // Card helpers
  function showCard(item, modelEntry){
    cardIcon.innerHTML = `<i data-lucide="${item.icon}"></i>`;
    ensureLucide().then(()=> renderIcons(cardIcon));
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

      // Pause and snap to top (-90°)
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
