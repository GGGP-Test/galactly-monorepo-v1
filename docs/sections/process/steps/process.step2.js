// sections/process/steps/process.step2.js
(() => {
  const STEP = 2;
  const NS = "http://www.w3.org/2000/svg";

  // ---------------- CONFIG: DESKTOP (unchanged semantics) ----------------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step2 = root.step2 || {};
    const cfg = root.step2;

    const dflt = {
      // ===== DESKTOP knobs (same SVG layout system as Step 1) =====
      BOX_W_RATIO: 0.10,
      BOX_H_RATIO: 0.12,
      GAP_RATIO: 0.035,
      STACK_X_RATIO: 0.705,
      STACK_TOP_RATIO: 0.21,
      NUDGE_X: -230,
      NUDGE_Y: -20,
      RADIUS_RECT: 18,
      RADIUS_PILL: 18,
      RADIUS_OVAL: 999,
      CIRCLE_DESKTOP_DIAM_RATIO: 0.10,
      SHOW_LEFT_LINE: true,
      SHOW_RIGHT_LINE: true,
      LEFT_STOP_RATIO: 0.35,
      RIGHT_MARGIN_PX: 16,
      H_LINE_Y_BIAS: -0.06,
      CONNECT_X_PAD: 8,
      LINE_STROKE_PX: 2.5,

      FONT_PT_OVAL: 8,
      FONT_PT_PILL: 8,
      FONT_PT_RECT: 8,
      FONT_PT_CIRCLE: 8,
      FONT_WEIGHT_BOX: 525,
      FONT_FAMILY_BOX:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      FONT_LETTER_SPACING: 0.3,
      LINE_HEIGHT_EM: 1.15,
      PADDING_X: 4,
      PADDING_Y: 4,
      UPPERCASE: false,

      // Labels (Step 2 content)
      LABEL_OVAL_1: "Deadline Window (T-48h \u2192 T-30d)",
      LABEL_PILL_2: "Trigger Events (Launch/Expo/Recall)",
      LABEL_CIRCLE_3: "Back-to-Back Search (last 72h)",
      LABEL_RECT_4: "Ops Clock (PO due, stockouts)",

      // Title (desktop)
      TITLE_SHOW: true,
      TITLE_TEXT: "Right-Time Score",
      TITLE_PT: 14,
      TITLE_WEIGHT: 700,
      TITLE_FAMILY:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_OFFSET_X: 0,
      TITLE_OFFSET_Y: -28,
      TITLE_LETTER_SPACING: 0.2,

      // Copy block (desktop)
      COPY_LEFT_RATIO: 0.035,
      COPY_TOP_RATIO: 0.18,
      COPY_NUDGE_X: -20,
      COPY_NUDGE_Y: 0,
      COPY_MAX_W_PX: 330,
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
      COLOR_CYAN: "rgba(99,211,255,0.95)",
      COLOR_GOLD: "rgba(242,220,160,0.92)",
      REDUCE_MOTION: false,

      // Dots (desktop SVG)
      DOTS_COUNT: 3,
      DOTS_SIZE_PX: 2.2,
      DOTS_GAP_PX: 26,
      DOTS_Y_OFFSET: 26,

      // ===== TABLET TUNING (applies between mobile BP and TABLET_BP) =====
      TABLET_BP: 1024,          // up to this width = treat as tablet
      TABLET_SCALE: 0.86,       // scale SVG + copy down a bit
      TABLET_COPY_MAX_W_PX: 300 // slightly narrower copy on tablet
    };

    for (const k in dflt) if (!(k in cfg)) cfg[k] = dflt[k];
    return cfg;
  }

  // ---------------- CONFIG: MOBILE STEP 2 (same as before) ----------------
  function M() {
    const root   = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    const mobile = (root.mobile = root.mobile || {});

    // Only create defaults if the user hasn't defined mobile.step2 in process.js
    if (!mobile.step2) {
      mobile.step2 = {
        useTheme: true,

        // whole-section placement
        top: 50,
        bottom: 80,
        maxW: 520,
        sidePad: 20,
        nudgeX: 0,
        nudgeY: 0,

        // small title: "Right-Time Score"
        titleShow: true,
        titlePt: 11,
        titleWeight: 700,
        titleLetter: 0.2,
        titleAlign: "center",
        titleMarginTop: 10,      // gap from copy → step title
        titleMarginBottom: 12,   // gap from step title → boxes
        titleNudgeX: 42,
        titleNudgeY: 10,

        // h3 + body: "Who needs packaging right now?"
        copyHpt: 22,
        copyBodyPt: 14,
        copyLine: 1.6,
        copyColor: "#a7bacb",
        copyHColor: "#eaf0f6",
        copyGapBottom: 14,       // gap from copy → step title
        copyHGap: 8,             // gap between h3 and paragraph
        copyHTML: null,          // optional custom HTML override

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
          nudgeX: 42,   // positive = push boxes to the right
          nudgeY: 10    // positive = push boxes down
        },

        // "Circle" sizing knob for Back-to-Back Search
        circlePct: 27,

        // three dots under the stack
        dots: {
          show: false,
          count: 3,
          size: 6,
          gap: 8,
          padTop: 4
        },

        // per-shape overrides (all REAL keys)
        overrides: {
          oval1:   { },            // Deadline Window
          pill2:   { },            // Trigger Events
          circle3: { },            // Back-to-Back Search
          rect4:   { }             // Ops Clock
        },

        // draw order top → bottom
        order: ["oval1", "pill2", "circle3", "rect4"]
      };
    }

    return mobile.step2;
  }

  const reduceMotion = () =>
    (window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    C().REDUCE_MOTION;

  // ---------------- DESKTOP SVG helpers (unchanged visuals) ----------------
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
      ["45%", "rgba(99,211,255,.90)"],
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
            H ${x + R}   Q ${x}   ${y + h} ${x}   ${y + h - R}
            V ${y + R}   Q ${x}   ${y}   ${x + R} ${y} Z`;
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

  // ---------------- MOBILE DOM LAYOUT (Step 2, uses same theme as step1) ----------------
  function applyBoxStyles2(node, base, ov) {
    const b = Object.assign({}, base || {}, ov || {});
    node.style.width       = (b.widthPct != null ? `${b.widthPct}%` : "100%");
    node.style.minHeight   = `${b.minH ?? 56}px`;
    node.style.padding     = `${b.padY ?? 10}px ${b.padX ?? 12}px`;
    node.style.borderWidth = `${b.border ?? 2}px`;
    node.style.borderStyle = "solid";
    node.style.borderColor = "rgba(99,211,255,.95)";
    node.style.borderRadius= `${b.radius ?? 14}px`;
    node.style.font        =
      `${b.fontWeight ?? 525} ${b.fontPt ?? 11}pt ` +
      'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    node.style.letterSpacing = `${b.letter ?? 0.3}px`;
    node.style.lineHeight    = `${b.lineEm ?? 1.15}em`;
    node.style.textAlign     = b.align || "center";

    const nx = b.nudgeX || 0;
    const ny = b.nudgeY || 0;
    if (nx || ny) {
      node.style.transform = `translate(${nx}px, ${ny}px)`;
    }
  }

  function drawMobile(ctx) {
    const cfg = C();
    const m   = M();

    // canvas is already set up for mobile in process.js
    const wrap = document.createElement("div");
    wrap.className = "mstep mstep2";
    wrap.style.marginTop    = `${m.top ?? 50}px`;
    wrap.style.marginBottom = `${m.bottom ?? 80}px`;
    wrap.style.maxWidth     = `${m.maxW ?? 520}px`;
    wrap.style.padding      = `0 ${m.sidePad ?? 20}px`;
    wrap.style.transform    = `translate(${m.nudgeX ?? 0}px, ${m.nudgeY ?? 0}px)`;

    // 1) COPY BLOCK FIRST: "Who needs packaging right now?" + body
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
          Who needs packaging right now?
        </h3>
        <p style="margin:0; color:${m.copyColor ?? "#a7bacb"};
                  font:400 ${(m.copyBodyPt ?? 14)}px/${(m.copyLine ?? 1.55)} Inter, system-ui;">
          Our <b>Right-Time Score</b> finds buyers in an active window to purchase &mdash; not just &ldquo;interested.&rdquo;
          We blend deadlines and events, last-72-hour Back-to-Back Search, operations clocks like PO due dates and stockouts, and more,
          then surface accounts where timing &mdash; not just loyalty &mdash; says &ldquo;go now.&rdquo;
        </p>
      `;
    }
    wrap.appendChild(copy);

    // 2) STEP TITLE AFTER COPY: "Right-Time Score" above the boxes
    if (m.titleShow !== false) {
      const t = document.createElement("div");
      t.className = "mstep-title";
      // First word wrapped so it can reuse the gold mobile class
      t.innerHTML = '<span class="mstep-title-intent">Right-Time</span> Score';
      t.style.textAlign     = m.titleAlign || "center";
      t.style.fontWeight    = String(m.titleWeight ?? 700);
      t.style.fontSize      = `${m.titlePt ?? 11}pt`;
      t.style.letterSpacing = `${m.titleLetter ?? 0.2}px`;
      t.style.marginTop     = `${m.titleMarginTop ?? 10}px`;
      t.style.marginBottom  = `${m.titleMarginBottom ?? 12}px`;
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
      oval1:   cfg.LABEL_OVAL_1,
      pill2:   cfg.LABEL_PILL_2,
      circle3: cfg.LABEL_CIRCLE_3,
      rect4:   cfg.LABEL_RECT_4
    };

    const order   = Array.isArray(m.order) ? m.order : ["oval1", "pill2", "circle3", "rect4"];
    const baseBox = m.box || {};
    const OVR     = m.overrides || {};

    for (const key of order) {
      const label = labels[key];
      if (!label) continue;

      if (key === "circle3") {
        // circular pill
        const circle = document.createElement("div");
        circle.className = "mbox circle";
        circle.textContent = label;

        const ov = Object.assign(
          {
            widthPct: m.circlePct ?? 27,
            radius: 9999
          },
          OVR.circle3 || {}
        );

        applyBoxStyles2(circle, baseBox, ov);
        circle.style.aspectRatio = "1 / 1";
        stack.appendChild(circle);
      } else {
        // rectangular / pill boxes
        const box = document.createElement("div");
        const isPill = key === "oval1" || key === "pill2";
        box.className = "mbox" + (isPill ? " oval" : "");
        box.textContent = label;

        const extra = isPill ? { radius: 9999 } : {};
        const ov = Object.assign({}, extra, OVR[key] || {});
        applyBoxStyles2(box, baseBox, ov);
        stack.appendChild(box);
      }
    }

    // 4) Dots row under stack
    const dots = m.dots || {};
    if (dots.show !== false) {
      const row = document.createElement("div");
      row.className = "mdots";
      row.style.gap       = `${dots.gap ?? 8}px`;
      row.style.paddingTop= `${dots.padTop ?? 4}px`;
      const n = Math.max(0, dots.count ?? 3);
      for (let i = 0; i < n; i++) {
        const dot = document.createElement("i");
        const size = `${dots.size ?? 6}px`;
        dot.style.width  = size;
        dot.style.height = size;
        row.appendChild(dot);
      }
      stack.appendChild(row);
    }

    wrap.appendChild(stack);
    ctx.canvas.appendChild(wrap);
  }

  // ---------------- DESKTOP/TABLET DRAW (Step 2) ----------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    const b   = ctx.bounds;
    const cfg = C();

    const mobileBP =
      (window.PROCESS_CONFIG &&
        window.PROCESS_CONFIG.mobile &&
        window.PROCESS_CONFIG.mobile.BP) ||
      cfg.MOBILE_BREAKPOINT ||
      640;

    const viewportW =
      typeof window !== "undefined"
        ? (window.innerWidth || b.sW || mobileBP)
        : b.sW;

    const isPhone =
      window.PROCESS_FORCE_MOBILE === true ||
      viewportW <= mobileBP;

    if (isPhone) {
      // phones: keep using DOM/mobile path
      drawMobile(ctx);
      return;
    }

    const tabletBP = cfg.TABLET_BP || 1024;
    const isTablet = viewportW <= tabletBP;

    // DESKTOP-style layout (shared by desktop + tablet)
    const W = b.width;
    const H = Math.min(560, b.sH - 40);
    const svg = document.createElementNS(NS, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top + "px";
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // Tablet: scale the whole SVG down a bit so it fits like desktop but smaller
    if (isTablet) {
      const s = cfg.TABLET_SCALE || 0.9;
      svg.style.transformOrigin = "50% 50%";
      svg.style.transform = `scale(${s})`;
    }

    ctx.canvas.appendChild(svg);

    makeFlowGradients(svg, { spanX: W * 0.15, y: 0 });

    const boxW = W * cfg.BOX_W_RATIO;
    const boxH = H * cfg.BOX_H_RATIO;
    const gap  = H * cfg.GAP_RATIO;
    let x = W * cfg.STACK_X_RATIO + cfg.NUDGE_X;
    let y = H * cfg.STACK_TOP_RATIO + cfg.NUDGE_Y;
    const items = [];

    // 1) OVAL: Deadline Window (T-48h → T-30d)
    {
      const d = rr(x, y, boxW, boxH, 999);
      addPath(svg, d, "url(#gradFlow)", cfg.STROKE_PX);
      addFO(
        svg,
        x,
        y,
        boxW,
        boxH,
        cfg.LABEL_OVAL_1,
        {
          font: `${cfg.FONT_WEIGHT_BOX} ${cfg.FONT_PT_OVAL}pt ${cfg.FONT_FAMILY_BOX}`,
          letterSpacing: `${cfg.FONT_LETTER_SPACING}px`,
          lineHeight: `${cfg.LINE_HEIGHT_EM}em`,
          textTransform: cfg.UPPERCASE ? "uppercase" : "none",
          padding: `${cfg.PADDING_Y}px ${cfg.PADDING_X}px`
        }
      );
      items.push({ x, y, w: boxW, h: boxH });
      y += boxH + gap;
    }

    // 2) PILL: Trigger Events (Launch/Expo/Recall)
    {
      const d = rr(x, y, boxW, boxH, cfg.RADIUS_PILL);
      addPath(svg, d, "url(#gradFlow)", cfg.STROKE_PX);
      addFO(
        svg,
        x,
        y,
        boxW,
        boxH,
        cfg.LABEL_PILL_2,
        {
          font: `${cfg.FONT_WEIGHT_BOX} ${cfg.FONT_PT_PILL}pt ${cfg.FONT_FAMILY_BOX}`,
          letterSpacing: `${cfg.FONT_LETTER_SPACING}px`,
          lineHeight: `${cfg.LINE_HEIGHT_EM}em`,
          textTransform: cfg.UPPERCASE ? "uppercase" : "none",
          padding: `${cfg.PADDING_Y}px ${cfg.PADDING_X}px`
        }
      );
      items.push({ x, y, w: boxW, h: boxH });
      y += boxH + gap;
    }

    // 3) CIRCLE: Back-to-Back Search (last 72h)
    {
      const diam = cfg.CIRCLE_DESKTOP_DIAM_RATIO * W;
      const r    = diam / 2;
      const cx   = x + boxW / 2;
      const cy   = y + r;

      addCircle(svg, cx, cy, r, "url(#gradFlow)", cfg.STROKE_PX);
      addFO(
        svg,
        cx - r,
        cy - r,
        diam,
        diam,
        cfg.LABEL_CIRCLE_3,
        {
          font: `${cfg.FONT_WEIGHT_BOX} ${cfg.FONT_PT_CIRCLE}pt ${cfg.FONT_FAMILY_BOX}`,
          letterSpacing: `${cfg.FONT_LETTER_SPACING}px`,
          lineHeight: `${cfg.LINE_HEIGHT_EM}em`,
          textTransform: cfg.UPPERCASE ? "uppercase" : "none",
          padding: "3px 4px"
        }
      );
      items.push({ x: cx - r, y: cy - r, w: diam, h: diam });
      y += diam + gap;
    }

    // 4) RECT: Ops Clock (PO due, stockouts)
    {
      const d = rr(x, y, boxW, boxH, cfg.RADIUS_RECT);
      addPath(svg, d, "url(#gradFlow)", cfg.STROKE_PX);
      addFO(
        svg,
        x,
        y,
        boxW,
        boxH,
        cfg.LABEL_RECT_4,
        {
          font: `${cfg.FONT_WEIGHT_BOX} ${cfg.FONT_PT_RECT}pt ${cfg.FONT_FAMILY_BOX}`,
          letterSpacing: `${cfg.FONT_LETTER_SPACING}px`,
          lineHeight: `${cfg.LINE_HEIGHT_EM}em`,
          textTransform: cfg.UPPERCASE ? "uppercase" : "none",
          padding: `${cfg.PADDING_Y}px ${cfg.PADDING_X}px`
        }
      );
      items.push({ x, y, w: boxW, h: boxH });
      y += boxH + cfg.DOTS_Y_OFFSET;
    }

    // dots
    if (cfg.DOTS_COUNT > 0) {
      const centerX = x + boxW / 2;
      let dotY = y;
      for (let i = 0; i < cfg.DOTS_COUNT; i++) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", centerX);
        c.setAttribute("cy", dotY);
        c.setAttribute("r", cfg.DOTS_SIZE_PX);
        c.setAttribute("fill", cfg.COLOR_CYAN);
        c.setAttribute("class", "glow");
        svg.appendChild(c);
        dotY += cfg.DOTS_GAP_PX;
      }
    }

    // title
    if (cfg.TITLE_SHOW && items.length) {
      const t = document.createElementNS(NS, "text");
      const topBox = items[0];
      t.setAttribute("x", topBox.x + topBox.w / 2 + cfg.TITLE_OFFSET_X);
      t.setAttribute("y", topBox.y + cfg.TITLE_OFFSET_Y);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "#ddeaef");
      t.setAttribute("font-family", cfg.TITLE_FAMILY);
      t.setAttribute("font-weight", cfg.TITLE_WEIGHT);
      t.setAttribute("font-size", `${cfg.TITLE_PT}pt`);
      t.textContent = cfg.TITLE_TEXT;
      t.style.letterSpacing = `${cfg.TITLE_LETTER_SPACING}px`;
      svg.appendChild(t);
    }

    // rails
    if (items.length) {
      const first   = items[0];
      const attachY = first.y + first.h * (0.5 + cfg.H_LINE_Y_BIAS);

      if (cfg.SHOW_LEFT_LINE) {
        const xs = W * Math.max(0, Math.min(1, cfg.LEFT_STOP_RATIO));
        const xe = first.x - cfg.CONNECT_X_PAD;
        if (xe > xs) {
          const stroke = makeSegmentGradient(svg, xs, attachY, xe);
          addPath(svg, `M ${xs} ${attachY} H ${xe}`, stroke, cfg.LINE_STROKE_PX);
        }
      }

      if (cfg.SHOW_RIGHT_LINE) {
        const xs = first.x + first.w + cfg.CONNECT_X_PAD;
        const xe = W - cfg.RIGHT_MARGIN_PX;
        if (xe > xs) {
          const stroke = makeSegmentGradient(svg, xs, attachY, xe);
          addPath(svg, `M ${xs} ${attachY} H ${xe}`, stroke, cfg.LINE_STROKE_PX);
        }
      }
    }

    // vertical connectors
    for (let i = 0; i < items.length - 1; i++) {
      const a  = items[i];
      const b2 = items[i + 1];
      const xMid = a.x + a.w / 2;
      const y1   = a.y + a.h;
      const y2   = b2.y;
      const pad  = Math.max(2, cfg.STROKE_PX);
      addPath(
        svg,
        `M ${xMid} ${y1 + pad} V ${y2 - pad}`,
        "url(#gradTrailFlow)",
        cfg.LINE_STROKE_PX
      );
    }

    // Copy block (desktop / tablet)
    const left = b.left + W * cfg.COPY_LEFT_RATIO + cfg.COPY_NUDGE_X;
    const top  = b.top + H * cfg.COPY_TOP_RATIO + cfg.COPY_NUDGE_Y;
    const html = `
      <h3>Who needs packaging right now?</h3>
      <p>Our <b>Right-Time Score</b> finds buyers in an active window to purchase &mdash; not just &ldquo;interested.&rdquo;
      We blend deadlines and events, last-72-hour Back-to-Back Search, operations clocks like PO due dates and stockouts, and more,
      then surface accounts where timing &mdash; not just loyalty &mdash; says &ldquo;go now.&rdquo;</p>
    `;
    if (typeof ctx.mountCopy === "function") {
      const el = ctx.mountCopy({ top, left, html });
      const maxW = isTablet
        ? (cfg.TABLET_COPY_MAX_W_PX || cfg.COPY_MAX_W_PX)
        : cfg.COPY_MAX_W_PX;
      el.style.maxWidth   = `${maxW}px`;
      el.style.fontFamily = cfg.COPY_FAMILY;
      const h3 = el.querySelector("h3");
      if (h3) {
        h3.style.font = `${cfg.COPY_H_WEIGHT} ${cfg.COPY_H_PT}pt ${cfg.COPY_FAMILY}`;
      }
      const p = el.querySelector("p");
      if (p) {
        p.style.cssText =
          `font:${cfg.COPY_BODY_WEIGHT} ${cfg.COPY_BODY_PT}pt ${cfg.COPY_FAMILY}; ` +
          `line-height:${cfg.COPY_LINE_HEIGHT}`;
      }

      // Tablet: scale the copy block down a bit to match the shrunken SVG
      if (isTablet) {
        const s = cfg.TABLET_SCALE || 0.9;
        el.style.transformOrigin = "top left";
        el.style.transform = `scale(${s})`;
      }
    }
  };
})();