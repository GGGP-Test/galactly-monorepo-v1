// sections/process/steps/process.step3.js
(() => {
  const STEP = 3;
  const NS = "http://www.w3.org/2000/svg";

  // -------------------- CONFIG: DESKTOP (unchanged) --------------------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step3 = root.step3 || {};
    const cfg = root.step3;

    const dflt = {
      // ===== DESKTOP knobs (same visuals as before) =====
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
      TITLE_TEXT: "Weight Score",
      TITLE_PT: 14,
      TITLE_WEIGHT: 700,
      TITLE_FAMILY:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_OFFSET_X: 0,
      TITLE_OFFSET_Y: -28,
      TITLE_LETTER_SPACING: 0.2,

      // Left copy (desktop)
      COPY_LEFT_RATIO: 0.035,
      COPY_TOP_RATIO: 0.18,
      COPY_NUDGE_X: -20,
      COPY_NUDGE_Y: 0,
      COPY_MAX_W_PX: 300,
      COPY_H_PT: 20,
      COPY_H_WEIGHT: 500,
      COPY_BODY_PT: 11,
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

      // Shape sizes (desktop)
      CIRCLE_DESKTOP_DIAM_RATIO: 0.10,
      
      // Tablet breakpoint (Step 3)
      TABLET_BP: 1024,

      // ===== Labels / copy =====
      TITLE_SEO: "Who becomes a long-term customer?",
      COPY_SEO_HTML:
        '<h3>Who becomes a long-term customer?</h3>' +
        '<p>Our <b>Weight Score</b> estimates retention by combining several signals: ' +
        'how much the product depends on packaging, how deeply packaging is embedded in operations, ' +
        'reorder cadence & SKU velocity, and the risk of switching due to specs, approvals, or compliance. ' +
        'It highlights accounts likely to stay and grow — not just click.</p>',

      ITEMS: [
        {
          type: "circle",
          label: "Product-Packaging Reliance",
          circleDiamRatio: null,
          fontPt: null
        },
        {
          type: "pill",
          label: "Ops Lock-In (lines/specs)",
          heightRatio: null,
          fontPt: null
        },
        {
          type: "rect",
          label: "Cadence & SKU Velocity",
          heightRatio: null,
          fontPt: null
        },
        {
          type: "oval",
          label: "Switching Risk / Approvals",
          heightRatio: null,
          fontPt: null
        }
      ]
    };

    for (const k in dflt) {
      if (!(k in cfg)) cfg[k] = dflt[k];
    }
    return cfg;
  }

  // -------------------- CONFIG: MOBILE STEP 3 (mirrors mobile.step1 / step2) --------------------
  function M() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    const mobile = (root.mobile = root.mobile || {});

    if (!mobile.step3) {
      mobile.step3 = {
        useTheme: true,

        // whole-section placement
        top: 50,
        bottom: 80,
        maxW: 520,
        sidePad: 20,
        nudgeX: 0,
        nudgeY: 0,

        // step title: "Weight Score — Who stays the longest?"
        titleShow: true,
        titlePt: 11,
        titleWeight: 700,
        titleLetter: 0.2,
        titleAlign: "center",
        titleMarginTop: 10,       // gap from copy → title
        titleMarginBottom: 12,    // gap from title → boxes
        titleNudgeX: 42,
        titleNudgeY: 10,

        // h3 + body: "Who becomes a long-term customer?"
        copyHpt: 22,
        copyBodyPt: 14,
        copyLine: 1.6,
        copyColor: "#a7bacb",
        copyHColor: "#eaf0f6",
        copyGapBottom: 14,        // gap from copy → title
        copyHGap: 8,              // gap between h3 and p
        copyHTML: null,           // optional override

        // gap between the boxes themselves
        stackGap: 10,

        // ALL rectangular / pill boxes in this step
        box: {
          widthPct: 50,
          minH: 15,
          padX: 12,
          padY: 10,
          border: 2,
          radius: 18,
          fontPt: 8,
          fontWeight: 525,
          letter: 0.3,
          lineEm: 1.2,
          align: "center",
          nudgeX: 42,
          nudgeY: 10
        },

        // circular width % for the circle tile
        circlePct: 27,

        // dots row
        dots: {
          show: false,
          count: 3,
          size: 6,
          gap: 8,
          padTop: 4
        },

        // per-shape overrides
        overrides: {
          circle1: {},
          pill2: {},
          rect3: {},
          oval4: {}
        },

        // draw order
        order: ["circle1", "pill2", "rect3", "oval4"]
      };
    }

    return mobile.step3;
  }
  
  
    // -------------------- CONFIG: TABLET STEP 3 (tablet-only knobs) --------------------
  // Same visuals as desktop, but with its own layout & typography knobs for tablets only.
  function T() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step3Tablet = root.step3Tablet || {};
    const tcfg = root.step3Tablet;
    const base = C(); // desktop defaults

    // 🔧 Tablet-only defaults for Step 3
    const dfltTablet = {
      // ----- LEFT COPY COLUMN -----
      // max width of the left text block
      COPY_MAX_W_PX: 200,
      // where the copy column starts (fraction of Step canvas width)
      COPY_LEFT_RATIO: 0.055,
      COPY_TOP_RATIO: base.COPY_TOP_RATIO,   // keep vertical anchor from desktop
      // pixel nudges on top of the ratios
      COPY_NUDGE_X: -50,       // + = right,  - = left
      COPY_NUDGE_Y: base.COPY_NUDGE_Y,       // + = down,   - = up

      // ----- RIGHT STACK (ALL SHAPES) -----
      BOX_W_RATIO:    0.3,      // width of the stack tiles
      BOX_H_RATIO:    base.BOX_H_RATIO,      // base height for tiles
      GAP_RATIO:      base.GAP_RATIO,        // vertical gap between shapes
      STACK_X_RATIO:  base.STACK_X_RATIO,    // anchor for the stack
      STACK_TOP_RATIO: 0.20,                 // slightly adjusted vertical anchor

      // Move the ENTIRE stack (circle + boxes + dots + title) on tablet
      NUDGE_X: -70,                         // + = move stack right,  - = left
      NUDGE_Y: base.NUDGE_Y,                 // + = move stack down,   - = up

      // ----- STROKES & CONNECTORS -----
      STROKE_PX:      base.STROKE_PX,        // outline thickness of shapes
      LINE_STROKE_PX: base.LINE_STROKE_PX,   // connector + rail thickness

      RADIUS_RECT:    base.RADIUS_RECT,
      RADIUS_PILL:    base.RADIUS_PILL,
      RADIUS_OVAL:    base.RADIUS_OVAL,
      DIAMOND_SCALE:  base.DIAMOND_SCALE,
      CIRCLE_DESKTOP_DIAM_RATIO: 0.2,

      SHOW_LEFT_LINE:  base.SHOW_LEFT_LINE,
      SHOW_RIGHT_LINE: base.SHOW_RIGHT_LINE,
      LEFT_STOP_RATIO: base.LEFT_STOP_RATIO,
      RIGHT_MARGIN_PX: base.RIGHT_MARGIN_PX,
      H_LINE_Y_BIAS:   base.H_LINE_Y_BIAS,
      CONNECT_X_PAD:   base.CONNECT_X_PAD,

      // ----- TYPOGRAPHY FOR SHAPES -----
      FONT_PT_CIRCLE:   base.FONT_PT_CIRCLE,
      FONT_PT_BOX:      base.FONT_PT_BOX,
      FONT_PT_DIAMOND:  base.FONT_PT_DIAMOND,
      FONT_WEIGHT_BOX:  base.FONT_WEIGHT_BOX,
      FONT_FAMILY_BOX:  base.FONT_FAMILY_BOX,
      FONT_LETTER_SPACING: base.FONT_LETTER_SPACING,
      LINE_HEIGHT_EM:      base.LINE_HEIGHT_EM,
      PADDING_X:           base.PADDING_X,
      PADDING_Y:           base.PADDING_Y,
      UPPERCASE:           base.UPPERCASE,

      // ----- TITLE ABOVE STACK -----
      TITLE_SHOW:           base.TITLE_SHOW,
      TITLE_TEXT:           base.TITLE_TEXT,
      TITLE_PT:             base.TITLE_PT - 1, // slightly smaller on tablet
      TITLE_WEIGHT:         base.TITLE_WEIGHT,
      TITLE_FAMILY:         base.TITLE_FAMILY,
      TITLE_OFFSET_X:       base.TITLE_OFFSET_X,
      TITLE_OFFSET_Y:       base.TITLE_OFFSET_Y,
      TITLE_LETTER_SPACING: base.TITLE_LETTER_SPACING,

      // ----- COPY TYPOGRAPHY -----
      COPY_H_PT:        base.COPY_H_PT - 2,   // slightly smaller h3
      COPY_H_WEIGHT:    base.COPY_H_WEIGHT,
      COPY_BODY_PT:     base.COPY_BODY_PT - 1,
      COPY_BODY_WEIGHT: base.COPY_BODY_WEIGHT,
      COPY_FAMILY:      base.COPY_FAMILY,
      COPY_LINE_HEIGHT: base.COPY_LINE_HEIGHT,

      // ----- DOTS UNDER STACK -----
      DOTS_COUNT:    0,
      DOTS_SIZE_PX:  base.DOTS_SIZE_PX,
      DOTS_GAP_PX:   base.DOTS_GAP_PX,
      DOTS_Y_OFFSET: base.DOTS_Y_OFFSET
    };

    // Apply defaults only if not overridden yet
    for (const k in dfltTablet) {
      if (!(k in tcfg)) tcfg[k] = dfltTablet[k];
    }

    return tcfg;
  }
  

  // -------------------- helpers --------------------
  const reduceMotion = () =>
    (window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    C().REDUCE_MOTION;

  function makeFlowGradients(svg, { spanX, y }) {
    const defs = document.createElementNS(NS, "defs");

    const gFlow = document.createElementNS(NS, "linearGradient");
    gFlow.id = "gradFlow";
    gFlow.setAttribute("gradientUnits", "userSpaceOnUse");
    gFlow.setAttribute("x1", 0);
    gFlow.setAttribute("y1", y);
    gFlow.setAttribute("x2", spanX);
    gFlow.setAttribute("y2", y);
    [
      ["0%", C().COLOR_GOLD],
      ["35%", "rgba(255,255,255,.95)"],
      ["75%", C().COLOR_CYAN],
      ["100%", "rgba(99,211,255,.60)"]
    ].forEach(([o, c]) => {
      const s = document.createElementNS(NS, "stop");
      s.setAttribute("offset", o);
      s.setAttribute("stop-color", c);
      gFlow.appendChild(s);
    });
    if (!reduceMotion() && C().FLOW_SPEED_S > 0) {
      const a1 = document.createElementNS(NS, "animateTransform");
      a1.setAttribute("attributeName", "gradientTransform");
      a1.setAttribute("type", "translate");
      a1.setAttribute("from", "0 0");
      a1.setAttribute("to", `${spanX} 0`);
      a1.setAttribute("dur", `${C().FLOW_SPEED_S}s`);
      a1.setAttribute("repeatCount", "indefinite");
      gFlow.appendChild(a1);
    }
    defs.appendChild(gFlow);

    const gTrail = document.createElementNS(NS, "linearGradient");
    gTrail.id = "gradTrailFlow";
    gTrail.setAttribute("gradientUnits", "userSpaceOnUse");
    gTrail.setAttribute("x1", spanX);
    gTrail.setAttribute("y1", y);
    gTrail.setAttribute("x2", spanX * 2);
    gTrail.setAttribute("y2", y);
    [
      ["0%", C().COLOR_GOLD],
      ["45%", C().COLOR_CYAN],
      ["100%", "rgba(99,211,255,.18)"]
    ].forEach(([o, c]) => {
      const s = document.createElementNS(NS, "stop");
      s.setAttribute("offset", o);
      s.setAttribute("stop-color", c);
      gTrail.appendChild(s);
    });
    if (!reduceMotion() && C().FLOW_SPEED_S > 0) {
      const a2 = document.createElementNS(NS, "animateTransform");
      a2.setAttribute("attributeName", "gradientTransform");
      a2.setAttribute("type", "translate");
      a2.setAttribute("from", "0 0");
      a2.setAttribute("to", `${spanX} 0`);
      a2.setAttribute("dur", `${C().FLOW_SPEED_S}s`);
      a2.setAttribute("repeatCount", "indefinite");
      gTrail.appendChild(a2);
    }
    defs.appendChild(gTrail);
    svg.appendChild(defs);
  }

  function makeSegmentGradient(svg, x1, y, x2) {
    const id = "seg_" + Math.random().toString(36).slice(2, 8);
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(NS, "defs");
      svg.appendChild(defs);
    }
    const g = document.createElementNS(NS, "linearGradient");
    g.setAttribute("id", id);
    g.setAttribute("gradientUnits", "userSpaceOnUse");
    g.setAttribute("x1", x1);
    g.setAttribute("y1", y);
    g.setAttribute("x2", x2);
    g.setAttribute("y2", y);
    [
      ["0%", C().COLOR_GOLD],
      ["35%", "rgba(255,255,255,.95)"],
      ["75%", C().COLOR_CYAN],
      ["100%", "rgba(99,211,255,.60)"]
    ].forEach(([o, c]) => {
      const s = document.createElementNS(NS, "stop");
      s.setAttribute("offset", o);
      s.setAttribute("stop-color", c);
      g.appendChild(s);
    });
    if (!reduceMotion() && C().FLOW_SPEED_S > 0) {
      const a = document.createElementNS(NS, "animateTransform");
      a.setAttribute("attributeName", "gradientTransform");
      a.setAttribute("type", "translate");
      a.setAttribute("from", "0 0");
      a.setAttribute("to", `${x2 - x1} 0`);
      a.setAttribute("dur", `${C().FLOW_SPEED_S}s`);
      a.setAttribute("repeatCount", "indefinite");
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
    c.setAttribute("cx", cx);
    c.setAttribute("cy", cy);
    c.setAttribute("r", r);
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", stroke);
    c.setAttribute("stroke-width", sw);
    c.setAttribute("class", "glow");
    svg.appendChild(c);
    return c;
  }

  function addFO(svg, x, y, w, h, html, styles) {
    const fo = document.createElementNS(NS, "foreignObject");
    fo.setAttribute("x", x);
    fo.setAttribute("y", y);
    fo.setAttribute("width", w);
    fo.setAttribute("height", h);
    const d = document.createElement("div");
    d.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    Object.assign(
      d.style,
      {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        color: "#ddeaef",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        pointerEvents: "none"
      },
      styles || {}
    );
    d.innerHTML = html;
    fo.appendChild(d);
    svg.appendChild(fo);
  }

  // -------------------- MOBILE DOM LAYOUT (Step 3, same theme as step1/2) --------------------
  function applyBoxStyles3(node, base, ov) {
    const b = Object.assign({}, base || {}, ov || {});
    node.style.width = b.widthPct != null ? `${b.widthPct}%` : "100%";
    node.style.minHeight = `${b.minH ?? 56}px`;
    node.style.padding = `${b.padY ?? 10}px ${b.padX ?? 12}px`;
    node.style.borderWidth = `${b.border ?? 2}px`;
    node.style.borderStyle = "solid";
    node.style.borderColor = "rgba(99,211,255,.95)";
    node.style.borderRadius = `${b.radius ?? 14}px`;
    node.style.font =
      `${b.fontWeight ?? 525} ${b.fontPt ?? 11}pt ` +
      'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    node.style.letterSpacing = `${b.letter ?? 0.3}px`;
    node.style.lineHeight = `${b.lineEm ?? 1.15}em`;
    node.style.textAlign = b.align || "center";

    const nx = b.nudgeX || 0;
    const ny = b.nudgeY || 0;
    if (nx || ny) {
      node.style.transform = `translate(${nx}px, ${ny}px)`;
    }
  }

  function drawMobile(ctx) {
    const cfg = C();
    const m = M();

    const items = cfg.ITEMS || [];

    // canvas is already configured for mobile by process.js
    const wrap = document.createElement("div");
    wrap.className = "mstep mstep3";
    wrap.style.marginTop = `${m.top ?? 50}px`;
    wrap.style.marginBottom = `${m.bottom ?? 80}px`;
    wrap.style.maxWidth = `${m.maxW ?? 520}px`;
    wrap.style.padding = `0 ${m.sidePad ?? 20}px`;
    wrap.style.transform = `translate(${m.nudgeX ?? 0}px, ${m.nudgeY ?? 0}px)`;

    // 1) COPY FIRST
    const copy = document.createElement("div");
    copy.className = "mstep-copy";
    copy.style.marginBottom = `${m.copyGapBottom ?? 14}px`;

    if (m.copyHTML) {
      copy.innerHTML = m.copyHTML;
    } else {
      const hGap = m.copyHGap ?? 8;
      copy.innerHTML = `
        <h3 style="margin:0 0 ${hGap}px; color:${m.copyHColor ?? "#eaf0f6"};
                   font:600 ${(m.copyHpt ?? 22)}px 'Newsreader', Georgia, serif;">
          Who becomes a long-term customer?
        </h3>
        <p style="margin:0; color:${m.copyColor ?? "#a7bacb"};
                  font:400 ${(m.copyBodyPt ?? 14)}px/${(m.copyLine ?? 1.55)} Inter, system-ui;">
          Our <b>Weight Score</b> estimates retention by combining several signals:
          how much the product depends on packaging, how deeply packaging is embedded in operations,
          reorder cadence &amp; SKU velocity, and the risk of switching due to specs, approvals, or compliance.
          It highlights accounts likely to stay and grow — not just click.
        </p>
      `;
    }
    wrap.appendChild(copy);

    // 2) STEP TITLE AFTER COPY (above boxes)
    if (m.titleShow !== false) {
      const t = document.createElement("div");
      t.className = "mstep-title";
      t.innerHTML = '<span class="mstep-title-intent">Weight</span> Score';
      t.style.textAlign = m.titleAlign || "center";
      t.style.fontWeight = String(m.titleWeight ?? 700);
      t.style.fontSize = `${m.titlePt ?? 11}pt`;
      t.style.letterSpacing = `${m.titleLetter ?? 0.2}px`;
      t.style.marginTop = `${m.titleMarginTop ?? 10}px`;
      t.style.marginBottom = `${m.titleMarginBottom ?? 12}px`;
      const tNx = m.titleNudgeX ?? 0;
      const tNy = m.titleNudgeY ?? 0;
      if (tNx || tNy) {
        t.style.transform = `translate(${tNx}px, ${tNy}px)`;
      }
      wrap.appendChild(t);
    }

    // 3) BOX STACK
    const stack = document.createElement("div");
    stack.className = "mstack";
    stack.style.gap = `${m.stackGap ?? 10}px`;

    const labels = {
      circle1: items[0]?.label || "Product-Packaging Reliance",
      pill2: items[1]?.label || "Ops Lock-In (lines/specs)",
      rect3: items[2]?.label || "Cadence & SKU Velocity",
      oval4: items[3]?.label || "Switching Risk / Approvals"
    };

    const order = Array.isArray(m.order)
      ? m.order
      : ["circle1", "pill2", "rect3", "oval4"];
    const baseBox = m.box || {};
    const OVR = m.overrides || {};

    for (const key of order) {
      const label = labels[key];
      if (!label) continue;

      if (key === "circle1") {
        const circle = document.createElement("div");
        circle.className = "mbox circle";
        circle.textContent = label;

        const ov = Object.assign(
          {
            widthPct: m.circlePct ?? 27,
            radius: 9999
          },
          OVR.circle1 || {}
        );
        applyBoxStyles3(circle, baseBox, ov);
        circle.style.aspectRatio = "1 / 1";
        stack.appendChild(circle);
      } else {
        const box = document.createElement("div");
        const isOval = key === "oval4";
        box.className = "mbox" + (isOval ? " oval" : "");
        box.textContent = label;

        const extra = isOval ? { radius: 9999 } : {};
        const ov = Object.assign({}, extra, OVR[key] || {});
        applyBoxStyles3(box, baseBox, ov);
        stack.appendChild(box);
      }
    }

    // 4) DOTS ROW
    const dots = m.dots || {};
    if (dots.show !== false) {
      const row = document.createElement("div");
      row.className = "mdots";
      row.style.gap = `${dots.gap ?? 8}px`;
      row.style.paddingTop = `${dots.padTop ?? 4}px`;
      const n = Math.max(0, dots.count ?? 3);
      for (let i = 0; i < n; i++) {
        const dot = document.createElement("i");
        const size = `${dots.size ?? 6}px`;
        dot.style.width = size;
        dot.style.height = size;
        row.appendChild(dot);
      }
      stack.appendChild(row);
    }

    wrap.appendChild(stack);
    ctx.canvas.appendChild(wrap);
  }

  // -------------------- DESKTOP + TABLET: same layout, tablet has its own knobs --------------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    const b = ctx.bounds;

    // ---- breakpoints: phone / tablet / desktop ----
    const mobileBP =
      (window.PROCESS_CONFIG &&
        window.PROCESS_CONFIG.mobile &&
        window.PROCESS_CONFIG.mobile.BP) || 640;

    const cfg = C(); // desktop defaults (also holds content: ITEMS, COPY_SEO_HTML)
    const tabletBP = cfg.TABLET_BP || 1024;
    const vw = window.innerWidth || b.sW || 1200;

    const isPhone =
      window.PROCESS_FORCE_MOBILE === true || vw <= mobileBP;

    if (isPhone) {
      drawMobile(ctx);
      return;
    }

    const isTablet = vw > mobileBP && vw <= tabletBP;
    const tcfg = isTablet ? T() : cfg;
    const use = isTablet ? tcfg : cfg; // layout / typography come from here

    // ---- DESKTOP + TABLET SVG: right stack + rails + left copy ----
    const W = b.width;
    const H = Math.min(560, b.sH - 40);
    const svg = document.createElementNS(NS, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top = b.top + "px";
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    ctx.canvas.appendChild(svg);

    makeFlowGradients(svg, { spanX: W * 0.15, y: 0 });

    const boxW = W * use.BOX_W_RATIO;
    const boxH = H * use.BOX_H_RATIO;
    const gap  = H * use.GAP_RATIO;
    let x = W * use.STACK_X_RATIO + use.NUDGE_X;
    let y = H * use.STACK_TOP_RATIO + use.NUDGE_Y;
    const itemsDrawn = [];

    const list = cfg.ITEMS || []; // content stays the same across desktop + tablet

    // 1: circle
    if (list[0]) {
      const diam =
        (list[0].circleDiamRatio || use.CIRCLE_DESKTOP_DIAM_RATIO) * W;
      const r = diam / 2;
      const cx = x + boxW / 2;
      const cy = y + r;
      addCircle(svg, cx, cy, r, "url(#gradFlow)", use.STROKE_PX);
      addFO(svg, cx - r, cy - r, diam, diam, list[0].label, {
        font: `${use.FONT_WEIGHT_BOX} ${use.FONT_PT_CIRCLE}pt ${use.FONT_FAMILY_BOX}`,
        letterSpacing: `${use.FONT_LETTER_SPACING}px`,
        lineHeight: `${use.LINE_HEIGHT_EM}em`,
        padding: "3px 4px",
        textTransform: use.UPPERCASE ? "uppercase" : "none"
      });
      itemsDrawn.push({ x: cx - r, y: cy - r, w: diam, h: diam });
      y += diam + gap;
    }

    // 2: pill
    if (list[1]) {
      const h = boxH * (list[1].heightRatio || 1);
      addPath(
        svg,
        rr(x, y, boxW, h, use.RADIUS_PILL),
        "url(#gradFlow)",
        use.STROKE_PX
      );
      addFO(svg, x, y, boxW, h, list[1].label, {
        font: `${use.FONT_WEIGHT_BOX} ${use.FONT_PT_BOX}pt ${use.FONT_FAMILY_BOX}`,
        letterSpacing: `${use.FONT_LETTER_SPACING}px`,
        lineHeight: `${use.LINE_HEIGHT_EM}em`,
        padding: `${use.PADDING_Y}px ${use.PADDING_X}px`,
        textTransform: use.UPPERCASE ? "uppercase" : "none"
      });
      itemsDrawn.push({ x, y, w: boxW, h });
      y += h + gap;
    }

    // 3: rect
    if (list[2]) {
      const h = boxH * (list[2].heightRatio || 1);
      addPath(
        svg,
        rr(x, y, boxW, h, use.RADIUS_RECT),
        "url(#gradFlow)",
        use.STROKE_PX
      );
      addFO(svg, x, y, boxW, h, list[2].label, {
        font: `${use.FONT_WEIGHT_BOX} ${use.FONT_PT_BOX}pt ${use.FONT_FAMILY_BOX}`,
        letterSpacing: `${use.FONT_LETTER_SPACING}px`,
        lineHeight: `${use.LINE_HEIGHT_EM}em`,
        padding: `${use.PADDING_Y}px ${use.PADDING_X}px`,
        textTransform: use.UPPERCASE ? "uppercase" : "none"
      });
      itemsDrawn.push({ x, y, w: boxW, h });
      y += h + gap;
    }

    // 4: oval
    if (list[3]) {
      const h = boxH * (list[3].heightRatio || 1);
      addPath(
        svg,
        rr(x, y, boxW, h, use.RADIUS_OVAL),
        "url(#gradFlow)",
        use.STROKE_PX
      );
      addFO(svg, x, y, boxW, h, list[3].label, {
        font: `${use.FONT_WEIGHT_BOX} ${use.FONT_PT_BOX}pt ${use.FONT_FAMILY_BOX}`,
        letterSpacing: `${use.FONT_LETTER_SPACING}px`,
        lineHeight: `${use.LINE_HEIGHT_EM}em`,
        padding: `${use.PADDING_Y}px ${use.PADDING_X}px`,
        textTransform: use.UPPERCASE ? "uppercase" : "none"
      });
      itemsDrawn.push({ x, y, w: boxW, h });
      y += h + use.DOTS_Y_OFFSET;
    }

    // dots
    if (use.DOTS_COUNT > 0) {
      const centerX = x + boxW / 2;
      let dotY = y;
      for (let i = 0; i < use.DOTS_COUNT; i++) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", centerX);
        c.setAttribute("cy", dotY);
        c.setAttribute("r", use.DOTS_SIZE_PX);
        c.setAttribute("fill", cfg.COLOR_CYAN);
        c.setAttribute("class", "glow");
        svg.appendChild(c);
        dotY += use.DOTS_GAP_PX;
      }
    }

    // Title above the stack
    if (use.TITLE_SHOW && itemsDrawn.length) {
      const t = document.createElementNS(NS, "text");
      const topBox = itemsDrawn[0];
      t.setAttribute(
        "x",
        topBox.x + topBox.w / 2 + use.TITLE_OFFSET_X
      );
      t.setAttribute("y", topBox.y + use.TITLE_OFFSET_Y);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "#ddeaef");
      t.setAttribute("font-family", use.TITLE_FAMILY);
      t.setAttribute("font-weight", use.TITLE_WEIGHT);
      t.setAttribute("font-size", `${use.TITLE_PT}pt`);
      t.textContent = use.TITLE_TEXT;
      t.style.letterSpacing = `${use.TITLE_LETTER_SPACING}px`;
      svg.appendChild(t);
    }

    // Horizontal rails
    if (itemsDrawn.length) {
      const first = itemsDrawn[0];
      const attachY = first.y + first.h * (0.5 + use.H_LINE_Y_BIAS);

      if (use.SHOW_LEFT_LINE) {
        const xs = W * Math.max(0, Math.min(1, use.LEFT_STOP_RATIO));
        const xe = first.x - use.CONNECT_X_PAD;
        if (xe > xs) {
          const stroke = makeSegmentGradient(svg, xs, attachY, xe);
          addPath(
            svg,
            `M ${xs} ${attachY} H ${xe}`,
            stroke,
            use.LINE_STROKE_PX
          );
        }
      }

      if (use.SHOW_RIGHT_LINE) {
        const xs = first.x + first.w + use.CONNECT_X_PAD;
        const xe = W - use.RIGHT_MARGIN_PX;
        if (xe > xs) {
          const stroke = makeSegmentGradient(svg, xs, attachY, xe);
          addPath(
            svg,
            `M ${xs} ${attachY} H ${xe}`,
            stroke,
            use.LINE_STROKE_PX
          );
        }
      }
    }

    // Vertical connectors
    for (let i = 0; i < itemsDrawn.length - 1; i++) {
      const a  = itemsDrawn[i];
      const b2 = itemsDrawn[i + 1];
      const xMid = a.x + a.w / 2;
      const y1   = a.y + a.h;
      const y2   = b2.y;
      const pad  = Math.max(2, use.STROKE_PX);
      addPath(
        svg,
        `M ${xMid} ${y1 + pad} V ${y2 - pad}`,
        "url(#gradTrailFlow)",
        use.LINE_STROKE_PX
      );
    }

    // Left copy (desktop + tablet share same HTML; layout / type from `use`)
    const left = b.left + W * use.COPY_LEFT_RATIO + use.COPY_NUDGE_X;
    const top  = b.top  + H * use.COPY_TOP_RATIO + use.COPY_NUDGE_Y;
    if (typeof ctx.mountCopy === "function") {
      const el = ctx.mountCopy({ top, left, html: cfg.COPY_SEO_HTML });
      el.style.maxWidth   = `${use.COPY_MAX_W_PX}px`;
      el.style.fontFamily = use.COPY_FAMILY;
      const h3 = el.querySelector("h3");
      if (h3) {
        h3.style.font =
          `${use.COPY_H_WEIGHT} ${use.COPY_H_PT}pt ${use.COPY_FAMILY}`;
      }
      const p = el.querySelector("p");
      if (p) {
        p.style.cssText =
          `font:${use.COPY_BODY_WEIGHT} ${use.COPY_BODY_PT}pt ${use.COPY_FAMILY}; ` +
          `line-height:${use.COPY_LINE_HEIGHT}`;
      }
    }
  };
})();