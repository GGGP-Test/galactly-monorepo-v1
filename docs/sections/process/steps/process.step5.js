// sections/process/steps/process.step5.js
(() => {
  const STEP = 5;
  const NS = "http://www.w3.org/2000/svg";

  // ---------------- CONFIG / KNOBS ----------------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step5 = root.step5 || {};

    const dflt = {
      // ---- placement in right rail (DESKTOP)
      STACK_X_RATIO: 0.555,
      STACK_TOP_RATIO: 0.18,
      WIDTH_RATIO: 0.54,
      T_WIDTH_RATIO: 0.6,
      HEIGHT_MAX_PX: 560,
      NUDGE_X: -230,
      NUDGE_Y: -12,

      // ---- columns/boxes geometry (DESKTOP defaults)
      COL_GAP_RATIO: 0.08,
      COL_W_RATIO: 0.13,
      ITEM_H_RATIO: 0.10,
      ITEM_GAP_RATIO: 0.02,
      RADIUS_RECT: 14,
      RADIUS_PILL: 22,
      RADIUS_OVAL: 999,

      // ---- strokes (DESKTOP defaults)
      SHAPE_COLOR: "#63d3ff",
      SHAPE_WIDTH: 2.2,
      LINE_COLOR: "rgba(242,220,160,0.95)",
      LINE_WIDTH: 1.15,
      CONNECT_GAP: 3,

      // ---- optional per-step overrides (DESKTOP)
      COL_W_MULTS: { step0: 1, step1: 1, step2: 1, step3: 1, step4: 1 },
      COL_Y_OFFSETS: { step0: 100, step1: 0, step2: 0, step3: 0, step4: 0 },
      COL_X_OFFSETS: { step0: 0, step1: 0, step2: 0, step3: 0, step4: 0 },
      ITEM_Y_OFFSETS: { step0: [], step1: [], step2: [], step3: [], step4: [] },
      ITEM_H_MULTS: { step0: [], step1: [], step2: [], step3: [], step4: [] },
      SHAPE_COLOR_BY_STEP: {},
      SHAPE_WIDTH_BY_STEP: {},
      LINE_STYLE_BY_PAIR: {},

      // ---- dim/blur control for the LAST box (DESKTOP)
      LAST_DIM: {
        step0: { opacity: 1, blur: 0 },
        step1: { opacity: 0.95, blur: 1.0 },
        step2: { opacity: 0.95, blur: 1.0 },
        step3: { opacity: 0.95, blur: 1.0 },
        step4: { opacity: 0.95, blur: 1.0 }
      },

      // ---- dots
      DOT_SIZE: 2.4,
      DOT_GAP: 22,
      DOT_COLOR: "rgba(242,220,160,0.95)",
      DOTS_TOP_PAD: 45,

      // ---- headings (titles over each column)
      HEADINGS_SHOW: true,
      HEADINGS: [
        "Yourcompany.com",
        "Intent Score",
        "Time Score",
        "Weight Score",
        "Platform Score"
      ],
      HEAD_PT: 7.8, // desktop
      M_HEAD_PT: 4.5, // phone
      HEAD_WEIGHT: 850,
      HEAD_COLOR: "#ddeaef",
      HEAD_LETTER_SPACING: 0.2,
      HEAD_ALIGN: "center",
      HEAD_BOX_H: 26,
      HEAD_SPACING: 8,
      HEAD_OFFSET_Y: 0,
      HEAD_ONE_LINE: true,
      HEAD_MAX_WIDTH_PCT: 1.95,
      HEAD_BASELINE_BIAS: 0.74,

      // ---- step title (desktop + phone only – NOT used on tablet)
      TITLE_SHOW: true,
      TITLE_TEXT: "AIO - Decides how much each variable matter",
      TITLE_PT: 14,
      TITLE_WEIGHT: 850,
      TITLE_COLOR: "#ddeaef",
      TITLE_FAMILY:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_LETTER_SPACING: 0.2,
      TITLE_OFFSET_X: 0,
      TITLE_OFFSET_Y: -28,

      // ---- left SEO copy (desktop)
      COPY_LEFT_RATIO: 0.035,
      COPY_TOP_RATIO: 0.16,
      COPY_NUDGE_X: -20,
      COPY_NUDGE_Y: 0,
      COPY_MAX_W_PX: 320,
      COPY_H_PT: 20,
      COPY_H_WEIGHT: 600,
      COPY_BODY_PT: 11,
      COPY_BODY_WEIGHT: 400,
      COPY_COLOR_HEAD: "#eaf0f6",
      COPY_COLOR_BODY: "#a7bacb",
      COPY_FAMILY:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_LINE_HEIGHT: 1.6,

      // ================= PHONE OVERRIDES (existing mobile) =================
      MOBILE_BREAKPOINT: (window.PROCESS_CONFIG?.mobile?.BP ?? 640),
      M_MAX_W: 820,
      M_SIDE_PAD: 16,
      M_SECTION_TOP: 40,
      M_SECTION_BOTTOM: 4,
      M_TITLE_PT: 12,
      M_COPY_H_PT: 22,
      M_COPY_BODY_PT: 14,
      M_SCALE: 0.9,

      M_COL_GAP_RATIO: 0.09,
      M_COL_W_RATIO: null,
      M_ITEM_H_RATIO: 0.05,
      M_ITEM_GAP_RATIO: 0.01,
      M_RADIUS_RECT: null,
      M_RADIUS_PILL: null,
      M_RADIUS_OVAL: null,

      M_SHAPE_COLOR: null,
      M_SHAPE_WIDTH: null,
      M_LINE_COLOR: null,
      M_LINE_WIDTH: 0.7,
      M_CONNECT_GAP: null,

      M_COL_W_MULTS: null,
      M_COL_Y_OFFSETS: { step0: 70, step1: 0, step2: 0, step3: 0, step4: 0 },
      M_COL_X_OFFSETS: null,
      M_ITEM_Y_OFFSETS: null,
      M_ITEM_H_MULTS: null,
      M_SHAPE_COLOR_BY_STEP: null,
      M_SHAPE_WIDTH_BY_STEP: null,
      M_LINE_STYLE_BY_PAIR: null,
      M_LAST_DIM: 0.85,

      M_HEAD_BOX_H: null,
      M_HEAD_SPACING: null,
      M_HEAD_OFFSET_Y: -40,
      M_HEAD_MAX_WIDTH_PCT: null,
      M_HEAD_BASELINE_BIAS: null,
      M_TITLE_OFFSET_X: null,
      M_TITLE_OFFSET_Y: 40,
      M_DOTS_TOP_PAD: 30,

      // ================= TABLET-ONLY (TEXT-ONLY) =================
      TABLET_BREAKPOINT: 1024,

      // lamp rail for tablet
      T_MAX_W: 820,
      T_SIDE_PAD: 24,
      T_SECTION_TOP: 40,   // gap under section-3 title
      T_SECTION_BOTTOM: 72,

      // tablet copy typography
      T_COPY_MAX_W: 640,
      T_COPY_H_PT: 22,
      T_COPY_BODY_PT: 14,

      // ---- columns recipes (desktop + phone network)
      COLS: [
        { key: "step0", items: ["pill"] },
        {
          key: "step1",
          items: ["rect", "rect", "pill", "circle", "diamond"],
          dots: 2
        },
        { key: "step2", items: ["pill", "pill", "circle", "rect"], dots: 3 },
        { key: "step3", items: ["circle", "pill", "pill", "rect"], dots: 3 },
        { key: "step4", items: ["diamond", "pill", "circle", "pill"], dots: 3 }
      ]
    };

    for (const k in dflt) if (!(k in root.step5)) root.step5[k] = dflt[k];
    return root.step5;
  }

  // ---------------- helpers ----------------
  const rr = (x, y, w, h, r) => {
    const R = Math.min(r, Math.min(w, h) / 2);
    return `M ${x + R} ${y} H ${x + w - R} Q ${x + w} ${y} ${x + w} ${y + R}
            V ${y + h - R} Q ${x + w} ${y + h} ${x + w - R} ${y + h}
            H ${x + R} Q ${x} ${y + h} ${x} ${y + h - R}
            V ${y + R} Q ${x} ${y} ${x + R} ${y} Z`;
  };

  const diamondPath = (cx, cy, w, h) =>
    `M ${cx} ${cy - h / 2} L ${cx + w / 2} ${cy} L ${cx} ${cy + h / 2} L ${
      cx - w / 2
    } ${cy} Z`;

  const addPath = (
    svg,
    d,
    stroke,
    sw,
    opacity = 1,
    filterId = null
  ) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", sw);
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", "round");
    p.style.opacity = opacity;
    if (filterId) p.setAttribute("filter", `url(#${filterId})`);
    svg.appendChild(p);
    return p;
  };

  const addCircle = (
    svg,
    cx,
    cy,
    r,
    stroke,
    sw,
    opacity = 1,
    filterId = null
  ) => {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx);
    c.setAttribute("cy", cy);
    c.setAttribute("r", r);
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", stroke);
    c.setAttribute("stroke-width", sw);
    c.style.opacity = opacity;
    if (filterId) c.setAttribute("filter", `url(#${filterId})`);
    svg.appendChild(c);
    return c;
  };

  // mode-aware overrides: mode = "desktop" | "phone"
  const pick = (mode, key) => {
    const cfg = C();
    if (mode === "phone") {
      const mKey = "M_" + key;
      if (mKey in cfg && cfg[mKey] != null) return cfg[mKey];
    }
    // tablet does NOT use network; falls back to desktop values if needed
    return cfg[key];
  };

  const pickMap = (mode, key) => {
    const v = pick(mode, key);
    return v || C()[key];
  };

  // SEO copy HTML (shared)
  function seoCopyHTML() {
    return (
      "<h3>Our Realtime AI Orchestrator</h3>" +
      "<p><b>It</b> Blends our Olympiad-grade math structure with multi-LLM reasoning to set live scores across <b>Intent Scoring</b>, <b>Timing</b>, <b>Loyalty</b>, <b>Platform Scoring</b>, and your <b>Sales AI</b> metrics. It also routes every company to <b>cool / warm / hot / hot+</b> B2B packaging buyer categories and a <b>right-now-platform score</b> so engagement has the highest chance of conversion.</p>"
    );
  }

  // ---------------- phone CSS (unchanged) ----------------
  function ensureMobileCSS() {
    const id = "p5m-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    const bp = C().MOBILE_BREAKPOINT;
    s.textContent = `
      @media (max-width:${bp}px){
        html,body,#section-process{overflow-x:hidden}
        #section-process .p5m-wrap{
          position:relative;
          margin:${C().M_SECTION_TOP}px auto ${C().M_SECTION_BOTTOM}px !important;
          max-width:${C().M_MAX_W}px;
          padding:0 ${C().M_SIDE_PAD}px 12px;
          z-index:0;
        }
        .p5m-title{
          text-align:center;
          color:${C().TITLE_COLOR};
          font:${C().TITLE_WEIGHT} ${C().M_TITLE_PT}pt ${C().TITLE_FAMILY};
          letter-spacing:${C().TITLE_LETTER_SPACING}px;
          margin:10px 0 8px;
        }
        .p5m-copy{
          margin:0 auto 8px;
          color:#a7bacb;
        }
        .p5m-copy h3{
          margin:0 0 6px;
          color:#eaf0f6;
          font:600 ${C().M_COPY_H_PT}px Newsreader, Georgia, serif;
        }
        .p5m-copy p{
          margin:0;
          font:400 ${C().M_COPY_BODY_PT}px/1.55 Inter, system-ui;
        }
        .p5m-svg{
          width:100%;
          height:auto;
          display:block;
        }
      }`;
    document.head.appendChild(s);
  }

  // ---------------- phone stacked layout (copy + TITLE + SVG) ----------------
  function drawStackedPhone(ctx, dims) {
    const cfg = C();
    ensureMobileCSS();

    ctx.canvas.style.position = "relative";
    ctx.canvas.style.inset = "auto";
    ctx.canvas.style.pointerEvents = "auto";

    const wrap = document.createElement("div");
    wrap.className = "p5m-wrap";

    // copy block
    const copy = document.createElement("div");
    copy.className = "p5m-copy";
    copy.innerHTML = seoCopyHTML();
    wrap.appendChild(copy);

    // step title (AIO) on mobile
    if (cfg.TITLE_SHOW) {
      const title = document.createElement("div");
      title.className = "p5m-title";
      title.textContent = cfg.TITLE_TEXT;

      const offX = pick("phone", "TITLE_OFFSET_X") || 0;
      const offY = pick("phone", "TITLE_OFFSET_Y") ?? 0;
      title.style.transform = `translate(${offX}px,${offY}px)`;

      wrap.appendChild(title);
    }

    // SVG container for existing mobile network
    const svg = document.createElementNS(NS, "svg");
    svg.classList.add("p5m-svg");
    svg.setAttribute("viewBox", `0 0 ${dims.W} ${dims.H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    wrap.appendChild(svg);

    ctx.canvas.appendChild(wrap);
    return svg;
  }

  // ---------------- TABLET: TEXT-ONLY LAYOUT ----------------
  function drawTabletTextOnly(ctx, dims) {
    const cfg = C();
    const bounds = ctx.bounds;

    // lamp rail width on tablet
    const fullW = bounds.width;
    const widthRatio =
      cfg.T_WIDTH_RATIO != null ? cfg.T_WIDTH_RATIO : cfg.WIDTH_RATIO;
    const railW = Math.min(cfg.T_MAX_W, Math.max(320, fullW * widthRatio));

    const wrap = document.createElement("div");
    wrap.className = "p5t-wrap";
    wrap.style.position = "relative";
    wrap.style.pointerEvents = "auto";
    wrap.style.margin = `${cfg.T_SECTION_TOP}px auto ${cfg.T_SECTION_BOTTOM}px`;
    wrap.style.maxWidth = `${railW}px`;
    wrap.style.padding = `0 ${cfg.T_SIDE_PAD}px`;

    const copy = document.createElement("div");
    copy.className = "p5t-copy";
    copy.innerHTML = seoCopyHTML();
    copy.style.margin = "0 auto";
    copy.style.maxWidth = `${cfg.T_COPY_MAX_W}px`;
    copy.style.color = cfg.COPY_COLOR_BODY || "#a7bacb";
    copy.style.textAlign = "left";

    const h3 = copy.querySelector("h3");
    if (h3) {
      h3.style.margin = "0 0 8px";
      h3.style.color = cfg.COPY_COLOR_HEAD || "#eaf0f6";
      h3.style.font =
        `${cfg.COPY_H_WEIGHT} ${cfg.T_COPY_H_PT}px Newsreader, Georgia, serif`;
    }
    copy.querySelectorAll("p").forEach((p) => {
      p.style.margin = "0";
      p.style.font =
        `${cfg.COPY_BODY_WEIGHT} ${cfg.T_COPY_BODY_PT}px/1.6 Inter, system-ui`;
    });

    wrap.appendChild(copy);
    ctx.canvas.appendChild(wrap);
  }

  // ---------------- main draw ----------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    const cfg = C();
    const bounds = ctx.bounds;

    const vw = window.innerWidth || bounds.sW || bounds.width;

    const isPhone =
      window.PROCESS_FORCE_MOBILE === true ||
      vw <= cfg.MOBILE_BREAKPOINT;

    const isTablet =
      !isPhone && vw <= (cfg.TABLET_BREAKPOINT || 1024);

    const layoutMode = isPhone ? "phone" : isTablet ? "tablet" : "desktop";

    const fullW = bounds.width;
    const H = Math.min(cfg.HEIGHT_MAX_PX, bounds.sH - 40);

    const widthRatio =
      layoutMode === "tablet" && cfg.T_WIDTH_RATIO != null
        ? cfg.T_WIDTH_RATIO
        : cfg.WIDTH_RATIO;

    const W =
      layoutMode === "phone"
        ? fullW
        : layoutMode === "tablet"
        ? Math.min(cfg.T_MAX_W, Math.max(300, fullW * widthRatio))
        : Math.max(300, fullW * widthRatio);

    // desktop uses right rail placement; stacked (phone/tablet) drawn from x0 = 0
    const x0 =
      layoutMode === "desktop"
        ? fullW * cfg.STACK_X_RATIO + cfg.NUDGE_X
        : 0;
    const y0 = H * cfg.STACK_TOP_RATIO + cfg.NUDGE_Y;

    let svg;

    if (layoutMode === "phone") {
      // existing phone layout: copy + AIO title + SVG network
      svg = drawStackedPhone(ctx, { W, H });
    } else if (layoutMode === "tablet") {
      // ✅ TABLET: TEXT ONLY (no SVG, no AIO title)
      drawTabletTextOnly(ctx, { W, H });
      return;
    } else {
      // desktop SVG network in right rail
      svg = document.createElementNS(NS, "svg");
      svg.style.position = "absolute";
      svg.style.left = bounds.left + "px";
      svg.style.top = bounds.top + "px";
      svg.setAttribute("width", bounds.width);
      svg.setAttribute("height", H);
      svg.setAttribute("viewBox", `0 0 ${bounds.width} ${H}`);
      ctx.canvas.appendChild(svg);
    }

    // --------- everything below here is for desktop + phone SVG network ---------

    // blur filter
    const defs = document.createElementNS(NS, "defs");
    const f = document.createElementNS(NS, "filter");
    f.setAttribute("id", "p5blur");
    const g = document.createElementNS(NS, "feGaussianBlur");
    g.setAttribute("stdDeviation", "1.5");
    f.appendChild(g);
    defs.appendChild(f);
    svg.appendChild(defs);

    const layoutModeForNetwork = layoutMode === "phone" ? "phone" : "desktop";

    // Section title (desktop only; phone uses HTML title)
    if (layoutModeForNetwork === "desktop" && cfg.TITLE_SHOW) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", x0 + W / 2 + cfg.TITLE_OFFSET_X);
      t.setAttribute("y", y0 + cfg.TITLE_OFFSET_Y);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", cfg.TITLE_COLOR);
      t.setAttribute("font-family", cfg.TITLE_FAMILY);
      t.setAttribute("font-weight", cfg.TITLE_WEIGHT);
      t.setAttribute("font-size", `${cfg.TITLE_PT}pt`);
      t.style.letterSpacing = `${cfg.TITLE_LETTER_SPACING}px`;
      t.textContent = cfg.TITLE_TEXT;
      svg.appendChild(t);
    }

    // Dimensions / knobs with mode-aware overrides + scale
    const scale =
      layoutModeForNetwork === "phone"
        ? cfg.M_SCALE != null ? cfg.M_SCALE : 1
        : 1;

    const colGap   = W * pick(layoutModeForNetwork, "COL_GAP_RATIO") * scale;
    const colWBase = W * pick(layoutModeForNetwork, "COL_W_RATIO") * scale;
    const baseH    = H * pick(layoutModeForNetwork, "ITEM_H_RATIO") * scale;
    const gap      = H * pick(layoutModeForNetwork, "ITEM_GAP_RATIO") * scale;

    const colWArray = cfg.COLS.map(
      (c) => colWBase * (pickMap(layoutModeForNetwork, "COL_W_MULTS")[c.key] || 1)
    );
    const innerW =
      colWArray.reduce((a, b) => a + b, 0) + (cfg.COLS.length - 1) * colGap;
    const left = x0 + (W - innerW) / 2;
    const top  = y0 + 8 * scale;

    const SHAPE_W     = pick(layoutModeForNetwork, "SHAPE_WIDTH") * scale;
    const SHAPE_COLOR = pick(layoutModeForNetwork, "SHAPE_COLOR");
    const LINE_W      = pick(layoutModeForNetwork, "LINE_WIDTH") * scale;
    const LINE_COLOR  = pick(layoutModeForNetwork, "LINE_COLOR");
    const CONNECT_GAP = pick(layoutModeForNetwork, "CONNECT_GAP") * scale;
    const R_RECT      = pick(layoutModeForNetwork, "RADIUS_RECT");
    const R_PILL      = pick(layoutModeForNetwork, "RADIUS_PILL");
    const R_OVAL      = pick(layoutModeForNetwork, "RADIUS_OVAL");

    const anchorsByCol = [];
    const headBoxes    = [];
    let xCursor = left;

    cfg.COLS.forEach((col, ci) => {
      const key  = col.key;
      const colX = xCursor + (pickMap(layoutModeForNetwork, "COL_X_OFFSETS")[key] || 0);
      const colW = colWArray[ci];
      const colY0= top + (pickMap(layoutModeForNetwork, "COL_Y_OFFSETS")[key] || 0);

      // headings over each stack
      const headW = colW * pick(layoutModeForNetwork, "HEAD_MAX_WIDTH_PCT");
      const headHBase = pick(layoutModeForNetwork, "HEAD_BOX_H") || cfg.HEAD_BOX_H;
      const headH = headHBase * scale;
      const headOffsetY =
        (pick(layoutModeForNetwork, "HEAD_OFFSET_Y") != null
          ? pick(layoutModeForNetwork, "HEAD_OFFSET_Y")
          : cfg.HEAD_OFFSET_Y) * scale;
      const headSpacing =
        (pick(layoutModeForNetwork, "HEAD_SPACING") != null
          ? pick(layoutModeForNetwork, "HEAD_SPACING")
          : cfg.HEAD_SPACING) * scale;

      const headX = colX + (colW - headW) / 2;
      const headY = Math.max(0, colY0 + headOffsetY);
      headBoxes.push({ x: headX, y: headY, w: headW, h: headH, idx: ci });

      // shapes
      let y = headY + headH + headSpacing;

      const leftAnch  = [];
      const rightAnch = [];
      const yOffsets  = pickMap(layoutModeForNetwork, "ITEM_Y_OFFSETS")[key] || [];
      const hMults    = pickMap(layoutModeForNetwork, "ITEM_H_MULTS")[key] || [];
      const perStepColor =
        pickMap(layoutModeForNetwork, "SHAPE_COLOR_BY_STEP")[key] || SHAPE_COLOR;
      const perStepWidth =
        pickMap(layoutModeForNetwork, "SHAPE_WIDTH_BY_STEP")[key] || SHAPE_W;

      col.items.forEach((type, i) => {
        const hm = hMults[i] != null ? hMults[i] : 1;
        const hShape =
          type === "circle" || type === "diamond"
            ? baseH * 0.9 * hm
            : baseH * hm;
        const yAdj = y + (yOffsets[i] || 0);

        let cx, cy, r, d;

        const isLast = i === col.items.length - 1;
        let dimConfig = pick(layoutModeForNetwork, "LAST_DIM");
        let dimSpec;

        if (typeof dimConfig === "number") {
          dimSpec = { opacity: dimConfig };
        } else {
          dimSpec = (dimConfig || cfg.LAST_DIM)[key] || {};
        }

        const opacity = isLast ? (dimSpec.opacity != null ? dimSpec.opacity : 1) : 1;
        const blurAmt = isLast ? (dimSpec.blur != null ? dimSpec.blur : 0) : 0;
        const filterId = blurAmt > 0 ? "p5blur" : null;
        if (filterId) {
          const blurNode = svg.querySelector("#p5blur feGaussianBlur");
          if (blurNode) blurNode.setAttribute("stdDeviation", String(blurAmt));
        }

        if (type === "rect") {
          d = rr(colX, yAdj, colW, hShape, R_RECT);
          addPath(svg, d, perStepColor, perStepWidth, opacity, filterId);
          cx = colX + colW / 2;
          cy = yAdj + hShape / 2;
        } else if (type === "pill") {
          d = rr(colX, yAdj, colW, hShape, R_PILL);
          addPath(svg, d, perStepColor, perStepWidth, opacity, filterId);
          cx = colX + colW / 2;
          cy = yAdj + hShape / 2;
        } else if (type === "oval") {
          d = rr(colX, yAdj, colW, hShape, R_OVAL);
          addPath(svg, d, perStepColor, perStepWidth, opacity, filterId);
          cx = colX + colW / 2;
          cy = yAdj + hShape / 2;
        } else if (type === "circle") {
          r  = Math.min(colW, hShape) / 2;
          cx = colX + colW / 2;
          cy = yAdj + hShape / 2;
          addCircle(svg, cx, cy, r, perStepColor, perStepWidth, opacity, filterId);
        } else if (type === "diamond") {
          cx = colX + colW / 2;
          cy = yAdj + hShape / 2;
          d  = diamondPath(cx, cy, colW * 0.9, hShape * 0.9);
          addPath(svg, d, perStepColor, perStepWidth, opacity, filterId);
        }

        let leftX, rightX;
        if (type === "circle") {
          leftX  = cx - r;
          rightX = cx + r;
        } else if (type === "diamond") {
          leftX  = cx - (colW * 0.9) / 2;
          rightX = cx + (colW * 0.9) / 2;
        } else {
          leftX  = colX;
          rightX = colX + colW;
        }
        leftAnch.push({ x: leftX - CONNECT_GAP, y: cy });
        rightAnch.push({ x: rightX + CONNECT_GAP, y: cy });

        y = yAdj + hShape + gap;
      });

      anchorsByCol.push({ key, left: leftAnch, right: rightAnch });
      xCursor += colW + colGap;

      // Dots under last item in this column
      if (col.dots > 0) {
        const lastRight = anchorsByCol[anchorsByCol.length - 1]?.right || [];
        const lastY = lastRight.length
          ? lastRight[lastRight.length - 1].y
          : 0;

        const padBase =
          pick(layoutModeForNetwork, "DOTS_TOP_PAD") != null
            ? pick(layoutModeForNetwork, "DOTS_TOP_PAD")
            : cfg.DOTS_TOP_PAD != null
            ? cfg.DOTS_TOP_PAD
            : 6;

        const pad    = padBase * scale;
        const dotsY  = lastY + pad;
        const dotGap = cfg.DOT_GAP * scale;
        const dotSize= cfg.DOT_SIZE * scale;

        for (let k = 0; k < col.dots; k++) {
          const dot = document.createElementNS(NS, "circle");
          dot.setAttribute("cx", colX + colW / 2);
          dot.setAttribute("cy", dotsY + k * dotGap);
          dot.setAttribute("r", dotSize);
          dot.setAttribute("fill", cfg.DOT_COLOR);
          svg.appendChild(dot);
        }
      }
    });

    // connections between columns
    const pairStyles =
      pick(layoutModeForNetwork, "LINE_STYLE_BY_PAIR") || cfg.LINE_STYLE_BY_PAIR || {};
    for (let i = 0; i < anchorsByCol.length - 1; i++) {
      const A = anchorsByCol[i];
      const B = anchorsByCol[i + 1];
      const pairKey = A.key + "->" + B.key;
      const style = pairStyles[pairKey] || {};
      const color = style.color || LINE_COLOR;
      const width = style.width != null ? style.width : LINE_W;

      for (const p of A.right) {
        for (const q of B.left) {
          addPath(svg, `M ${p.x} ${p.y} L ${q.x} ${q.y}`, color, width, 1, null);
        }
      }
    }

    // titles over columns
    if (C().HEADINGS_SHOW) {
      const cfgLocal = C();

      const drawHead = (svgNode, { text, x, y, w, h, idx }) => {
        const id = `p5h_clip_${idx}_${Math.random().toString(36).slice(2, 7)}`;
        let defsNode = svgNode.querySelector("defs");
        if (!defsNode) {
          defsNode = document.createElementNS(NS, "defs");
          svgNode.appendChild(defsNode);
        }

        const clip = document.createElementNS(NS, "clipPath");
        clip.setAttribute("id", id);
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", w);
        rect.setAttribute("height", h);
        clip.appendChild(rect);
        defsNode.appendChild(clip);

        const g = document.createElementNS(NS, "g");
        g.setAttribute("clip-path", `url(#${id})`);

        const t = document.createElementNS(NS, "text");
        const size =
          layoutModeForNetwork === "phone"
            ? cfgLocal.M_HEAD_PT
            : cfgLocal.HEAD_PT;

        const baselineBias = pick(layoutModeForNetwork, "HEAD_BASELINE_BIAS");
        t.setAttribute("x", x + w / 2);
        t.setAttribute("y", y + h * baselineBias);
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("fill", cfgLocal.HEAD_COLOR);
        t.setAttribute("font-family", cfgLocal.COPY_FAMILY);
        t.setAttribute("font-weight", cfgLocal.HEAD_WEIGHT);
        t.setAttribute("font-size", `${size}pt`);
        t.style.letterSpacing = `${cfgLocal.HEAD_LETTER_SPACING}px`;
        t.textContent = text || "";
        g.appendChild(t);
        svgNode.appendChild(g);
      };

      headBoxes.forEach(({ x, y, w, h, idx }) => {
        drawHead(svg, {
          text: C().HEADINGS[idx] || "",
          x,
          y,
          w,
          h,
          idx
        });
      });
    }

    // left SEO copy (desktop only)
    if (layoutModeForNetwork === "desktop" && typeof ctx.mountCopy === "function") {
      const l =
        bounds.left +
        bounds.width * cfg.COPY_LEFT_RATIO +
        cfg.COPY_NUDGE_X;
      const t =
        bounds.top + H * cfg.COPY_TOP_RATIO + cfg.COPY_NUDGE_Y;
      const el = ctx.mountCopy({ top: t, left: l, html: seoCopyHTML() });
      el.style.maxWidth = `${cfg.COPY_MAX_W_PX}px`;
      el.style.fontFamily = cfg.COPY_FAMILY;

      const h3 = el.querySelector("h3");
      if (h3) {
        h3.style.cssText =
          `margin:0 0 8px;color:${cfg.COPY_COLOR_HEAD};` +
          `font:${cfg.COPY_H_WEIGHT} ${cfg.COPY_H_PT}pt Newsreader, Georgia, serif`;
      }
      el.querySelectorAll("p").forEach((p) => {
        p.style.cssText =
          `margin:0 0 8px;color:${cfg.COPY_COLOR_BODY};` +
          `font:${cfg.COPY_BODY_WEIGHT} ${cfg.COPY_BODY_PT}pt ${cfg.COPY_FAMILY};` +
          `line-height:${cfg.COPY_LINE_HEIGHT}`;
      });
    }
  };
})();