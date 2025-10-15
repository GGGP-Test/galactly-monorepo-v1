(function(){
  const LS = window.localStorage;
  const hostFromLS = (()=>{ try{ return (JSON.parse(LS.getItem("onb.seed")||"{}")||{}).host || ""; }catch{ return ""; }})();
  const data = window.ORBIT || {};
  const mount = document.getElementById("section-orbit");
  if (!mount) return;

  // ---------- inject markup ----------
  const dom = document.createElement("section");
  dom.className = "orbit-section";
  dom.innerHTML = `
    <div class="orbit-inner">
      <div class="orbit-hd">
        <h2>${data.title || "Where your buyers light up"}</h2>
        <div class="sub">
          ${(data.subtitlePrefix||"Simple orbit map for ")}
          <span id="orbitDomain" style="color:var(--gold-300)">${hostFromLS || "yourcompany.com"}</span>
        </div>
      </div>

      <div class="orbit-panel">
        <canvas id="orbitFx" aria-hidden="true" style="position:absolute;inset:0;z-index:0;"></canvas>
        <div class="orbit-stage" id="orbitStage" style="z-index:1">
          <div class="orbit-ring r1"></div>
          <div class="orbit-ring r2"></div>
          <div class="orbit-ring r3"></div>
          <div class="orbit-ring r4"></div>

          <div class="orbit-center">
            <div class="orbit-core"></div>
            <div class="orbit-domain"><span id="orbitHost">${hostFromLS || "yourcompany.com"}</span></div>
          </div>
        </div>

        <div class="orbit-card" id="orbitCard" role="dialog" aria-live="polite">
          <div class="kicker">Signal</div>
          <h3 id="ocTitle">Loading…</h3>
          <ul id="ocList"></ul>
          <div class="heroMetric" id="ocMetric"></div>
          <div class="fine">Tap another node to switch. Click empty space to dismiss.</div>
        </div>
      </div>
    </div>
  `;
  mount.replaceWith(dom);

  // ---------- nodes ----------
  const stage   = dom.querySelector("#orbitStage");
  const cardEl  = dom.querySelector("#orbitCard");
  const titleEl = dom.querySelector("#ocTitle");
  const listEl  = dom.querySelector("#ocList");
  const metEl   = dom.querySelector("#ocMetric");

  const nodes = (data.nodes||[]).map(n=>{
    const el = document.createElement("button");
    el.className = "orbit-node";
    el.dataset.id = n.id;
    el.dataset.size = n.size || "m";
    el.type = "button";
    el.innerHTML = `<span>${n.label}</span>`;
    stage.appendChild(el);
    return { ...n, el };
  });

  // ---------- background haze (match hero) ----------
  const fx = dom.querySelector("#orbitFx");
  const noMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (fx && !noMotion){
    const ctx = fx.getContext("2d");
    const DPR = Math.max(1, Math.min(2, window.devicePixelRatio||1));
    function size(){ const r=stage.getBoundingClientRect(); fx.width=Math.floor(r.width*DPR); fx.height=Math.floor(r.height*DPR); fx.style.width=r.width+"px"; fx.style.height=r.height+"px"; ctx.setTransform(DPR,0,0,DPR,0,0); }
    size(); addEventListener("resize", size);
    let t=0;
    (function draw(){
      t+=0.004;
      const w=fx.width/DPR, h=fx.height/DPR;
      ctx.clearRect(0,0,w,h);
      const g = ctx.createRadialGradient(w*0.4, h*0.25, h*0.05, w*0.5, h*0.55, h*0.85);
      g.addColorStop(0, "rgba(250,225,150,0.08)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
      const blobs = [
        { x: 0.30 + Math.sin(t*0.9)*0.05, y: 0.35 + Math.cos(t*0.8)*0.04, r: 0.65, a: 0.16 },
        { x: 0.70 + Math.cos(t*0.7)*0.06, y: 0.60 + Math.sin(t*0.6)*0.05, r: 0.70, a: 0.12 }
      ];
      for (const b of blobs){
        const rg = ctx.createRadialGradient(w*b.x, h*b.y, 0, w*b.x, h*b.y, Math.min(w,h)*b.r);
        rg.addColorStop(0, `rgba(230,195,107,${b.a})`);
        rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(w*b.x, h*b.y, Math.min(w,h)*b.r, 0, Math.PI*2); ctx.fill();
      }
      requestAnimationFrame(draw);
    })();
  }

  // ---------- orbit layout + animation ----------
  const center = { x: stage.clientWidth/2, y: stage.clientHeight/2 };
  function onResize(){ center.x = stage.clientWidth/2; center.y = stage.clientHeight/2; layout(0); }
  addEventListener("resize", onResize);

  let angle=0;
  function layout(delta){
    angle = (angle + delta) % 360;
    const TWO_PI = Math.PI*2;
    const step = TWO_PI / nodes.length;
    const Rmax = Math.min(stage.clientWidth, stage.clientHeight)/2;
    nodes.forEach((n,i)=>{
      const base = i*step;
      const a = base + (angle*Math.PI/180);
      const r = Rmax * (n.ring || 0.7);
      const x = center.x + r*Math.cos(a);
      const y = center.y + r*Math.sin(a);
      n.el.style.left = `${x}px`;
      n.el.style.top  = `${y}px`;
      const depth = (Math.sin(a)+1)/2;
      n.el.style.opacity = String(0.55 + 0.45*depth);
      n.el.style.zIndex = String(100 + Math.round(depth*50));
    });
  }

  // slow rotate
  let prev=0;
  function tick(now){
    if (!prev) prev=now;
    const dt = Math.min(33, now - prev);
    prev = now;
    layout(noMotion ? 0 : dt*0.006);
    if (!noMotion) requestAnimationFrame(tick);
  }
  layout(0); if (!noMotion) requestAnimationFrame(tick);

  // ---------- card interactions ----------
  function hideCard(){ cardEl.classList.remove("show"); }
  function showCard(n, ev){
    const c = (data.cards||{})[n.id] || { title:n.label, points:["No details available"], heroMetric:"" };
    titleEl.textContent = c.title;
    listEl.innerHTML = (c.points||[]).map(p=>`<li>${p}</li>`).join("");
    metEl.textContent = c.heroMetric || "";
    const rect = n.el.getBoundingClientRect();
    const host = stage.getBoundingClientRect();
    cardEl.style.left = (rect.left - host.left + rect.width/2) + "px";
    cardEl.style.top  = (rect.top  - host.top  - 18) + "px";
    cardEl.classList.add("show");
  }

  nodes.forEach(n=>{
    n.el.addEventListener("click",(e)=> showCard(n,e));
    n.el.addEventListener("pointerenter",()=> n.el.classList.add("is-related"));
    n.el.addEventListener("pointerleave",()=> n.el.classList.remove("is-related"));
  });
  stage.addEventListener("click",(e)=>{ if (e.target===stage) hideCard(); });
})();