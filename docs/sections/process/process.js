// sections/process/process.js
(() => {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  /* ----------------- GLOBALS (desktop unchanged) ----------------- */
  window.PROCESS_SCENES  = window.PROCESS_SCENES  || {};
  window.PROCESS_CONFIG  = Object.assign(
    {
      // Step 0B (pill) only – unchanged
      step0: { NUDGE_X: 150, NUDGE_Y: 50, COPY_GAP: 44, LABEL: "YourCompany.com" },

      // Per-step buckets (steps 1..5 live in their own files)
      step1: {}, step2: {}, step3: {}, step4: {}, step5: {},

      // >>> Phones/tablets: all mobile-only tuning lives here (desktop is untouched)
      mobile: {
        BP: 1024,                 // <= px uses mobile path (set 640 if you want phones only)
        MODE: "dom",              // "dom" = render mobile here; "scenes" = call per-step files
        SHOW_STEPS: { 1: true, 2: false, 3: false, 4: false, 5: false },
        GAP_AFTER_PILL: 28,       // space after Step 0 pill before Step 1 begins

        // ===== Step 1: Mobile-only knobs (tweak away) =====
        step1: {
          // Layout wrapper
          maxW: 520,              // max content width inside phones
          sidePad: 16,            // left/right padding
          top: 40,                // top margin of Step 1 block
          bottom: 72,             // bottom margin
          nudgeX: 0,              // translate whole Step 1 block (px)
          nudgeY: 0,

          // Title block
          titleShow: true,
          titlePt: 16,            // pt
          titleWeight: 700,
          titleLetter: 0.2,       // px
          titleAlign: "center",
          titleMarginTop: 6,
          titleMarginBottom: 10,

          // Copy block
          copyHpt: 22,            // h3 size (px)
          copyBodyPt: 14,         // paragraph size (px)
          copyLine: 1.55,
          copyColor: "#a7bacb",
          copyHColor: "#eaf0f6",
          copyGapBottom: 14,      // space below copy block

          // Stack / boxes (defaults used unless overridden per item)
          stackGap: 14,           // gap between boxes
          box: {
            widthPct: 100,        // % width of each box (e.g., 92 to create side gutters)
            minH: 56,             // px
            padX: 12, padY: 10,   // px
            border: 2,            // px
            radius: 14,           // px
            fontPt: 11,           // pt
            fontWeight: 525,
            letter: 0.3,          // px
            lineEm: 1.15,
            align: "center"
          },

          // Diamond settings
          diamond: {
            widthPct: 45,         // % of maxW for the diamond wrapper
            border: 2,            // px
            labelPt: 10,          // pt
            pad: 10               // px inside rotated label span
          },

          // Dots under the last shape
          dots: {
            show: true,
            count: 3,
            size: 6,              // px
            gap: 14,              // px between dots
            padTop: 6             // px spacing above dots row
          },

          // Per-item overrides + nudges (override any "box" fields; add nudgeX / nudgeY)
          overrides: {
            rect1:  { nudgeX: 0, nudgeY: 0 },
            rect2:  { nudgeX: 0, nudgeY: 0 },
            round3: { nudgeX: 0, nudgeY: 0 },
            oval4:  { nudgeX: 0, nudgeY: 0, radius: 9999 }, // keep oval unless you change it
            diamond5:{ nudgeX: 0, nudgeY: 0 }               // diamond sizing comes from diamond{}
          },

          // Order is the visual flow — keep as-is unless you want to rearrange
          order: ["rect1","rect2","round3","oval4","diamond5"]
        }
      }
    },
    window.PROCESS_CONFIG || {}
  );

  /* ----------------- STYLES (desktop identical) ----------------- */
  const style = document.createElement("style");
  style.textContent = `
  :root{ --ink:#0b1117; --copyMax:300px; --accent:#63D3FF; --accent2:#F2DCA0; }
  #section-process{ position:relative; isolation:isolate; }
  #section-process .proc{ position:relative; min-height:560px; padding:44px 12px 40px; overflow:visible; }

  .railWrap{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) scale(.88);
    z-index:5; transition:left .45s cubic-bezier(.22,.61,.36,1), transform .45s cubic-bezier(.22,.61,.36,1); }
  .railWrap.is-docked{ left:clamp(12px,5vw,70px); transform:translate(0,-50%) scale(.86); }
  .rail{ position:relative; display:flex; flex-direction:column; align-items:center; gap:16px; }
  .rail svg{ position:absolute; inset:0; overflow:visible; pointer-events:none; }

  .p-step{ width:50px;height:50px;border-radius:50%;
    display:flex;align-items:center;justify-content:center; user-select:none; cursor:pointer;
    font:700 17px/1 Inter, system-ui; color:#eaf0f6;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
    backdrop-filter:blur(6px); box-shadow:0 6px 16px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.05);
    transition:transform .14s ease, background .15s ease, box-shadow .18s ease; }
  .p-step:hover{ transform:translateY(-1px) }
  .p-step.is-current{
    color:#07212a;
    background:radial-gradient(circle at 50% 45%, rgba(255,255,255,.34), rgba(255,255,255,0) 60%), linear-gradient(180deg, var(--accent), #26b9ff);
    border-color:rgba(255,255,255,.22);
    box-shadow:0 14px 34px rgba(38,185,255,.30), 0 0 0 2px rgba(255,255,255,.20) inset, 0 0 18px rgba(99,211,255,.45); }

  .ctas{ display:flex; gap:10px; margin-top:10px; }
  .btn-glass{ padding:10px 14px; border-radius:999px; border:1px solid rgba(255,255,255,.14);
    background:linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.04));
    color:#eaf0f6; font-weight:700; cursor:pointer; backdrop-filter:blur(8px);
    box-shadow:0 8px 24px rgba(0,0,0,.30), inset 0 0 0 1px rgba(255,255,255,.06);
    transition:transform .08s ease, filter .15s ease; }
  .btn-glass:hover{ filter:brightness(1.06) } .btn-glass:active{ transform:translateY(1px) }
  .btn-glass[disabled]{ opacity:.45; cursor:not-allowed }

  .lamp{ position:absolute; top:50%; transform:translateY(-50%); left:0; width:0;
    height:min(72vh,560px); border-radius:16px; opacity:0; pointer-events:none; z-index:1;
    background:
      radial-gradient(120% 92% at 0% 50%, rgba(99,211,255,.20) 0, rgba(99,211,255,.08) 34%, rgba(99,211,255,0) 70%),
      radial-gradient(80% 60% at 0% 50%, rgba(242,220,160,.08) 0, rgba(242,220,160,0) 56%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 6px);
    filter:saturate(110%) blur(.35px);
    transition:opacity .45s ease, left .45s cubic-bezier(.22,.61,.36,1), width .45s cubic-bezier(.22,.61,.36,1); }
  .lamp::before{ content:""; position:absolute; inset:0 auto 0 -1px; width:2px; border-radius:2px;
    background:linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.03));
    box-shadow:0 0 10px rgba(99,211,255,.28), 0 0 22px rgba(240,210,120,.12); }

  .canvas{ position:absolute; inset:0; z-index:2; pointer-events:none; }
  .copy{ position:absolute; max-width:var(--copyMax); pointer-events:auto;
    opacity:0; transform:translateY(6px); transition:opacity .35s ease, transform .35s ease; }
  .copy.show{ opacity:1; transform:translateY(0) }
  .copy h3{ margin:0 0 .45rem; color:#eaf0f6; font:600 clamp(20px,2.4vw,26px) "Newsreader", Georgia, serif; }
  .copy p{ margin:.35rem 0 0; font:400 15px/1.6 Inter, system-ui; color:#a7bacb }
  .glow{ filter: drop-shadow(0 0 6px rgba(242,220,160,.35)) drop-shadow(0 0 14px rgba(99,211,255,.30)) drop-shadow(0 0 24px rgba(99,211,255,.18)); }
  @media (max-width:900px){ :root{ --copyMax:260px } .railWrap.is-docked{ left:12px; transform:translate(0,-50%) scale(.84) } }

  /* ===== MOBILE-ONLY BASE (desktop untouched) ===== */
  @media (max-width:640px){
    html, body { overflow-x:hidden; }
    #section-process { overflow-x:hidden; }
    .proc{ min-height:auto; padding:22px 14px 28px; }
    .railWrap, .ctas, .lamp{ display:none !important; }
    .canvas{ position:relative; inset:auto; }
    :root{ --copyMax:92vw }
    .glow{ filter: drop-shadow(0 0 4px rgba(242,220,160,.28)) drop-shadow(0 0 10px rgba(99,211,255,.24)); }
  }

  /* ===== MOBILE DOM MODE container classes (values are inlined per config) ===== */
  @media (max-width: ${ (window.PROCESS_CONFIG?.mobile?.BP || 1024) }px){
    #section-process .mstep{ position:relative; margin:0 auto; z-index:0; }
    #section-process .mstep-title{ color:#ddeaef; }
    #section-process .mstep-copy{ color:#a7bacb; }
    #section-process .mstack{ display:flex; flex-direction:column; align-items:center; }
    #section-process .mbox{ color:#ddeaef; background:rgba(255,255,255,.02); border-style:solid; display:flex; align-items:center; justify-content:center; text-align:center; }
    #section-process .mbox.oval{ border-radius:9999px }
    #section-process .mdiamond{ aspect-ratio:1/1; transform:rotate(45deg); background:rgba(255,255,255,.02); display:flex; align-items:center; justify-content:center; }
    #section-process .mdiamond > span{ transform:rotate(-45deg); display:flex; align-items:center; justify-content:center; text-align:center; color:#ddeaef; }
    #section-process .mdots{ display:flex; justify-content:center; }
    #section-process .mdots i{ border-radius:50%; background:rgba(99,211,255,.95); display:inline-block; }
  }
  `;
  document.head.appendChild(style);

  /* ----------------- MARKUP (unchanged) ----------------- */
  const steps = [0,1,2,3,4,5];
  mount.innerHTML = `
    <section class="proc" aria-label="Process">
      <div class="lamp" id="lamp"></div>
      <div class="canvas" id="canvas"></div>
      <div class="railWrap" id="railWrap">
        <div class="rail" id="rail">
          <svg id="railSvg" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>
          ${steps.map(i=>`<button class="p-step" data-i="${i}">${i}</button>`).join("")}
          <div class="ctas">
            <button class="btn-glass" id="prevBtn" type="button">Prev step</button>
            <button class="btn-glass" id="nextBtn" type="button">Next step</button>
          </div>
        </div>
      </div>
    </section>
  `;

  /* ----------------- ELEMENTS ----------------- */
  const stage   = mount.querySelector(".proc");
  const railWrap= mount.querySelector("#railWrap");
  const rail    = mount.querySelector("#rail");
  const railSvg = mount.querySelector("#railSvg");
  const lamp    = mount.querySelector("#lamp");
  const canvas  = mount.querySelector("#canvas");
  const dots    = Array.from(mount.querySelectorAll(".p-step"));
  const prevBtn = mount.querySelector("#prevBtn");
  const nextBtn = mount.querySelector("#nextBtn");

  /* ----------------- STATE ----------------- */
  let step = 0;   // 0..5
  let phase = 0;  // 0 = empty (only for step 0), 1 = content

  /* ----------------- HELPERS ----------------- */
  const ns = "http://www.w3.org/2000/svg";
  const MCFG = () => (window.PROCESS_CONFIG?.mobile || {});
  const isMobile = () => {
    const BP = MCFG().BP ?? 640;
    return (window.PROCESS_FORCE_MOBILE === true) ||
           (window.matchMedia && window.matchMedia(`(max-width:${BP}px)`).matches);
  };

  function deepClone(o){ return JSON.parse(JSON.stringify(o||{})); }

  function makeFlowGradients({ pillX, pillY, pillW, yMid, xTrailEnd }) {
    const defs = document.createElementNS(ns,"defs");

    const gFlow = document.createElementNS(ns,"linearGradient");
    gFlow.id = "gradFlow";
    gFlow.setAttribute("gradientUnits","userSpaceOnUse");
    gFlow.setAttribute("x1", pillX); gFlow.setAttribute("y1", pillY);
    gFlow.setAttribute("x2", pillX + pillW); gFlow.setAttribute("y2", pillY);
    [["0%","rgba(230,195,107,.95)"],["35%","rgba(255,255,255,.95)"],["75%","rgba(99,211,255,.95)"],["100%","rgba(99,211,255,.60)"]]
      .forEach(([o,c])=>{ const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gFlow.appendChild(s); });
    const a1 = document.createElementNS(ns,"animateTransform");
    a1.setAttribute("attributeName","gradientTransform"); a1.setAttribute("type","translate");
    a1.setAttribute("from","0 0"); a1.setAttribute("to", `${pillW} 0`);
    a1.setAttribute("dur","6s"); a1.setAttribute("repeatCount","indefinite");
    gFlow.appendChild(a1); defs.appendChild(gFlow);

    const gTrail = document.createElementNS(ns,"linearGradient");
    gTrail.id = "gradTrailFlow";
    gTrail.setAttribute("gradientUnits","userSpaceOnUse");
    gTrail.setAttribute("x1", pillX + pillW); gTrail.setAttribute("y1", yMid);
    gTrail.setAttribute("x2", xTrailEnd); gTrail.setAttribute("y2", yMid);
    [["0%","rgba(230,195,107,.92)"],["45%","rgba(99,211,255,.90)"],["100%","rgba(99,211,255,.18)"]]
      .forEach(([o,c])=>{ const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gTrail.appendChild(s); });
    const a2 = document.createElementNS(ns,"animateTransform");
    a2.setAttribute("attributeName","gradientTransform"); a2.setAttribute("type","translate");
    a2.setAttribute("from","0 0"); a2.setAttribute("to", `${(xTrailEnd - (pillX + pillW))} 0`);
    a2.setAttribute("dur","6s"); a2.setAttribute("repeatCount","indefinite");
    gTrail.appendChild(a2); defs.appendChild(gTrail);

    return defs;
  }
  window.PROCESS_UTILS = Object.assign({}, window.PROCESS_UTILS, { makeFlowGradients });

  function mountCopy({ top, left, html }) {
    const el = document.createElement("div");
    el.className = "copy";
    el.style.top  = `${top}px`;
    el.style.left = `${left}px`;
    el.innerHTML  = html;
    canvas.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    return el;
  }

  // Desktop bounds (original behavior)
  function boundsDesktop(){
    const s = stage.getBoundingClientRect();
    const w = railWrap.getBoundingClientRect();
    const gap = 56;
    const left = Math.max(0, w.right + gap - s.left);
    const width = Math.max(380, s.right - s.left - left - 16);
    return { sLeft:s.left, sTop:s.top, sW:s.width, sH:s.height, left, width, top:18, railRight:w.right - s.left };
  }

  // Mobile bounds (full width, no rail/lamp). `top` lets us stack slices.
  function boundsMobile(top=0, sH=640){
    const s = stage.getBoundingClientRect();
    const left = 14;
    const width = Math.max(300, s.width - left - 14);
    return { sLeft:s.left, sTop:s.top, sW:s.width, sH, left, width, top, railRight:left };
  }

  function bounds(){ return isMobile() ? boundsMobile(18, 640) : boundsDesktop(); }

  function placeLamp(){
    if (isMobile()) { lamp.style.opacity = "0"; lamp.style.width = "0px"; return; }
    const b = boundsDesktop();
    if (step>0 || (step===0 && phase===1)){
      lamp.style.left = b.left + "px"; lamp.style.width = b.width + "px"; lamp.style.opacity = ".32";
    } else { lamp.style.opacity = "0"; lamp.style.width="0px"; }
  }

  function clearCanvas(){ while (canvas.firstChild) canvas.removeChild(canvas.firstChild); }

  /* ----------------- STEP 0 (pill) ----------------- */
  function scenePill(bOverride){
    const C = window.PROCESS_CONFIG.step0;
    const b = bOverride || (isMobile() ? boundsMobile(18, 600) : boundsDesktop());

    const nodeW = b.width, nodeH = Math.min(560, b.sH-40);
    const svg = document.createElementNS(ns,"svg");
    svg.style.position="absolute"; svg.style.left=b.left+"px"; svg.style.top=b.top+"px";
    svg.setAttribute("width",nodeW); svg.setAttribute("height",nodeH);
    svg.setAttribute("viewBox",`0 0 ${nodeW} ${nodeH}`);
    canvas.appendChild(svg);

    const pillW = Math.min(440, nodeW*0.48), pillH = 80;
    const lampCenter = nodeW/2, leftBias = Math.min(80, nodeW*0.08);
    const pillX = Math.max(18, lampCenter - leftBias - pillW/2 + C.NUDGE_X);
    const pillY = Math.max(12, nodeH*0.20 + C.NUDGE_Y);
    const r=16, yMid=pillY+pillH/2;
    const xTrailEnd = nodeW - 10;

    svg.appendChild(makeFlowGradients({ pillX, pillY, pillW, yMid, xTrailEnd }));

    const d = `M ${pillX+r} ${pillY} H ${pillX+pillW-r} Q ${pillX+pillW} ${pillY} ${pillX+pillW} ${pillY+r}
               V ${pillY+pillH-r} Q ${pillX+pillW} ${pillY+pillH} ${pillX+pillW-r} ${pillY+pillH}
               H ${pillX+r} Q ${pillX} ${pillY+pillH} ${pillX} ${pillY+pillH-r}
               V ${pillY+r} Q ${pillX} ${pillY} ${pillX+r} ${pillY} Z`;
    const outline = document.createElementNS(ns,"path");
    outline.setAttribute("d", d); outline.setAttribute("fill","none");
    outline.setAttribute("stroke","url(#gradFlow)"); outline.setAttribute("stroke-width","2.5");
    outline.setAttribute("stroke-linejoin","round"); outline.setAttribute("class","glow");
    svg.appendChild(outline);

    const len = outline.getTotalLength();
    outline.style.strokeDasharray=String(len); outline.style.strokeDashoffset=String(len);
    outline.getBoundingClientRect();
    outline.style.transition="stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
    requestAnimationFrame(()=> outline.style.strokeDashoffset="0");

    const label = document.createElementNS(ns,"text");
    label.setAttribute("x", pillX+18); label.setAttribute("y", pillY+pillH/2+6);
    label.setAttribute("fill","#ddeaef"); label.setAttribute("font-weight","800");
    label.setAttribute("font-size","18");
    label.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
    label.textContent = C.LABEL; svg.appendChild(label);

    const trail = document.createElementNS(ns,"line");
    trail.setAttribute("x1", pillX+pillW); trail.setAttribute("y1", yMid);
    trail.setAttribute("x2", xTrailEnd);   trail.setAttribute("y2", yMid);
    trail.setAttribute("stroke","url(#gradTrailFlow)"); trail.setAttribute("stroke-width","2.5");
    trail.setAttribute("stroke-linecap","round"); trail.setAttribute("class","glow");
    svg.appendChild(trail);

    // copy block (mobile: copy-first naturally because top < boxes)
    const basePillY = Math.max(12, nodeH*0.20);
    const minInside = b.left+12;
    const fromRail  = Math.max(minInside, b.left + 24);
    const copyTop   = (b.top + basePillY - 2);
    const copy = mountCopy({
      top: copyTop, left: fromRail,
      html: `<h3>We start with your company.</h3>
             <p>We read your company and data to learn what matters. Then our system builds simple metrics around your strengths.
             With that map in hand, we move forward to find real buyers who match your persona.</p>`
    });

    requestAnimationFrame(() => {
      const boxLeftAbs = b.left + pillX;
      const copyBox = copy.getBoundingClientRect();
      let idealLeft = Math.min(copyBox.left, boxLeftAbs - window.PROCESS_CONFIG.step0.COPY_GAP - copyBox.width);
      idealLeft = Math.max(idealLeft, minInside);
      copy.style.left = idealLeft + "px";
    });

    return nodeH; // report slice height (for mobile stacking)
  }

  /* ----------------- RAIL (desktop only) ----------------- */
  function drawRail(){
    if (isMobile()) { while (railSvg.firstChild) railSvg.removeChild(railSvg.firstChild); return; }
    const r = rail.getBoundingClientRect();
    railSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    while (railSvg.firstChild) railSvg.removeChild(railSvg.firstChild);
    const pts = dots.map(el=>{
      const b = el.getBoundingClientRect();
      return { x:(b.left+b.right)/2 - r.left, y:(b.top+b.bottom)/2 - r.top };
    });
    for (let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const line = document.createElementNS(ns,"line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      line.setAttribute("stroke", i<step ? "rgba(99,211,255,.70)" : "rgba(255,255,255,.12)");
      line.setAttribute("stroke-width", 2); line.setAttribute("stroke-linecap","round");
      railSvg.appendChild(line);
    }
  }

  function renderDots(){
    if (isMobile()) return;
    dots.forEach((el,i)=>{
      el.classList.toggle("is-current", i===step);
      el.classList.toggle("is-done",    i<step);
      el.textContent = (i<step) ? "✓" : String(i);
    });
  }

  /* ----------------- MOBILE: Step 1 DOM (all values are inlined from config) ----------------- */
  function mStepContainer({ top=40, bottom=72, maxW=520, sidePad=16, nudgeX=0, nudgeY=0 }){
    const el = document.createElement("div");
    el.className = "mstep";
    el.style.marginTop = `${top}px`;
    el.style.marginBottom = `${bottom}px`;
    el.style.maxWidth = `${maxW}px`;
    el.style.padding = `0 ${sidePad}px`;
    el.style.transform = `translate(${nudgeX}px, ${nudgeY}px)`;
    return el;
  }

  function applyBoxStyles(node, base, ov){
    const b = Object.assign({}, base, ov||{});
    node.style.width = `${b.widthPct ?? 100}%`;
    node.style.minHeight = `${b.minH ?? 56}px`;
    node.style.padding = `${b.padY ?? 10}px ${b.padX ?? 12}px`;
    node.style.borderWidth = `${b.border ?? 2}px`;
    node.style.borderColor = "rgba(99,211,255,.95)";
    node.style.borderRadius = `${b.radius ?? 14}px`;
    node.style.font = `${b.fontWeight ?? 525} ${b.fontPt ?? 11}pt Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
    node.style.letterSpacing = `${b.letter ?? 0.3}px`;
    node.style.lineHeight = `${b.lineEm ?? 1.15}em`;
    node.style.textAlign = b.align || "center";
    if (ov && (ov.nudgeX || ov.nudgeY)){
      node.style.transform = `translate(${ov.nudgeX|0}px, ${(ov.nudgeY|0)}px)`;
    }
  }

  function renderStep1_DOM(){
    const cfg = window.PROCESS_CONFIG.step1 || {};
    const M = (window.PROCESS_CONFIG.mobile?.step1) || {};

    const wrap = mStepContainer({
      top: M.top ?? 40,
      bottom: M.bottom ?? 72,
      maxW: M.maxW ?? 520,
      sidePad: M.sidePad ?? 16,
      nudgeX: M.nudgeX ?? 0,
      nudgeY: M.nudgeY ?? 0
    });

    // Title
    if (M.titleShow !== false){
      const t = document.createElement("div");
      t.className = "mstep-title";
      t.textContent = (cfg.TITLE_TEXT || "Time-to-Buy Intent");
      t.style.textAlign = (M.titleAlign || "center");
      t.style.fontWeight = String(M.titleWeight ?? 700);
      t.style.fontSize = `${M.titlePt ?? 16}pt`;
      t.style.letterSpacing = `${M.titleLetter ?? 0.2}px`;
      t.style.marginTop = `${M.titleMarginTop ?? 6}px`;
      t.style.marginBottom = `${M.titleMarginBottom ?? 10}px`;
      wrap.appendChild(t);
    }

    // Copy
    const copy = document.createElement("div");
    copy.className = "mstep-copy";
    copy.style.marginBottom = `${M.copyGapBottom ?? 14}px`;
    copy.innerHTML = `
      <h3 style="
        margin:0 0 8px;
        color:${M.copyHColor ?? "#eaf0f6"};
        font:600 ${(M.copyHpt ?? 22)}px 'Newsreader', Georgia, serif;">
        Who’s ready now?
      </h3>
      <p style="
        margin:0;
        color:${M.copyColor ?? "#a7bacb"};
        font:${400} ${(M.copyBodyPt ?? 14)}px/${(M.copyLine ?? 1.55)} Inter, system-ui;">
        Our <b>Time-to-Buy Intent</b> finds accounts most likely to purchase in the next cycle.
        We weight <b>recent</b> signals like search bursts, RFQ/RFP language, visits to pricing & sample pages,
        and events/trade shows, new product launches, and 38+ more metrics, then surface the prospects your team should contact today.
      </p>`;
    wrap.appendChild(copy);

    // Stack
    const stack = document.createElement("div");
    stack.className = "mstack";
    stack.style.gap = `${M.stackGap ?? 14}px`;

    const labels = {
      rect1:    cfg.LABEL_RECT_1    ?? "Back-To-Back Search (last 14d)",
      rect2:    cfg.LABEL_RECT_2    ?? "RFQ/RFP Keywords Detected",
      round3:   cfg.LABEL_ROUND_3   ?? "Pricing & Sample Page Hits",
      oval4:    cfg.LABEL_OVAL_4    ?? "Rising # of Ad Creatives (last 14d)",
      diamond5: cfg.LABEL_DIAMOND_5 ?? "Import/Export End of Cycle"
    };

    const order = Array.isArray(M.order) ? M.order : ["rect1","rect2","round3","oval4","diamond5"];
    const baseBox = M.box || {};
    const OVR = M.overrides || {};

    for (const key of order){
      const ov = OVR[key] || {};
      if (key === "diamond5"){
        const dWrap = document.createElement("div");
        dWrap.className = "mdiamond";
        dWrap.style.width = `${(M.diamond?.widthPct ?? 45)}%`;
        dWrap.style.border = `${(M.diamond?.border ?? 2)}px solid rgba(99,211,255,.95)`;
        if (ov.nudgeX || ov.nudgeY) dWrap.style.transform = `translate(${ov.nudgeX|0}px, ${ov.nudgeY|0}px) rotate(45deg)`;
        const s = document.createElement("span");
        s.textContent = labels[key];
        s.style.width = "70%";
        s.style.height = "70%";
        s.style.font = `${(baseBox.fontWeight ?? 525)} ${(M.diamond?.labelPt ?? 10)}pt Inter, system-ui`;
        s.style.letterSpacing = `${baseBox.letter ?? 0.3}px`;
        s.style.lineHeight = `${baseBox.lineEm ?? 1.15}em`;
        s.style.padding = `${(M.diamond?.pad ?? 10)}px`;
        dWrap.appendChild(s); stack.appendChild(dWrap);
      } else {
        const box = document.createElement("div");
        box.className = "mbox" + (key==="oval4" ? " oval" : "");
        box.textContent = labels[key];
        // Merge base + override (including oval radius override)
        applyBoxStyles(box, baseBox, Object.assign({}, key==="oval4" ? { radius: 9999 } : {}, ov));
        stack.appendChild(box);
      }
    }

    // Dots
    const dots = (M.dots || {});
    if (dots.show !== false){
      const row = document.createElement("div");
      row.className = "mdots";
      row.style.gap = `${dots.gap ?? 14}px`;
      row.style.paddingTop = `${dots.padTop ?? 6}px`;
      const n = Math.max(0, dots.count ?? 3);
      for (let i=0;i<n;i++){
        const dot = document.createElement("i");
        const size = `${dots.size ?? 6}px`;
        dot.style.width = size; dot.style.height = size;
        row.appendChild(dot);
      }
      stack.appendChild(row);
    }

    wrap.appendChild(stack);
    canvas.appendChild(wrap);
  }

  /* ----------------- ROUTERS ----------------- */
  // Desktop route (original — unchanged)
  function drawDesktop(){
    clearCanvas();
    if (step===0 && phase===1){ scenePill(); return; }
    const scene = window.PROCESS_SCENES[step];
    if (typeof scene === "function") {
      try{
        const cfg = deepClone(window.PROCESS_CONFIG["step"+step]);
        scene({ ns, canvas, bounds: boundsDesktop(), config: cfg, makeFlowGradients, mountCopy });
      }catch(err){ console.error("process scene error (step "+step+"):", err); }
    }
  }

  // Spacer utility
  function push(yPx){
    if (yPx <= 0) return;
    const spacer = document.createElement("div");
    spacer.style.height = `${yPx}px`;
    spacer.style.width  = "1px";
    spacer.style.pointerEvents = "none";
    canvas.appendChild(spacer);
  }

  // Mobile route (DOM mode only affects phones/tablets; desktop untouched)
  function drawMobile(){
    clearCanvas();
    canvas.style.position = "relative";
    canvas.style.inset = "auto";
    canvas.style.pointerEvents = "auto";

    const h0 = scenePill( boundsMobile(0, 620) );
    push( (h0 || 520) + (MCFG().GAP_AFTER_PILL ?? 28) );

    const MODE = (MCFG().MODE || "dom").toLowerCase();
    if (MODE === "dom"){
      if (MCFG().SHOW_STEPS?.[1]) renderStep1_DOM();
    } else {
      const scene1 = window.PROCESS_SCENES[1];
      if (MCFG().SHOW_STEPS?.[1] && typeof scene1 === "function"){
        const cfg1 = deepClone(window.PROCESS_CONFIG.step1 || {});
        cfg1.SHOW_LEFT_LINE = false; cfg1.SHOW_RIGHT_LINE = false;
        try{ scene1({ ns, canvas, bounds: boundsMobile(0, 700), config: cfg1, makeFlowGradients, mountCopy }); }
        catch(err){ console.error("process scene 1 (mobile):", err); }
      }
    }
    canvas.style.minHeight = "auto";
  }

  function drawScene(){ isMobile() ? drawMobile() : drawDesktop(); }

  function setStep(n, opts={}){
    step = Math.max(0, Math.min(5, n|0));
    if (typeof opts.phase === "number") phase = opts.phase;
    else if (step === 0 && phase === 0 && opts.fromInit) phase = 0;
    else if (step === 0) phase = 1;
    else phase = 1;

    if (!isMobile()){
      railWrap.classList.toggle("is-docked", step>0 || (step===0 && phase===1));
      prevBtn.disabled = (step===0 && phase===0);
      nextBtn.disabled = step>=5;
    }

    drawRail(); placeLamp(); renderDots(); drawScene();
  }

  /* ----------------- EVENTS ----------------- */
  dots.forEach(d=> d.addEventListener("click", ()=>{
    if (isMobile()) return; // disabled on phones
    const i = +d.dataset.i;
    if (i===0){ setStep(0, { phase: 1 }); } else { setStep(i, { phase: 1 }); }
  }));
  prevBtn?.addEventListener("click", ()=>{
    if (isMobile()) return;
    if (step===0 && phase===1){ setStep(0, { phase: 0 }); return; }
    setStep(step-1, { phase: 1 });
  });
  nextBtn?.addEventListener("click", ()=>{
    if (isMobile()) return;
    if (step===0 && phase===0){ setStep(0, { phase: 1 }); return; }
    setStep(step+1, { phase: 1 });
  });

  addEventListener("resize", ()=>{ drawRail(); placeLamp(); drawScene(); }, {passive:true});
  railWrap.addEventListener("transitionend", e=>{
    if (e.propertyName==="left"||e.propertyName==="transform"){
      drawRail(); placeLamp(); drawScene();
    }
  });

  /* ----------------- PUBLIC UTILS ----------------- */
  window.PROCESS_REPAINT = () => { drawRail(); placeLamp(); drawScene(); };

  /* ----------------- INIT ----------------- */
  function init(){
    phase = 0;
    setStep(0, { fromInit:true });
    requestAnimationFrame(()=>{ drawRail(); placeLamp(); });
  }
  if (document.readyState === "complete") init();
  else addEventListener("load", init, {once:true});
})();