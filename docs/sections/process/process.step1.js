// docs/sections/process/steps/process.step1.js
(() => {
  const SCENE_ID = 1;

  // -------- defaults (overridable via PROCESS_CONFIG.step1) ----------
  function defaults(cfg = {}) {
    const d = {
      // layout (ratios are relative to lamp width)
      BOX_W_RATIO:     0.088,   // closer to square
      BOX_H_RATIO:     0.195,
      GAP_RATIO:       0.060,
      STACK_X_RATIO:   0.705,   // 0..1 across lamp
      STACK_TOP_RATIO: 0.215,   // 0..1 down lamp
      NUDGE_X: 0, NUDGE_Y: 0,   // px fine tune

      // text + padding (both directions)
      TEXT_PAD_X: 10, TEXT_PAD_Y: 9,
      FONT_PT: 12, FONT_PT_PILL: 12, FONT_PT_OVAL: 12, FONT_PT_DIAMOND: 11,
      FONT_WEIGHT: 800,
      TEXT_COLOR: "#ddeaef",

      // copy block (independent from the stack)
      COPY_LEFT_RATIO: 0.035,
      COPY_TOP_RATIO:  0.18,
      COPY_NUDGE_X: 0, COPY_NUDGE_Y: 0,

      // rails, stroke, glow
      LEFT_STOP_RATIO: 0.38,   // where left rail stops inside lamp
      RIGHT_MARGIN_PX: 12,     // right rail padding from lamp edge
      STROKE_W:        2.0,    // outline thickness
      GLOW_PX:         6,      // single lightweight glow radius
      // flow color shimmer: "none" (fast) or "shimmer" (uses animated gradient)
      FLOW_MODE:       "none",
      FLOW_SPEED_S:    7.5,

      // palette (used for stroke + dots)
      COLOR_GOLD_SOFT: "rgba(242,220,160,0.95)",
      COLOR_CYAN:      "rgba(99,211,255,1)",
      COLOR_CYAN_FADE: "rgba(99,211,255,0.18)",

      // optional small title above the stack
      TITLE: "Intent score factors",
      TITLE_PT: 14,
      TITLE_WEIGHT: 700,
    };
    return Object.assign(d, cfg);
  }

  // -------- utility: rounded rect path -------------------------------
  function roundedRectPath(x, y, w, h, r) {
    const rr = Math.min(r, Math.min(w, h) / 2), x2 = x + w, y2 = y + h;
    return [
      `M ${x+rr} ${y}`, `H ${x2-rr}`, `Q ${x2} ${y} ${x2} ${y+rr}`,
      `V ${y2-rr}`, `Q ${x2} ${y2} ${x2-rr} ${y2}`,
      `H ${x+rr}`, `Q ${x} ${y2} ${x} ${y2-rr}`,
      `V ${y+rr}`, `Q ${x} ${y} ${x+rr} ${y}`, "Z"
    ].join(" ");
  }

  // text inside shapes (foreignObject for wrapping)
  function addFO(svg, x, y, w, h, text, size, weight, color, padX, padY) {
    const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
    fo.setAttribute("x", x + padX);
    fo.setAttribute("y", y + padY);
    fo.setAttribute("width",  Math.max(0.1, w - 2 * padX));
    fo.setAttribute("height", Math.max(0.1, h - 2 * padY));
    const div = document.createElement("div");
    div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    div.style.cssText = `
      width:100%; height:100%;
      display:flex; align-items:center; justify-content:center;
      text-align:center; line-height:1.15;
      font:${weight} ${size}px/1.15 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color:${color}; overflow:hidden; word-wrap:break-word; white-space:normal;
    `;
    div.textContent = text;
    fo.appendChild(div);
    svg.appendChild(fo);
  }

  // lightweight, scoped gradients (static by default)
  function addGradients(ns, svg, ids, C, x1, y, x2, yMid, rightEnd) {
    const defs = document.createElementNS(ns, "defs");

    const gFlow = document.createElementNS(ns, "linearGradient");
    gFlow.id = ids.flow; gFlow.setAttribute("gradientUnits","userSpaceOnUse");
    gFlow.setAttribute("x1", x1); gFlow.setAttribute("y1", y);
    gFlow.setAttribute("x2", x2); gFlow.setAttribute("y2", y);
    [["0%","rgba(230,195,107,.95)"],["35%","#fff"],["75%",C.COLOR_CYAN],["100%","rgba(99,211,255,.60)"]]
      .forEach(([o,c])=>{ const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gFlow.appendChild(s); });

    const gTrail = document.createElementNS(ns,"linearGradient");
    gTrail.id = ids.trail; gTrail.setAttribute("gradientUnits","userSpaceOnUse");
    gTrail.setAttribute("x1", x2); gTrail.setAttribute("y1", yMid);
    gTrail.setAttribute("x2", rightEnd); gTrail.setAttribute("y2", yMid);
    [["0%","rgba(230,195,107,.92)"],["45%",C.COLOR_CYAN],["100%",C.COLOR_CYAN_FADE]]
      .forEach(([o,c])=>{ const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gTrail.appendChild(s); });

    // Optional shimmer (heavier). Disabled unless C.FLOW_MODE === "shimmer".
    if (C.FLOW_MODE === "shimmer") {
      const a1 = document.createElementNS(ns,"animateTransform");
      a1.setAttribute("attributeName","gradientTransform"); a1.setAttribute("type","translate");
      a1.setAttribute("from","0 0"); a1.setAttribute("to", `${Math.max(40,(x2-x1))} 0`);
      a1.setAttribute("dur", `${C.FLOW_SPEED_S}s`); a1.setAttribute("repeatCount","indefinite");
      gFlow.appendChild(a1);

      const a2 = document.createElementNS(ns,"animateTransform");
      a2.setAttribute("attributeName","gradientTransform"); a2.setAttribute("type","translate");
      a2.setAttribute("from","0 0"); a2.setAttribute("to", `${Math.max(40,(rightEnd-x2))} 0`);
      a2.setAttribute("dur", `${C.FLOW_SPEED_S}s`); a2.setAttribute("repeatCount","indefinite");
      gTrail.appendChild(a2);
    }

    defs.appendChild(gFlow); defs.appendChild(gTrail); svg.appendChild(defs);
  }

  // animate the stroke only once on mount
  function animateStroke(el, ms) {
    const len = el.getTotalLength ? el.getTotalLength() : 0;
    if (!len) return;
    el.style.strokeDasharray  = String(len);
    el.style.strokeDashoffset = String(len);
    el.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.22,.61,.36,1)`;
    requestAnimationFrame(() => { el.style.strokeDashoffset = "0"; });
  }

  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[SCENE_ID] = function sceneStep1(ctx){
    const { ns, canvas, bounds, config } = ctx;
    const C = defaults((config && config.step1) || {});
    const b = bounds;

    // SVG sized to lamp region
    const W = b.width, H = Math.min(560, b.sH - 40);
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.position = "absolute"; svg.style.left = `${b.left}px`; svg.style.top = `${b.top}px`;
    svg.style.overflow = "visible";
    canvas.appendChild(svg);

    // geometry
    const w  = Math.max(120, W * C.BOX_W_RATIO);
    const h  = Math.max(48,  W * C.BOX_H_RATIO);
    const g  = Math.max(8,   W * C.GAP_RATIO);
    const sx = (W * C.STACK_X_RATIO) + C.NUDGE_X;    // stack center X
    let   y0 = (H * C.STACK_TOP_RATIO) + C.NUDGE_Y;  // stack top Y
    const x0 = sx - w/2;

    // gradient IDs (scoped to this scene)
    const gid = Math.random().toString(36).slice(2,7);
    const ids = { flow: `s1_flow_${gid}`, trail: `s1_trail_${gid}` };
    const railRight = W - C.RIGHT_MARGIN_PX;
    addGradients(ns, svg, ids, C, x0, y0, x0 + w, y0 + h/2, railRight);

    // rails anchored to TOP box mid-Y
    const leftStopX = Math.max(0, Math.min(W, W * C.LEFT_STOP_RATIO));
    const yMidTop   = y0 + h/2;

    const railStyle = `stroke:url(#${ids.trail});stroke-width:${C.STROKE_W};stroke-linecap:round`;
    const leftRail  = document.createElementNS(ns,"line");
    leftRail.setAttribute("x1", leftStopX); leftRail.setAttribute("y1", yMidTop);
    leftRail.setAttribute("x2", x0);        leftRail.setAttribute("y2", yMidTop);
    leftRail.setAttribute("style", railStyle);
    svg.appendChild(leftRail);

    const rightRail = document.createElementNS(ns,"line");
    rightRail.setAttribute("x1", x0 + w); rightRail.setAttribute("y1", yMidTop);
    rightRail.setAttribute("x2", railRight); rightRail.setAttribute("y2", yMidTop);
    rightRail.setAttribute("style", railStyle);
    svg.appendChild(rightRail);

    // optional title
    if (C.TITLE) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", sx); t.setAttribute("y", Math.max(0, y0 - 14));
      t.setAttribute("text-anchor","middle");
      t.setAttribute("fill", C.TEXT_COLOR);
      t.setAttribute("font-size", C.TITLE_PT);
      t.setAttribute("font-weight", C.TITLE_WEIGHT);
      t.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
      t.textContent = C.TITLE;
      svg.appendChild(t);
    }

    // common stroke + single glow (lighter than the old multi-shadow .glow)
    const stroke = `stroke:url(#${ids.flow});stroke-width:${C.STROKE_W};fill:none;` +
                   `filter:drop-shadow(0 0 ${C.GLOW_PX}px rgba(99,211,255,.35))`;

    const items = [
      { kind:"rect",    r:12,         txt:"Number of Searches / TimeBlock",  f:C.FONT_PT_PILL||C.FONT_PT },
      { kind:"rect",    r:12,         txt:"Technologies used at the location", f:C.FONT_PT },
      { kind:"capsule",               txt:"Number of customers based on LTV/CAC", f:C.FONT_PT },
      { kind:"oval",                  txt:"Tools interacted",                    f:C.FONT_PT_OVAL||C.FONT_PT },
      { kind:"diamond",               txt:"Company Size",                        f:C.FONT_PT_DIAMOND||C.FONT_PT },
    ];

    // draw shapes
    let y = y0;
    items.forEach((it, i) => {
      const x = sx - w/2;

      if (it.kind === "oval") {
        const e = document.createElementNS(ns,"ellipse");
        e.setAttribute("cx", sx); e.setAttribute("cy", y + h/2);
        e.setAttribute("rx", w/2); e.setAttribute("ry", h/2);
        e.setAttribute("style", stroke);
        svg.appendChild(e);
        animateStroke(e, Math.max(400, C.FLOW_SPEED_S*90));
        addFO(svg, x, y, w, h, it.txt, it.f, C.FONT_WEIGHT, C.TEXT_COLOR, C.TEXT_PAD_X, C.TEXT_PAD_Y);

      } else if (it.kind === "diamond") {
        const p = document.createElementNS(ns,"path");
        const cx = sx, cy = y + h/2, hw = w/2, hh = h/2;
        p.setAttribute("d", `M ${cx} ${cy-hh} L ${cx+hw} ${cy} L ${cx} ${cy+hh} L ${cx-hw} ${cy} Z`);
        p.setAttribute("style", stroke);
        svg.appendChild(p);
        animateStroke(p, Math.max(400, C.FLOW_SPEED_S*90));
        addFO(svg, x, y, w, h, it.txt, it.f, C.FONT_WEIGHT, C.TEXT_COLOR, C.TEXT_PAD_X, C.TEXT_PAD_Y);

        // trailing dots below diamond (always outside the diamond)
        const dy = Math.max(6, h*0.12), r = Math.max(1.8, C.STROKE_W*0.55);
        for (let k=1;k<=3;k++){
          const c = document.createElementNS(ns, "circle");
          c.setAttribute("cx", cx);
          c.setAttribute("cy", y + h + k*dy);
          c.setAttribute("r",  r);
          c.setAttribute("fill", C.COLOR_GOLD_SOFT);
          svg.appendChild(c);
        }

      } else {
        // rect / capsule
        const path = document.createElementNS(ns,"path");
        const radius = (it.kind === "capsule") ? h/2 : (it.r || 12);
        path.setAttribute("d", roundedRectPath(x, y, w, h, radius));
        path.setAttribute("style", stroke);
        svg.appendChild(path);
        animateStroke(path, Math.max(400, C.FLOW_SPEED_S*90));
        addFO(svg, x, y, w, h, it.txt, it.f, C.FONT_WEIGHT, C.TEXT_COLOR, C.TEXT_PAD_X, C.TEXT_PAD_Y);
      }

      y += h + g;
    });
  };
})();
