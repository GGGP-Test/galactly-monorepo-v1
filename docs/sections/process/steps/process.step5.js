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
      DOTS_TOP_PAD: 45, // px padding from last item center to first dot (desktop)

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
      M_HEAD_PT: 4.5, // mobile
      HEAD_WEIGHT: 850,
      HEAD_COLOR: "#ddeaef",
      HEAD_LETTER_SPACING: 0.2,
      HEAD_ALIGN: "center",
      HEAD_BOX_H: 26, // desktop
      HEAD_SPACING: 8, // desktop
      HEAD_OFFSET_Y: 0, // desktop
      HEAD_ONE_LINE: true,
      HEAD_MAX_WIDTH_PCT: 1.95, // desktop
      HEAD_BASELINE_BIAS: 0.74, // desktop

      // ---- section title (both)
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

      // ================= MOBILE OVERRIDES (phones/tablets) =================
      MOBILE_BREAKPOINT: (window.PROCESS_CONFIG?.mobile?.BP ?? 840),
      M_MAX_W: 820,
      M_SIDE_PAD: 16,
      M_SECTION_TOP: 40,
      M_SECTION_BOTTOM: 72,
      M_TITLE_PT: 12,
      M_COPY_H_PT: 22,
      M_COPY_BODY_PT: 14,

      // Global phone scaler — shrink whole SVG as a unit (0.5–1.0)
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
      M_LAST_DIM: 0.85, // number = uniform opacity for last item

      // Mobile headings
      M_HEAD_BOX_H: null,
      M_HEAD_SPACING: null,
      M_HEAD_OFFSET_Y: -40,
      M_HEAD_MAX_WIDTH_PCT: null,
      M_HEAD_BASELINE_BIAS: null,
      M_TITLE_OFFSET_X: null,
      M_TITLE_OFFSET_Y: 40,

      // mobile-specific padding from last item to first dot
      M_DOTS_TOP_PAD: 30,

      // ---- columns recipes
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

  // mobile override helpers
  const pick = (isMobile, key) => {
    const mKey = "M_" + key;
    const cfg = C();
    return isMobile && mKey in cfg && cfg[mKey] != null ? cfg[mKey] : cfg[key];
  };
  const pickMap = (isMobile, key) => {
    const m = pick(isMobile, key);
    return m || C()[key];
  };

  // SVG title helper
  function drawHead(svg, { text, x, y, w, h, isMobile, idx }) {
    const id = `p5h_clip_${idx}_${Math.random().toString(36).slice(2, 7)}`;
    let defsNode = svg.querySelector("defs");
    if (!defsNode) {
      defsNode = document.createElementNS(NS, "defs");
      svg.appendChild(defsNode);
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
    const size = isMobile ? C().M_HEAD_PT : C().HEAD_PT;
    const baselineBias = pick(isMobile, "HEAD_BASELINE_BIAS");
    t.setAttribute("x", x + w / 2);
    t.setAttribute("y", y + h * baselineBias);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", C().HEAD_COLOR);
    t.setAttribute("font-family", C().COPY_FAMILY);
    t.setAttribute("font-weight", C().HEAD_WEIGHT);
    t.setAttribute("font-size", `${size}pt`);
    t.style.letterSpacing = `${C().HEAD_LETTER_SPACING}px`;
    t.textContent = text || "";
    g.appendChild(t);
    svg.appendChild(g);
  }

  // SEO copy
  function seoCopyHTML() {
    return (
      "<h3>Our Realtime AI Orchestrator</h3>" +
      "<p><b>It</b> Blends our Olympiad-grade math structure with multi-LLM reasoning to set live scores across <b>Intent Scoring</b>, <b>Timing</b>, <b>Loyalty</b>, <b>Platform Scoring</b>, and your <b>Sales AI</b> metrics. It also routes every company to <b>cool / warm / hot / hot+</b> B2B packaging buyer categories and a <b>right-now-platform score</b> so engagement has the highest chance of conversion.</p>"
    );
  }

  // ---------------- mobile CSS ----------------
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

  function drawMobile(ctx, dims) {
    ensureMobileCSS();
    ctx.canvas.style.position = "relative";
    ctx.canvas.style.inset = "auto";
    ctx.canvas.style.pointerEvents = "auto";

    const wrap = document.createElement("div");
    wrap.className = "p5m-wrap";

    wrap.innerHTML =
      `<div class="p5m-copy">${seoCopyHTML()}</div>` +
      (C().TITLE_SHOW
        ? `<div class="p5m-title" style="transform:translate(${pick(
            true,
            "TITLE_OFFSET_X"
          ) || 0}px,${pick(true, "TITLE_OFFSET_Y") ?? 0}px)">${
            C().TITLE_TEXT
          }</div>`
        : "");

    const svg = document.createElementNS(NS, "svg");
    svg.classList.add("p5m-svg");
    svg.setAttribute("viewBox", `0 0 ${dims.W} ${dims.H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");

    wrap.appendChild(svg);
    ctx.canvas.appendChild(wrap);
    return svg;
  }

  // ---------------- main draw ----------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    const cfg = C();
    const bounds = ctx.bounds;

    const isMobile =
      window.PROCESS_FORCE_MOBILE === true ||
      window.innerWidth <= cfg.MOBILE_BREAKPOINT;

    const fullW = bounds.width;
    const H = Math.min(cfg.HEIGHT_MAX_PX, bounds.sH - 40);
    const W = isMobile ? fullW : Math.max(300, fullW * cfg.WIDTH_RATIO);

    // For desktop we respect right-rail placement; for mobile we center at 0
    const x0 = isMobile ? 0 : fullW * cfg.STACK_X_RATIO + cfg.NUDGE_X;
    const y0 = H * cfg.STACK_TOP_RATIO + cfg.NUDGE_Y;

    // Global scale knob for phones (1 = normal, <1 = shrink)
    const scale = isMobile ? (cfg.M_SCALE != null ? cfg.M_SCALE : 1) : 1;

    let svg;
    if (isMobile) {
      svg = drawMobile(ctx, { W, H });
    } else {
      svg = document.createElementNS(NS, "svg");
      svg.style.position = "absolute";
      svg.style.left = bounds.left + "px";
      svg.style.top = bounds.top + "px";
      svg.setAttribute("width", bounds.width);
      svg.setAttribute("height", H);
      svg.setAttribute("viewBox", `0 0 ${bounds.width} ${H}`);
      ctx.canvas.appendChild(svg);
    }

    // blur filter
    const defs = document.createElementNS(NS, "defs");
    const f = document.createElementNS(NS, "filter");
    f.setAttribute("id", "p5blur");
    const g = document.createElementNS(NS, "feGaussianBlur");
    g.setAttribute("stdDeviation", "1.5");
    f.appendChild(g);
    defs.appendChild(f);
    svg.appendChild(defs);

    // Section title (desktop only)
    if (!isMobile && cfg.TITLE_SHOW) {
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

    // Dimensions / knobs with mobile overrides + scale
    const colGap = W * pick(isMobile, "COL_GAP_RATIO") * scale;
    const colWBase = W * pick(isMobile, "COL_W_RATIO") * scale;
    const baseH = H * pick(isMobile, "ITEM_H_RATIO") * scale;
    const gap = H * pick(isMobile, "ITEM_GAP_RATIO") * scale;

    const colWArray = cfg.COLS.map(
      (c) => colWBase * (pickMap(isMobile, "COL_W_MULTS")[c.key] || 1)
    );
    const innerW =
      colWArray.reduce((a, b) => a + b, 0) + (cfg.COLS.length - 1) * colGap;
    const left = x0 + (W - innerW) / 2;
    const top = y0 + 8 * scale;

    const SHAPE_W = pick(isMobile, "SHAPE_WIDTH") * scale;
    const SHAPE_COLOR = pick(isMobile, "SHAPE_COLOR");
    const LINE_W = pick(isMobile, "LINE_WIDTH") * scale;
    const LINE_COLOR = pick(isMobile, "LINE_COLOR");
    const CONNECT_GAP = pick(isMobile, "CONNECT_GAP") * scale;
    const R_RECT = pick(isMobile, "RADIUS_RECT");
    const R_PILL = pick(isMobile, "RADIUS_PILL");
    const R_OVAL = pick(isMobile, "RADIUS_OVAL");

    const anchorsByCol = [];
    const headBoxes = [];

    let xCursor = left;

    cfg.COLS.forEach((col, ci) => {
      const key = col.key;
      const colX = xCursor + (pickMap(isMobile, "COL_X_OFFSETS")[key] || 0);
      const colW = colWArray[ci];
      const colY0 = top + (pickMap(isMobile, "COL_Y_OFFSETS")[key] || 0);

      // headings
      const headW = colW * pick(isMobile, "HEAD_MAX_WIDTH_PCT");
      const headHBase = pick(isMobile, "HEAD_BOX_H") || cfg.HEAD_BOX_H;
      const headH = headHBase * scale;
      const headOffsetY =
        (pick(isMobile, "HEAD_OFFSET_Y") != null
          ? pick(isMobile, "HEAD_OFFSET_Y")
          : cfg.HEAD_OFFSET_Y) * scale;
      const headSpacing =
        (pick(isMobile, "HEAD_SPACING") != null
          ? pick(isMobile, "HEAD_SPACING")
          : cfg.HEAD_SPACING) * scale;

      const headX = colX + (colW - headW) / 2;
      const headY = Math.max(0, colY0 + headOffsetY);
      headBoxes.push({ x: headX, y: headY, w: headW, h: headH, idx: ci });

      // shapes
      let y = headY + headH + headSpacing;

      const leftAnch = [];
      const rightAnch = [];
      const yOffsets = pickMap(isMobile, "ITEM_Y_OFFSETS")[key] || [];
      const hMults = pickMap(isMobile, "ITEM_H_MULTS")[key] || [];
      const perStepColor =
        pickMap(isMobile, "SHAPE_COLOR_BY_STEP")[key] || SHAPE_COLOR;
      const perStepWidth =
        pickMap(isMobile, "SHAPE_WIDTH_BY_STEP")[key] || SHAPE_W;

      col.items.forEach((type, i) => {
        const hm = hMults[i] != null ? hMults[i] : 1;
        const h =
          type === "circle" || type === "diamond"
            ? baseH * 0.9 * hm
            : baseH * hm;
        const yAdj = y + (yOffsets[i] || 0);

        let cx, cy, r, d;

        const isLast = i === col.items.length - 1;
        let dimConfig = pick(isMobile, "LAST_DIM");
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
          d = rr(colX, yAdj, colW, h, R_RECT);
          addPath(svg, d, perStepColor, perStepWidth, opacity, filterId);
          cx = colX + colW / 2;
          cy = yAdj + h / 2;
        } else if (type === "pill") {
          d = rr(colX, yAdj, colW, h, R_PILL);
          addPath(svg, d, perStepColor, perStepWidth, opacity, filterId);
          cx = colX + colW / 2;
          cy = yAdj + h / 2;
        } else if (type === "oval") {
          d = rr(colX, yAdj, colW, h, R_OVAL);
          addPath(svg, d, perStepColor, perStepWidth, opacity, filterId);
          cx = colX + colW / 2;
          cy = yAdj + h / 2;
        } else if (type === "circle") {
          r = Math.min(colW, h) / 2;
          cx = colX + colW / 2;
          cy = yAdj + h / 2;
          addCircle(svg, cx, cy, r, perStepColor, perStepWidth, opacity, filterId);
        } else if (type === "diamond") {
          cx = colX + colW / 2;
          cy = yAdj + h / 2;
          d = diamondPath(cx, cy, colW * 0.9, h * 0.9);
          addPath(svg, d, perStepColor, perStepWidth, opacity, filterId);
        }

        let leftX, rightX;
        if (type === "circle") {
          leftX = cx - r;
          rightX = cx + r;
        } else if (type === "diamond") {
          leftX = cx - (colW * 0.9) / 2;
          rightX = cx + (colW * 0.9) / 2;
        } else {
          leftX = colX;
          rightX = colX + colW;
        }
        leftAnch.push({ x: leftX - CONNECT_GAP, y: cy });
        rightAnch.push({ x: rightX + CONNECT_GAP, y: cy });

        y = yAdj + h + gap;
      });

      anchorsByCol.push({ key, left: leftAnch, right: rightAnch });
      xCursor += colW + colGap;

      // Dots
      if (col.dots > 0) {
        const lastRight = anchorsByCol[anchorsByCol.length - 1]?.right || [];
        const lastY = lastRight.length
          ? lastRight[lastRight.length - 1].y
          : 0;

        const padBase =
          pick(isMobile, "DOTS_TOP_PAD") != null
            ? pick(isMobile, "DOTS_TOP_PAD")
            : cfg.DOTS_TOP_PAD != null
            ? cfg.DOTS_TOP_PAD
            : 6;

        const pad = padBase * scale;
        const dotsY = lastY + pad;
        const dotGap = cfg.DOT_GAP * scale;
        const dotSize = cfg.DOT_SIZE * scale;

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

    // connections
    const pairStyles =
      pick(isMobile, "LINE_STYLE_BY_PAIR") || cfg.LINE_STYLE_BY_PAIR || {};
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
    if (cfg.HEADINGS_SHOW) {
      headBoxes.forEach(({ x, y, w, h, idx }) => {
        drawHead(svg, {
          text: cfg.HEADINGS[idx] || "",
          x,
          y,
          w,
          h,
          idx,
          isMobile
        });
      });
    }

    // left SEO copy (desktop only)
    if (!isMobile && typeof ctx.mountCopy === "function") {
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
        h3.style.cssText = `margin:0 0 8px;color:${cfg.COPY_COLOR_HEAD};font:${cfg.COPY_H_WEIGHT} ${cfg.COPY_H_PT}pt Newsreader, Georgia, serif`;
      }
      el.querySelectorAll("p").forEach((p) => {
        p.style.cssText = `margin:0 0 8px;color:${cfg.COPY_COLOR_BODY};font:${cfg.COPY_BODY_WEIGHT} ${cfg.COPY_BODY_PT}pt ${cfg.COPY_FAMILY};line-height:${cfg.COPY_LINE_HEIGHT}`;
      });
    }
  };
})();