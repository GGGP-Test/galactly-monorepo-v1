// sections/process/steps/process.step2.js
(() => {
  const STEP = 2;
  const NS = "http://www.w3.org/2000/svg";

  // -------------------- DESKTOP CONFIG (unchanged) --------------------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step2 = root.step2 || {};
    const dflt = {
      // ===== DESKTOP knobs (keep visuals/layout identical to before) =====
      BOX_W_RATIO: 0.10,
      BOX_H_RATIO: 0.12,
      GAP_RATIO: 0.035,
      STACK_X_RATIO: 0.705,
      STACK_TOP_RATIO: 0.21,
      NUDGE_X: -230,
      NUDGE_Y: -20,
      RADIUS_RECT: 14,
      RADIUS_PILL: 18,
      RADIUS_OVAL: 999,
      DIAMOND_SCALE: 1,
      SHOW_LEFT_LINE: true,
      SHOW_RIGHT_LINE: true,
      LEFT_STOP_RATIO: 0.35,
      RIGHT_MARGIN_PX: 16,
      H_LINE_Y_BIAS: -0.06,
      CONNECT_X_PAD: 8,
      LINE_STROKE_PX: 2.5,

      FONT_PT_CIRCLE: 8,
      FONT_PT_BOX: 8,
      FONT_PT_DIAMOND: 7,
      FONT_WEIGHT_BOX: 525,
      FONT_FAMILY_BOX:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      FONT_LETTER_SPACING: 0.3,
      LINE_HEIGHT_EM: 1.15,
      PADDING_X: 4,
      PADDING_Y: 4,
      UPPERCASE: false,

      // Title (desktop)
      TITLE_SHOW: true,
      TITLE_TEXT: "Weight Score — Who stays the longest?",
      TITLE_PT: 14,
      TITLE_WEIGHT: 700,
      TITLE_FAMILY:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_OFFSET_X: 0,
      TITLE_OFFSET_Y: -28,
      TITLE_LETTER_SPACING: 0.2,

      // Left copy block (desktop)
      COPY_LEFT_RATIO: 0.035,
      COPY_TOP_RATIO: 0.18,
      COPY_NUDGE_X: 0,
      COPY_NUDGE_Y: 0,
      COPY_MAX_W_PX: 300,
      COPY_H_PT: 24,
      COPY_H_WEIGHT: 500,
      COPY_BODY_PT: 12,
      COPY_BODY_WEIGHT: 400,
      COPY_FAMILY:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_LINE_HEIGHT: 1.6,

      // Animation & colors
      STROKE_PX: 2.8,
      GLOW_PX: 16,
      FLOW_SPEED_S: 6.5,
      REDUCE_MOTION: false,
      COLOR_CYAN: "rgba(99,211,255,0.95)",
      COLOR_GOLD: "rgba(242,220,160,0.92)",

      // Dots
      DOTS_COUNT: 3,
      DOTS_SIZE_PX: 2.2,
      DOTS_GAP_PX: 26,
      DOTS_Y_OFFSET: 26,

      // ===== Labels (shared defaults used by mobile unless overridden) =====
      TITLE_SEO: "Who becomes a long-term customer?",
      COPY_SEO_HTML:
        '<h3>Who becomes a long-term customer?</h3>\
         <p>Our <b>Weight Score</b> estimates retention by combining four signals:\
         how much the product depends on packaging, how deeply packaging is embedded in operations,\
         reorder cadence & SKU velocity, and the risk of switching due to specs, approvals, or compliance.\
         It highlights accounts likely to stay and grow — not just click.</p>',

      ITEMS: [
        { type: "circle",  label: "Product-Packaging Reliance", circleDiamRatio: null, fontPt: null },
        { type: "pill",    label: "Ops Lock-In (lines/specs)", heightRatio: null, fontPt: null },
        { type: "rect",    label: "Cadence & SKU Velocity",    heightRatio: null, fontPt: null },
        { type: "oval",    label: "Switching Risk / Approvals",heightRatio: null, fontPt: null }
      ],

      // legacy mobile bits kept for fallback calc only (desktop path unaffected)
      MOBILE_BREAKPOINT: 640,
      CIRCLE_DESKTOP_DIAM_RATIO: 0.10
    };
    for (const k in dflt) if (!(k in root.step2)) root.step2[k] = dflt[k];
    return root.step2;
  }

  // -------------------- MOBILE CONFIG (tweakable; DOM flow; no clipping) --------------------
  function MCFG() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.mobile = root.mobile || {};
    root.mobile.step2 = root.mobile.step2 || {};
    const m = root.mobile.step2;
    const d = {
      BP: (root.mobile.BP ?? 1024), // inherit site-wide mobile BP unless overridden
      // Wrapper layout
      top: 40, bottom: 72, maxW: 520, sidePad: 16, nudgeX: 0, nudgeY: 0,
      // Title
      titleShow: true,
      titleText: C().TITLE_SEO || C().TITLE_TEXT,
      titlePt: 16, titleWeight: 700, titleLetter: 0.2, titleAlign: "center",
      titleMarginTop: 6, titleMarginBottom: 10,
      // Copy
      copyHTML: C().COPY_SEO_HTML,
      copyHpt: 22, copyBodyPt: 14, copyLine: 1.55,
      copyColor: "#a7bacb", copyHColor: "#eaf0f6", copyGapBottom: 14,
      // Stack/boxes
      stackGap: 14,
      box: {
        widthPct: 100, minH: 56, padX: 12, padY: 10, border: 2, radius: 14,
        fontPt: 11, fontWeight: 525, letter: 0.3, lineEm: 1.15, align: "center"
      },
      circle: { diamPx: 96, fontPt: 11, fontWeight: 525, letter: 0.3, lineEm: 1.15 },
      dots: { show: true, count: 3, size: 6, gap: 14, padTop: 8 },
      // Per-item overrides + nudges
      overrides: {
        circle1: { nudgeX: 0, nudgeY: 0 },     // adds translate on the circle
        pill2:   { nudgeX: 0, nudgeY: 0, radius: 18 },
        rect3:   { nudgeX: 0, nudgeY: 0 },
        oval4:   { nudgeX: 0, nudgeY: 0, radius: 9999 }
      },
      // Visual order
      order: ["circle1","pill2","rect3","oval4"]
    };
    // fill missing keys w/o overwriting user-specified values
    for (const k in d) if (!(k in m)) m[k] = d[k];
    if (!m.box) m.box = d.box;
    if (!m.circle) m.circle = d.circle;
    if (!m.dots) m.dots = d.dots;
    if (!m.overrides) m.overrides = d.overrides;
    if (!m.order) m.order = d.order;
    return m;
  }

  // -------------------- helpers (desktop keep same) --------------------
  const reduceMotion = () =>
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || C().REDUCE_MOTION;

  function makeFlowGradients(svg, { spanX, y }) {
    const defs = document.createElementNS(NS, "defs");

    const gFlow = document.createElementNS(NS, "linearGradient");
    gFlow.id = "gradFlow"; gFlow.setAttribute("gradientUnits", "userSpaceOnUse");
    gFlow.setAttribute("x1", 0); gFlow.setAttribute("y1", y);
    gFlow.setAttribute("x2", spanX); gFlow.setAttribute("y2", y);
    [["0%", C().COLOR_GOLD], ["35%", "rgba(255,255,255,.95)"], ["75%", C().COLOR_CYAN], ["100%", "rgba(99,211,255,.60)"]]
      .forEach(([o, c]) => { const s = document.createElementNS(NS, "stop"); s.setAttribute("offset", o); s.setAttribute("stop-color", c); gFlow.appendChild(s); });
    if (!reduceMotion() && C().FLOW_SPEED_S > 0) {
      const a1 = document.createElementNS(NS, "animateTransform");
      a1.setAttribute("attributeName", "gradientTransform"); a1.setAttribute("type", "translate");
      a1.setAttribute("from", "0 0"); a1.setAttribute("to", `${spanX} 0`);
      a1.setAttribute("dur", `${C().FLOW_SPEED_S}s`); a1.setAttribute("repeatCount", "indefinite");
      gFlow.appendChild(a1);
    }
    defs.appendChild(gFlow);

    const gTrail = document.createElementNS(NS, "linearGradient");
    gTrail.id = "gradTrailFlow"; gTrail.setAttribute("gradientUnits", "userSpaceOnUse");
    gTrail.setAttribute("x1", spanX); gTrail.setAttribute("y1", y);
    gTrail.setAttribute("x2", spanX * 2); gTrail.setAttribute("y2", y);
    [["0%", C().COLOR_GOLD], ["45%", C().COLOR_CYAN], ["100%", "rgba(99,211,255,.18)"]]
      .forEach(([o, c]) => { const s = document.createElementNS(NS, "stop"); s.setAttribute("offset", o); s.setAttribute("stop-color", c); gTrail.appendChild(s); });
    if (!reduceMotion() && C().FLOW_SPEED_S > 0) {
      const a2 = document.createElementNS(NS, "animateTransform");
      a2.setAttribute("attributeName", "gradientTransform"); a2.setAttribute("type", "translate");
      a2.setAttribute("from", "0 0"); a2.setAttribute("to", `${spanX} 0`);
      a2.setAttribute("dur", `${C().FLOW_SPEED_S}s`); a2.setAttribute("repeatCount", "indefinite");
      gTrail.appendChild(a2);
    }
    defs.appendChild(gTrail);
    svg.appendChild(defs);
  }

  function makeSegmentGradient(svg, x1, y, x2) {
    const id = "seg_" + Math.random().toString(36).slice(2, 8);
    let defs = svg.querySelector("defs");
    if (!defs) { defs = document.createElementNS(NS, "defs"); svg.appendChild(defs); }
    const g = document.createElementNS(NS, "linearGradient");
    g.setAttribute("id", id);
    g.setAttribute("gradientUnits", "userSpaceOnUse");
    g.setAttribute("x1", x1); g.setAttribute("y1", y);
    g.setAttribute("x2", x2); g.setAttribute("y2", y);
    [["0%", C().COLOR_GOLD], ["35%", "rgba(255,255,255,.95)"], ["75%", C().COLOR_CYAN], ["100%", "rgba(99,211,255,.60)"]]
      .forEach(([o, c]) => { const s = document.createElementNS(NS, "stop"); s.setAttribute("offset", o); s.setAttribute("stop-color", c); g.appendChild(s); });
    if (!reduceMotion() && C().FLOW_SPEED_S > 0) {
      const a = document.createElementNS(NS, "animateTransform");
      a.setAttribute("attributeName", "gradientTransform");
      a.setAttribute("type", "translate"); a.setAttribute("from", "0 0"); a.setAttribute("to", `${(x2 - x1)} 0`);
      a.setAttribute("dur", `${C().FLOW_SPEED_S}s`); a.setAttribute("repeatCount", "indefinite");
      g.appendChild(a);
    }
    defs.appendChild(g);
    return `url(#${id})`;
  }

  const rr = (x, y, w, h, r) => {
    const R = Math.min(r, Math.min(w, h) / 2);
    return `M ${x + R} ${y} H ${x + w - R} Q ${x + w} ${y} ${x + w} ${y + R}
            V ${y + h - R} Q ${x + w} ${y + h} ${x + w - R} ${y + h}
            H ${x + R} Q ${x} ${y + h} ${x} ${y + h - R}
            V ${y + R} Q ${x} ${y} ${x + R} ${y} Z`;
  };

  function addPath(svg, d, stroke, sw) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", sw);
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("class", "glow");
    svg.appendChild(p);
    return p;
  }

  function addCircle(svg, cx, cy, r, stroke, sw) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
    c.setAttribute("fill", "none"); c.setAttribute("stroke", stroke);
    c.setAttribute("stroke-width", sw); c.setAttribute("class", "glow");
    svg.appendChild(c);
    return c;
  }

  function addFO(svg, x, y, w, h, html, styles) {
    const fo = document.createElementNS(NS, "foreignObject");
    fo.setAttribute("x", x); fo.setAttribute("y", y);
    fo.setAttribute("width", w); fo.setAttribute("height", h);
    const d = document.createElement("div");
    d.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    Object.assign(d.style, {
      width: "100%", height: "100%", display: "flex",
      alignItems: "center", justifyContent: "center", textAlign: "center",
      color: "#ddeaef", whiteSpace: "pre-wrap", wordBreak: "break-word", pointerEvents: "none"
    }, styles || {});
    d.innerHTML = html;
    fo.appendChild(d);
    svg.appendChild(fo);
  }

  // -------------------- MOBILE: DOM layout (block flow, auto-growing) --------------------
  const isMobile = () => {
    const BP = MCFG().BP ?? 640;
    return (window.PROCESS_FORCE_MOBILE === true) ||
           (window.matchMedia && window.matchMedia(`(max-width:${BP}px)`).matches);
  };

  function m2Container({ top, bottom, maxW, sidePad, nudgeX, nudgeY }){
    const el = document.createElement("div");
    el.className = "mstep mstep2";
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
    node.style.borderStyle = "solid";
    node.style.borderColor = "rgba(99,211,255,.95)";
    node.style.borderRadius = `${b.radius ?? 14}px`;
    node.style.font = `${b.fontWeight ?? 525} ${b.fontPt ?? 11}pt ${C().FONT_FAMILY_BOX}`;
    node.style.letterSpacing = `${b.letter ?? 0.3}px`;
    node.style.lineHeight = `${b.lineEm ?? 1.15}em`;
    node.style.textAlign = b.align || "center";
    node.style.color = "#ddeaef";
    node.style.background = "rgba(255,255,255,.02)";
    node.style.display = "flex";
    node.style.alignItems = "center";
    node.style.justifyContent = "center";
    if (ov && (ov.nudgeX || ov.nudgeY)){
      node.style.transform = `translate(${ov.nudgeX|0}px, ${(ov.nudgeY|0)}px)`;
    }
  }

  function renderStep2_DOM(ctx){
    // ensure canvas is in normal doc flow (no absolute clipping)
    ctx.canvas.style.position = "relative";
    ctx.canvas.style.inset = "auto";
    ctx.canvas.style.pointerEvents = "auto";

    const M = MCFG();

    const wrap = m2Container({
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
      t.textContent = (M.titleText || C().TITLE_SEO || C().TITLE_TEXT);
      t.style.textAlign = (M.titleAlign || "center");
      t.style.color = "#ddeaef";
      t.style.fontWeight = String(M.titleWeight ?? 700);
      t.style.fontSize = `${M.titlePt ?? 16}pt`;
      t.style.letterSpacing = `${M.titleLetter ?? 0.2}px`;
      t.style.marginTop = `${M.titleMarginTop ?? 6}px`;
      t.style.marginBottom = `${M.titleMarginBottom ?? 10}px`;
      wrap.appendChild(t);
    }

    // Copy
    const copy = document.createElement("div");
    copy.style.marginBottom = `${M.copyGapBottom ?? 14}px`;
    copy.innerHTML = (M.copyHTML || C().COPY_SEO_HTML);
    // style inner bits
    const h3 = copy.querySelector("h3");
    if (h3){
      h3.style.margin = "0 0 8px";
      h3.style.color = (M.copyHColor ?? "#eaf0f6");
      h3.style.font = `600 ${(M.copyHpt ?? 22)}px 'Newsreader', Georgia, serif`;
    }
    const p = copy.querySelector("p");
    if (p){
      p.style.margin = "0";
      p.style.color = (M.copyColor ?? "#a7bacb");
      p.style.font = `400 ${(M.copyBodyPt ?? 14)}px/${(M.copyLine ?? 1.55)} Inter, system-ui`;
    }
    wrap.appendChild(copy);

    // Stack
    const stack = document.createElement("div");
    stack.style.display = "flex";
    stack.style.flexDirection = "column";
    stack.style.alignItems = "center";
    stack.style.gap = `${M.stackGap ?? 14}px`;

    const labels = {
      circle1: C().ITEMS[0]?.label || "Product-Packaging Reliance",
      pill2:   C().ITEMS[1]?.label || "Ops Lock-In (lines/specs)",
      rect3:   C().ITEMS[2]?.label || "Cadence & SKU Velocity",
      oval4:   C().ITEMS[3]?.label || "Switching Risk / Approvals"
    };

    const baseBox = M.box || {};
    const OVR = M.overrides || {};
    const order = Array.isArray(M.order) ? M.order : ["circle1","pill2","rect3","oval4"];

    for (const key of order){
      const ov = OVR[key] || {};
      if (key === "circle1"){
        const c = document.createElement("div");
        const diam = (M.circle?.diamPx ?? 96);
        c.textContent = labels[key];
        c.style.width = `${diam}px`;
        c.style.height = `${diam}px`;
        c.style.border = `${baseBox.border ?? 2}px solid rgba(99,211,255,.95)`;
        c.style.borderRadius = "9999px";
        c.style.display = "flex"; c.style.alignItems = "center"; c.style.justifyContent = "center";
        c.style.background = "rgba(255,255,255,.02)";
        c.style.textAlign = "center"; c.style.padding = "6px";
        c.style.color = "#ddeaef";
        c.style.font = `${M.circle?.fontWeight ?? 525} ${(M.circle?.fontPt ?? baseBox.fontPt ?? 11)}pt ${C().FONT_FAMILY_BOX}`;
        c.style.letterSpacing = `${M.circle?.letter ?? baseBox.letter ?? 0.3}px`;
        c.style.lineHeight = `${M.circle?.lineEm ?? baseBox.lineEm ?? 1.15}em`;
        if (ov && (ov.nudgeX || ov.nudgeY)){
          c.style.transform = `translate(${ov.nudgeX|0}px, ${(ov.nudgeY|0)}px)`;
        }
        stack.appendChild(c);
      } else {
        const box = document.createElement("div");
        box.textContent = labels[key];
        // base style
        applyBoxStyles(
          box,
          Object.assign({}, baseBox, key==="oval4" ? { radius: 9999 } : {}),
          ov
        );
        stack.appendChild(box);
      }
    }

    // Dots
    const dots = (M.dots || {});
    if (dots.show !== false){
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "center";
      row.style.gap = `${dots.gap ?? 14}px`;
      row.style.paddingTop = `${dots.padTop ?? 8}px`;
      const n = Math.max(0, dots.count ?? 3);
      for (let i=0;i<n;i++){
        const dot = document.createElement("i");
        const size = `${dots.size ?? 6}px`;
        dot.style.width = size; dot.style.height = size;
        dot.style.borderRadius = "50%";
        dot.style.background = "rgba(99,211,255,.95)";
        dot.style.display = "inline-block";
        row.appendChild(dot);
      }
      stack.appendChild(row);
    }

    wrap.appendChild(stack);
    ctx.canvas.appendChild(wrap);
  }

  // -------------------- DESKTOP: identical behavior to before --------------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    if (isMobile()) { renderStep2_DOM(ctx); return; }

    // === DESKTOP SVG path (unchanged) ===
    const b = ctx.bounds;
    const W = b.width, H = Math.min(560, b.sH - 40);
    const svg = document.createElementNS(NS, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top = b.top + "px";
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    ctx.canvas.appendChild(svg);

    makeFlowGradients(svg, { spanX: W * 0.15, y: 0 });

    const boxW = W * C().BOX_W_RATIO;
    const boxH = H * C().BOX_H_RATIO;
    const gap = H * C().GAP_RATIO;
    let x = W * C().STACK_X_RATIO + C().NUDGE_X;
    let y = H * C().STACK_TOP_RATIO + C().NUDGE_Y;
    const itemsDrawn = [];

    // item 1: circle
    {
      const diam = (C().ITEMS[0].circleDiamRatio || C().CIRCLE_DESKTOP_DIAM_RATIO) * W;
      const r = diam / 2;
      const cx = x + boxW / 2;
      const cy = y + r;
      addCircle(svg, cx, cy, r, "url(#gradFlow)", C().STROKE_PX);
      addFO(svg, cx - r, cy - r, diam, diam, C().ITEMS[0].label, {
        font: `${C().FONT_WEIGHT_BOX} ${C().FONT_PT_CIRCLE}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing: `${C().FONT_LETTER_SPACING}px`,
        lineHeight: `${C().LINE_HEIGHT_EM}em`,
        padding: "3px 4px"
      });
      itemsDrawn.push({ x: cx - r, y: cy - r, w: diam, h: diam, cx, cy });
      y += diam + gap;
    }

    // item 2: pill
    {
      const h = boxH * (C().ITEMS[1].heightRatio || 1);
      const d = rr(x, y, boxW, h, C().RADIUS_PILL);
      addPath(svg, d, "url(#gradFlow)", C().STROKE_PX);
      addFO(svg, x, y, boxW, h, C().ITEMS[1].label, {
        font: `${C().FONT_WEIGHT_BOX} ${C().FONT_PT_BOX}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing: `${C().FONT_LETTER_SPACING}px`,
        lineHeight: `${C().LINE_HEIGHT_EM}em`,
        padding: `${C().PADDING_Y}px ${C().PADDING_X}px`
      });
      itemsDrawn.push({ x, y, w: boxW, h });
      y += h + gap;
    }

    // item 3: rect
    {
      const h = boxH * (C().ITEMS[2].heightRatio || 1);
      const d = rr(x, y, boxW, h, C().RADIUS_RECT);
      addPath(svg, d, "url(#gradFlow)", C().STROKE_PX);
      addFO(svg, x, y, boxW, h, C().ITEMS[2].label, {
        font: `${C().FONT_WEIGHT_BOX} ${C().FONT_PT_BOX}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing: `${C().FONT_LETTER_SPACING}px`,
        lineHeight: `${C().LINE_HEIGHT_EM}em`,
        padding: `${C().PADDING_Y}px ${C().PADDING_X}px`
      });
      itemsDrawn.push({ x, y, w: boxW, h });
      y += h + gap;
    }

    // item 4: oval
    {
      const h = boxH * (C().ITEMS[3].heightRatio || 1);
      const d = rr(x, y, boxW, h, C().RADIUS_OVAL);
      addPath(svg, d, "url(#gradFlow)", C().STROKE_PX);
      addFO(svg, x, y, boxW, h, C().ITEMS[3].label, {
        font: `${C().FONT_WEIGHT_BOX} ${C().FONT_PT_BOX}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing: `${C().FONT_LETTER_SPACING}px`,
        lineHeight: `${C().LINE_HEIGHT_EM}em`,
        padding: `${C().PADDING_Y}px ${C().PADDING_X}px`
      });
      itemsDrawn.push({ x, y, w: boxW, h });
      y += h + C().DOTS_Y_OFFSET;
    }

    // dots
    if (C().DOTS_COUNT > 0) {
      const centerX = x + boxW / 2; let dotY = y;
      for (let i = 0; i < C().DOTS_COUNT; i++) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", centerX);
        c.setAttribute("cy", dotY);
        c.setAttribute("r", C().DOTS_SIZE_PX);
        c.setAttribute("fill", C().COLOR_CYAN);
        c.setAttribute("class", "glow");
        svg.appendChild(c);
        dotY += C().DOTS_GAP_PX;
      }
    }

    // Title
    if (C().TITLE_SHOW) {
      const t = document.createElementNS(NS, "text");
      const topBox = itemsDrawn[0];
      const tx = (topBox.x + topBox.w / 2) + C().TITLE_OFFSET_X;
      const ty = (topBox.y) + C().TITLE_OFFSET_Y;
      t.setAttribute("x", tx);
      t.setAttribute("y", ty);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "#ddeaef");
      t.setAttribute("font-family", C().TITLE_FAMILY);
      t.setAttribute("font-weight", C().TITLE_WEIGHT);
      t.setAttribute("font-size", `${C().TITLE_PT}pt`);
      t.textContent = C().TITLE_TEXT;
      t.style.letterSpacing = `${C().TITLE_LETTER_SPACING}px`;
      svg.appendChild(t);
    }

    // Horizontal rails
    if (itemsDrawn.length) {
      const first = itemsDrawn[0];
      const attachY = first.y + first.h * (0.5 + C().H_LINE_Y_BIAS);
      if (C().SHOW_LEFT_LINE) {
        const xs = W * Math.max(0, Math.min(1, C().LEFT_STOP_RATIO));
        const xe = itemsDrawn[0].x - C().CONNECT_X_PAD;
        if (xe > xs) {
          const stroke = makeSegmentGradient(svg, xs, attachY, xe);
          addPath(svg, `M ${xs} ${attachY} H ${xe}`, stroke, C().LINE_STROKE_PX);
        }
      }
      if (C().SHOW_RIGHT_LINE) {
        const xs = itemsDrawn[0].x + itemsDrawn[0].w + C().CONNECT_X_PAD;
        const xe = W - C().RIGHT_MARGIN_PX;
        if (xe > xs) {
          const stroke = makeSegmentGradient(svg, xs, attachY, xe);
          addPath(svg, `M ${xs} ${attachY} H ${xe}`, stroke, C().LINE_STROKE_PX);
        }
      }
    }

    // Vertical connectors
    for (let i = 0; i < itemsDrawn.length - 1; i++) {
      const a = itemsDrawn[i], b2 = itemsDrawn[i + 1];
      const xMid = a.x + a.w / 2;
      const y1 = a.y + a.h;
      const y2 = b2.y;
      const pad = Math.max(2, C().STROKE_PX);
      addPath(svg, `M ${xMid} ${y1 + pad} V ${y2 - pad}`, "url(#gradTrailFlow)", C().LINE_STROKE_PX);
    }

    // Left copy (desktop)
    const left = b.left + W * C().COPY_LEFT_RATIO + C().COPY_NUDGE_X;
    const top = b.top + H * C().COPY_TOP_RATIO + C().COPY_NUDGE_Y;
    if (typeof ctx.mountCopy === "function") {
      const el = ctx.mountCopy({ top, left, html: C().COPY_SEO_HTML });
      el.style.maxWidth = `${C().COPY_MAX_W_PX}px`;
      el.style.fontFamily = C().COPY_FAMILY;
      const h3 = el.querySelector("h3"); if (h3) h3.style.font = `${C().COPY_H_WEIGHT} ${C().COPY_H_PT}pt ${C().COPY_FAMILY}`;
      const p = el.querySelector("p"); if (p) p.style.cssText = `font:${C().COPY_BODY_WEIGHT} ${C().COPY_BODY_PT}pt ${C().COPY_FAMILY}; line-height:${C().COPY_LINE_HEIGHT}`;
    }
  };
})();