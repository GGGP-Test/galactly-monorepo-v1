// Step 1 – "Who buys the fastest?"
// Independent geometry, flowing rails anchored to the stack, shrink-to-fit labels.
(() => {
  const stepIndex = 1; // this scene renders when step === 1

  /* ---------- ensure global registries exist ---------- */
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_CONFIG = window.PROCESS_CONFIG || {};

  /* ---------- defaults (overridable at runtime) ---------- */
  // Ratios are relative to the "lamp" width/height for responsiveness across screens.
  const defaults = {
    // Box geometry + placement
    BOX_W_RATIO:    0.20,   // width = lampW * ratio  (closer to square)
    BOX_H_RATIO:    0.10,   // height = lampH * ratio
    GAP_RATIO:      0.060,  // vertical gap between boxes
    STACK_X_RATIO:  0.70,   // horizontal position of the stack center in the lamp (0..1)
    STACK_TOP_RATIO:0.20,   // top Y of first box in the lamp (0..1)
    NUDGE_X:        0,      // px fine-tune
    NUDGE_Y:        0,      // px fine-tune

    // Copy block (independent from boxes)
    COPY_LEFT_RATIO:0.08,   // inside the lamp (0..1 from left edge of lamp)
    COPY_TOP_RATIO: 0.18,   // inside the lamp (0..1 from top edge of lamp)
    COPY_W_MAX_PX:  320,    // max width of copy block

    // Rails
    LEFT_STOP_RATIO: 0.46,  // where the left rail starts inside lamp (0..1 from lamp left)
    RIGHT_MARGIN_PX: 10,    // padding before lamp right
    STROKE_W:        2.5,   // stroke width of outlines/rails
    FLOW_SPEED_S:    6,     // gradient translate cycle duration

    // Text inside shapes
    TEXT_PAD:       8,      // px inner padding for labels
    FONT_PT:        12,     // default size
    FONT_PT_PILL:   12,
    FONT_PT_OVAL:   12,
    FONT_PT_DIAMOND:11,
    MIN_PT:          9,     // minimum when auto-shrinking

    // Glow intensities (purely visual; same look as step 0/your palette)
    GLOW_GOLD:  "rgba(242,220,160,.35)",
    GLOW_CYAN:  "rgba(99,211,255,.30)",
    GLOW_SOFT:  "rgba(99,211,255,.18)",
  };

  // Merge defaults once; you can change values live via window.PROCESS_CONFIG.step1.*
  window.PROCESS_CONFIG.step1 = Object.assign({}, defaults, window.PROCESS_CONFIG.step1 || {});
  const C = window.PROCESS_CONFIG.step1;

  /* ---------- util: make flowing linear gradient for any segment ---------- */
  function makeFlowGradient(ns, id, x1, y1, x2, y2, speedS) {
    const g = document.createElementNS(ns, "linearGradient");
    g.id = id;
    g.setAttribute("gradientUnits", "userSpaceOnUse");
    g.setAttribute("x1", x1); g.setAttribute("y1", y1);
    g.setAttribute("x2", x2); g.setAttribute("y2", y2);
    [
      ["0%","rgba(230,195,107,.95)"],  // warm gold
      ["40%","rgba(255,255,255,.95)"], // white tip
      ["80%","rgba(99,211,255,.95)"],  // cyan
      ["100%","rgba(99,211,255,.60)"]
    ].forEach(([o,c])=>{
      const s = document.createElementNS(ns,"stop");
      s.setAttribute("offset", o);
      s.setAttribute("stop-color", c);
      g.appendChild(s);
    });
    const anim = document.createElementNS(ns, "animateTransform");
    anim.setAttribute("attributeName", "gradientTransform");
    anim.setAttribute("type", "translate");
    anim.setAttribute("from", "0 0");
    anim.setAttribute("to", `${Math.max(1, Math.abs(x2-x1))} 0`);
    anim.setAttribute("dur", `${speedS||C.FLOW_SPEED_S}s`);
    anim.setAttribute("repeatCount", "indefinite");
    g.appendChild(anim);
    return g;
  }

  /* ---------- util: HTML text inside SVG with shrink-to-fit ---------- */
  function addLabelFO(ns, svg, x, y, w, h, text, basePt, minPt, pad, weight="800"){
    const fo = document.createElementNS(ns,"foreignObject");
    fo.setAttribute("x", x + pad);
    fo.setAttribute("y", y + pad);
    fo.setAttribute("width",  Math.max(1, w - pad*2));
    fo.setAttribute("height", Math.max(1, h - pad*2));
    const div = document.createElement("div");
    div.setAttribute("xmlns","http://www.w3.org/1999/xhtml");
    div.style.cssText = `
      height:100%;width:100%;display:flex;align-items:center;justify-content:center;
      text-align:center;line-height:1.15;color:#ddeaef;font-weight:${weight};
      word-break:break-word;overflow:hidden;`;
    div.textContent = text;
    fo.appendChild(div);
    svg.appendChild(fo);

    // shrink to fit if needed
    let size = basePt;
    div.style.fontSize = size + "px";
    const min = minPt || C.MIN_PT;
    // try a few times — cheap and robust
    for (let i=0;i<40;i++){
      if ((div.scrollHeight <= fo.clientHeight) && (div.scrollWidth <= fo.clientWidth)) break;
      size -= 0.5;
      if (size <= min) { size = min; break; }
      div.style.fontSize = size + "px";
    }
  }

  /* ---------- main scene ---------- */
  window.PROCESS_SCENES[stepIndex] = function sceneStep1({ ns, canvas, bounds, mountCopy }) {
    const b = bounds;
    const lampW = b.width;
    const lampH = Math.min(560, b.sH - 40);

    // SVG stage
    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  lampW);
    svg.setAttribute("height", lampH);
    svg.setAttribute("viewBox", `0 0 ${lampW} ${lampH}`);
    canvas.appendChild(svg);

    // <defs> gradients for outlines + rails
    const defs = document.createElementNS(ns, "defs");
    svg.appendChild(defs);

    // Geometry (responsive + tweakable)
    const boxW   = Math.max(120, lampW * C.BOX_W_RATIO);
    const boxH   = Math.max(36,  lampH * C.BOX_H_RATIO);
    const gap    = Math.max(8,   lampW * C.GAP_RATIO);
    const stackX = lampW * C.STACK_X_RATIO + C.NUDGE_X;
    const topY   = lampH * C.STACK_TOP_RATIO + C.NUDGE_Y;

    // Stack items
    const items = [
      { kind:"rect",   r:14, text:"Number of Searches / TimeBlock",   font:C.FONT_PT_PILL },
      { kind:"rect",   r:14, text:"Technologies used at the location", font:C.FONT_PT_PILL },
      { kind:"pill",   r:boxH/2, text:"Number of customers based on LTV/CAC", font:C.FONT_PT_PILL },
      { kind:"oval",   text:"Tools interacted",                        font:C.FONT_PT_OVAL },
      { kind:"diamond",text:"Company Size",                            font:C.FONT_PT_DIAMOND },
      { kind:"dots" }
    ];

    // helper class for glow — matches your palette
    const glowCSS = `
      filter:
        drop-shadow(0 0 6px ${C.GLOW_GOLD})
        drop-shadow(0 0 14px ${C.GLOW_CYAN})
        drop-shadow(0 0 24px ${C.GLOW_SOFT});
    `;

    // draw shapes
    const centers = []; // for connectors
    items.forEach((it, i) => {
      if (it.kind === "dots") return; // draw later
      const x = stackX - boxW/2;
      const y = topY + i*(boxH + gap);
      const cx = stackX;
      const cy = y + boxH/2;
      centers.push({cx, cy, x, y});

      // per-shape flowing outline gradient
      const gid = `g_step1_${i}_${Math.random().toString(36).slice(2)}`;
      defs.appendChild(makeFlowGradient(ns, gid, x, y, x+boxW, y, C.FLOW_SPEED_S));

      let el;
      if (it.kind === "rect" || it.kind === "pill"){
        el = document.createElementNS(ns, "rect");
        el.setAttribute("x", x);
        el.setAttribute("y", y);
        el.setAttribute("width", boxW);
        el.setAttribute("height", boxH);
        el.setAttribute("rx", it.kind === "pill" ? Math.min(it.r, boxH/2) : it.r);
        el.setAttribute("ry", it.kind === "pill" ? Math.min(it.r, boxH/2) : it.r);
      } else if (it.kind === "oval"){
        el = document.createElementNS(ns, "ellipse");
        el.setAttribute("cx", cx);
        el.setAttribute("cy", cy);
        el.setAttribute("rx", boxW/2);
        el.setAttribute("ry", boxH/2);
      } else if (it.kind === "diamond"){
        const p = document.createElementNS(ns, "path");
        const rx = boxW/2, ry = boxH/2;
        const d = `M ${cx} ${cy-ry} L ${cx+rx} ${cy} L ${cx} ${cy+ry} L ${cx-rx} ${cy} Z`;
        p.setAttribute("d", d);
        el = p;
      }
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", `url(#${gid})`);
      el.setAttribute("stroke-width", C.STROKE_W);
      el.style.cssText = glowCSS;
      el.setAttribute("stroke-linejoin","round");
      el.setAttribute("stroke-linecap","round");
      svg.appendChild(el);

      // label that wraps and shrinks to fit
      addLabelFO(ns, svg, x, y, boxW, boxH, it.text,
                 it.font || C.FONT_PT, C.MIN_PT, C.TEXT_PAD, "800");
    });

    // dotted "more" indicator under the diamond
    const last = centers[centers.length-1];
    if (last){
      const gDots = document.createElementNS(ns, "g");
      svg.appendChild(gDots);
      for (let i=1; i<=3; i++){
        const c = document.createElementNS(ns,"circle");
        c.setAttribute("cx", last.cx);
        c.setAttribute("cy", last.cy + i*10 + 6);
        c.setAttribute("r", 2.2);
        c.setAttribute("fill","rgba(99,211,255,.85)");
        c.style.cssText = glowCSS;
        gDots.appendChild(c);
      }
    }

    // vertical connectors between boxes (subtle)
    for (let i=0; i<centers.length-1; i++){
      const a = centers[i], b2 = centers[i+1];
      const id = `g_step1_vert_${i}_${Math.random().toString(36).slice(2)}`;
      defs.appendChild(makeFlowGradient(ns, id, a.cx, a.cy, b2.cx, b2.cy, C.FLOW_SPEED_S));
      const line = document.createElementNS(ns,"line");
      line.setAttribute("x1", a.cx); line.setAttribute("y1", a.cy + boxH/2);
      line.setAttribute("x2", b2.cx); line.setAttribute("y2", b2.cy - boxH/2);
      line.setAttribute("stroke", `url(#${id})`);
      line.setAttribute("stroke-width", Math.max(1.2, C.STROKE_W*0.6));
      line.setAttribute("stroke-linecap","round");
      line.style.cssText = glowCSS;
      svg.appendChild(line);
    }

    // rails: anchored to TOP BOX centerline
    if (centers.length){
      const first = centers[0];
      // LEFT rail: starts inside lamp, ends at box left edge (never detaches)
      const xLeftStart = lampW * Math.max(0, Math.min(1, C.LEFT_STOP_RATIO));
      const xLeftEnd   = first.x - 12; // 12px before outline
      if (xLeftEnd > xLeftStart){
        const gL = `g_step1_left_${Math.random().toString(36).slice(2)}`;
        defs.appendChild(makeFlowGradient(ns, gL, xLeftStart, first.cy, xLeftEnd, first.cy, C.FLOW_SPEED_S));
        const l = document.createElementNS(ns,"line");
        l.setAttribute("x1", xLeftStart); l.setAttribute("y1", first.cy);
        l.setAttribute("x2", xLeftEnd);   l.setAttribute("y2", first.cy);
        l.setAttribute("stroke", `url(#${gL})`);
        l.setAttribute("stroke-width", C.STROKE_W);
        l.setAttribute("stroke-linecap","round");
        l.style.cssText = glowCSS;
        svg.appendChild(l);
      }

      // RIGHT rail: begins at box right edge, ends before lamp right edge
      const xRightStart = first.x + boxW + 12;
      const xRightEnd   = lampW - C.RIGHT_MARGIN_PX;
      if (xRightEnd > xRightStart){
        const gR = `g_step1_right_${Math.random().toString(36).slice(2)}`;
        defs.appendChild(makeFlowGradient(ns, gR, xRightStart, first.cy, xRightEnd, first.cy, C.FLOW_SPEED_S));
        const r = document.createElementNS(ns,"line");
        r.setAttribute("x1", xRightStart); r.setAttribute("y1", first.cy);
        r.setAttribute("x2", xRightEnd);   r.setAttribute("y2", first.cy);
        r.setAttribute("stroke", `url(#${gR})`);
        r.setAttribute("stroke-width", C.STROKE_W);
        r.setAttribute("stroke-linecap","round");
        r.style.cssText = glowCSS;
        svg.appendChild(r);
      }
    }

    // COPY block (independent placement; doesn’t affect rails or boxes)
    const copyLeft = b.left + lampW * C.COPY_LEFT_RATIO;
    const copyTop  = b.top  + lampH * C.COPY_TOP_RATIO;
    const copy = document.createElement("div");
    copy.className = "copy";
    copy.style.left = copyLeft + "px";
    copy.style.top  = copyTop + "px";
    copy.style.maxWidth = C.COPY_W_MAX_PX + "px";
    copy.innerHTML = `
      <h3>Who buys the fastest?</h3>
      <p>We rank accounts by a <strong>live intent score</strong> built for packaging suppliers: searches per time block, technology on site, customer scale by LTV/CAC, the tools they interact with, and company size. The score bubbles up buyers most likely to convert <em>now</em> so your team prioritizes quotes, samples, and demos that close quickly.</p>`;
    canvas.appendChild(copy);
    requestAnimationFrame(()=> copy.classList.add("show"));
  };

  /* ---------- simple repaint hook (resize triggers the scene to redraw) ---------- */
  if (typeof window.PROCESS_REPAINT !== "function"){
    window.PROCESS_REPAINT = () => window.dispatchEvent(new Event("resize"));
  }
})();