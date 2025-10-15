/* Section 3: Orbit – creates DOM, keeps a perfect circle, and locks nodes to ring lines. */
/* global window, document */
(function(){
  const mount = document.getElementById("section-orbit");
  if (!mount) return;

  const LS = window.localStorage;
  const noMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DATA = window.ORBIT_DATA || { title:"Signals", nodes: [] };

  // ---------- DOM ----------
  mount.innerHTML = `
    <section class="orbit-section" aria-label="Signals">
      <div class="orbit-inner">
        <div class="orbit-hd">
          <h2>${DATA.title}</h2>
          <div class="orbit-badge">Simple orbit map of the strongest intent signals for <span id="orbitDomain"></span></div>
        </div>
        <div class="orbit-panel">
          <div class="orbit-stage" id="orbitStage">
            <div class="orbit-ring r1" data-ring="1"></div>
            <div class="orbit-ring r2" data-ring="2"></div>
            <div class="orbit-ring r3" data-ring="3"></div>
            <div class="orbit-ring r4" data-ring="4"></div>
            <div class="orbit-center">
              <div class="orbit-core" aria-hidden="true"></div>
              <div class="orbit-domain" id="orbitHost">yourcompany.com</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  // personalize domain
  (function setHost(){
    const hostOut = document.getElementById("orbitHost");
    const domainOut = document.getElementById("orbitDomain");
    let host = "yourcompany.com";
    try{
      host = JSON.parse(LS.getItem("onb.seed")||"{}")?.host || host;
    }catch{}
    if (hostOut) hostOut.textContent = host;
    if (domainOut) domainOut.textContent = host;
  })();

  const stage = document.getElementById("orbitStage");
  const rings = Array.from(stage.querySelectorAll(".orbit-ring"));
  const center = { x: 0, y: 0, R: 0 }; // set in measure()

  // create nodes per data
  const byRing = new Map(); // ring -> items
  DATA.nodes.forEach(n=>{
    const el = document.createElement("button");
    el.type = "button";
    el.className = "orbit-node";
    el.dataset.id = n.id;
    el.dataset.size = n.size || "m";
    el.setAttribute("aria-label", n.label);
    el.innerHTML = `<span class="ico">${n.icon||""}</span><span class="tx">${n.label}</span>`;
    stage.appendChild(el);
    const ringIndex = Math.min(4, Math.max(1, n.ring|0));
    if (!byRing.has(ringIndex)) byRing.set(ringIndex, []);
    byRing.get(ringIndex).push({ ...n, el });
  });

  // evenly space nodes on each ring
  const baseAngles = new Map(); // element -> angle rad
  byRing.forEach((arr)=>{
    const step = (Math.PI * 2) / arr.length;
    arr.forEach((n,i)=> baseAngles.set(n.el, i*step));
  });

  // measure actual ring radii from DOM → guarantees centerline lock
  function measure(){
    const rect = stage.getBoundingClientRect();
    center.x = rect.width / 2;
    center.y = rect.height / 2;
    center.R = Math.min(center.x, center.y);

    // map ring index -> exact radius (half the visible ring width)
    ringRadius.set(1, stage.querySelector('.r1').clientWidth / 2);
    ringRadius.set(2, stage.querySelector('.r2').clientWidth / 2);
    ringRadius.set(3, stage.querySelector('.r3').clientWidth / 2);
    ringRadius.set(4, stage.querySelector('.r4').clientWidth / 2);
  }

  const ringRadius = new Map();
  measure();
  window.addEventListener("resize", ()=>{ measure(); layout(0); });

  let rot = 0; // rotation (radians)
  function layout(delta){
    rot = (rot + delta) % (Math.PI*2);
    byRing.forEach((arr, ringIdx)=>{
      const R = ringRadius.get(ringIdx) || (center.R * 0.9);
      arr.forEach((n)=>{
        const a = (baseAngles.get(n.el) || 0) + rot;
        const x = center.x + R * Math.cos(a);
        const y = center.y + R * Math.sin(a);
        n.el.style.left = `${x}px`;
        n.el.style.top  = `${y}px`;
        const depth = (Math.sin(a)+1)/2; // 0..1 for subtle depth
        n.el.style.opacity = String(0.70 + 0.30*depth);
        n.el.style.zIndex = String(100 + Math.round(depth*100));
      });
    });
  }

  // animate only while visible
  let raf = 0, last=0, active=false;
  function tick(now){
    if (!active){ last=now; raf=0; return; }
    const dt = Math.min(33, now - last);
    last = now;
    layout(noMotion ? 0 : dt*0.0018); // slow + smooth
    raf = requestAnimationFrame(tick);
  }
  function start(){ if (!active){ active=true; raf=requestAnimationFrame(tick);} }
  function stop(){ active=false; if (raf) cancelAnimationFrame(raf); raf=0; }

  // intersection observer to pause offscreen
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=> e.isIntersecting ? start() : stop());
  }, { threshold:0.15 });
  io.observe(stage);

  // initial paint
  layout(0);

  // tiny click effect hook (replace with your modal later)
  stage.addEventListener("click",(e)=>{
    const n = e.target.closest(".orbit-node");
    if (!n) return;
    // For now, a lightweight focus effect:
    n.animate([{transform:"translate(-50%,-50%) scale(1)"},{transform:"translate(-50%,-50%) scale(1.06)"},{transform:"translate(-50%,-50%) scale(1)"}],
              {duration:260, easing:"ease-out"});
  });

})();