(() => {
  const STEP = 5;
  const NS = "http://www.w3.org/2000/svg";

  // -------------------- CONFIG / KNOBS --------------------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step5 = root.step5 || {};

    const dflt = {
      // ===== Layout in the right rail (desktop) =====
      STACK_X_RATIO: 0.705,     // push orchestration graphic to the right
      STACK_TOP_RATIO: 0.18,    // vertical start
      WIDTH_RATIO: 0.54,        // how wide the orchestration graphic can be
      HEIGHT_MAX_PX: 560,
      NUDGE_X: -230, NUDGE_Y: -12,

      // Column geometry
      COL_GAP_RATIO: 0.06,      // gap between columns (as % of orchestration width)
      COL_W_RATIO: 0.13,        // width of each column (as % of orchestration width)
      ITEM_H_RATIO: 0.12,       // base item height vs orchestration height
      ITEM_GAP_RATIO: 0.04,     // vertical gap between items (vs orchestration height)
      RADIUS_RECT: 14,
      RADIUS_PILL: 22,
      RADIUS_OVAL: 999,

      // Lines
      DRAW_MESH: true,          // all-to-all between adjacent columns
      LINE_COLOR: "rgba(242,220,160,0.9)",   // gold-ish
      LINE_WIDTH: 2,
      LINE_OPACITY: 0.9,

      // Shape strokes (static, CPU-light)
      SHAPE_COLOR: "rgba(99,211,255,0.95)",  // cyan-ish
      SHAPE_WIDTH: 2.2,

      // Fade/ghost tail (cheap—no CSS blur)
      TAIL_SHOW: true,
      TAIL_H_RATIO: 0.10,        // last 10% of each column ghosted
      TAIL_OPACITY: 0.18,

      // Headings over columns (you can rename these)
      HEADINGS_SHOW: true,
      HEAD_PT: 11,
      HEAD_WEIGHT: 650,
      HEAD_COLOR: "#ddeaef",
      HEAD_LETTER_SPACING: 0.2,
      HEADINGS: ["Intent Score", "Time Score", "Weight Score", "Character Score", "Platform Score"],

      // Copy block on the left (SEO text)
      COPY_LEFT_RATIO: 0.035, COPY_TOP_RATIO: 0.16,
      COPY_NUDGE_X: 0, COPY_NUDGE_Y: 0, COPY_MAX_W_PX: 320,
      COPY_H_PT: 24, COPY_H_WEIGHT: 600, COPY_BODY_PT: 12, COPY_BODY_WEIGHT: 400,
      COPY_COLOR_HEAD: "#eaf0f6", COPY_COLOR_BODY: "#a7bacb",
      COPY_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_LINE_HEIGHT: 1.6,

      // Section title above the network
      TITLE_SHOW: true,
      TITLE_TEXT: "AI Orchestrator — Weight What Matters",
      TITLE_PT: 14, TITLE_WEIGHT: 700,
      TITLE_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_COLOR: "#ddeaef", TITLE_LETTER_SPACING: 0.2,
      TITLE_OFFSET_X: 0, TITLE_OFFSET_Y: -28,

      // Mobile knobs (phones only; desktop unaffected)
      MOBILE_BREAKPOINT: 640,
      M_MAX_W: 520, M_SIDE_PAD: 16,
      M_SECTION_TOP: 40, M_SECTION_BOTTOM: 72,
      M_TITLE_PT: 16,
      M_COPY_H_PT: 22, M_COPY_BODY_PT: 14,
      M_HEAD_PT: 12,

      // Column/shape recipe (match your steps; change freely)
      // Types: "rect", "pill", "oval", "diamond", "circle"
      COLS: [
        { key: "intent",    items: ["rect", "rect", "pill", "oval", "diamond"] },
        { key: "time",      items: ["pill", "rect", "oval", "rect"] },
        { key: "weight",    items: ["oval", "rect", "pill", "rect"] },
        { key: "character", items: ["oval", "rect", "rect", "rect"] },
        { key: "platform",  items: ["diamond", "pill", "circle", "rect"] }
      ]
    };

    for (const k in dflt) if (!(k in root.step5)) root.step5[k] = dflt[k];
    return root.step5;
  }

  // -------------------- helpers --------------------
  const rr = (x, y, w, h, r) => {
    const R = Math.min(r, Math.min(w, h) / 2);
    return `M ${x + R} ${y} H ${x + w - R} Q ${x + w} ${y} ${x + w} ${y + R}
            V ${y + h - R} Q ${x + w} ${y + h} ${x + w - R} ${y + h}
            H ${x + R} Q ${x} ${y + h} ${x} ${y + h - R}
            V ${y + R} Q ${x} ${y} ${x + R} ${y} Z`;
  };

  const diamond = (cx, cy, w, h) =>
    `M ${cx} ${cy - h/2} L ${cx + w/2} ${cy} L ${cx} ${cy + h/2} L ${cx - w/2} ${cy} Z`;

  function addPath(svg, d, stroke, sw, opacity = 1) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", sw);
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", "round");
    p.style.opacity = opacity;
    svg.appendChild(p);
    return p;
  }

  function addFO(svg, x, y, w, h, html, styles) {
    const fo = document.createElementNS(NS, "foreignObject");
    fo.setAttribute("x", x); fo.setAttribute("y", y);
    fo.setAttribute("width", w); fo.setAttribute("height", h);
    const d = document.createElement("div");
    d.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    Object.assign(d.style, {
      width: "100%", height: "100%", display: "flex",
      alignItems: "center", justifyContent: "center",
      textAlign: "center", color: "#ddeaef",
      whiteSpace: "pre-wrap", wordBreak: "break-word",
      pointerEvents: "none"
    }, styles || {});
    d.innerHTML = html;
    fo.appendChild(d);
    svg.appendChild(fo);
  }

  // -------------------- MOBILE CSS (stacked) --------------------
  function ensureMobileCSS() {
    const id = "p5m-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style"); s.id = id;
    const bp = C().MOBILE_BREAKPOINT;
    s.textContent =
      "@media (max-width:" + bp + "px){" +
      "  html,body,#section-process{overflow-x:hidden}" +
      "  #section-process .p5m-wrap{position:relative;margin:" + C().M_SECTION_TOP + "px auto " + C().M_SECTION_BOTTOM + "px !important;max-width:" + C().M_MAX_W + "px;padding:0 " + C().M_SIDE_PAD + "px 12px;z-index:0}" +
      "  .p5m-title{text-align:center;color:#ddeaef;font:" + C().TITLE_WEIGHT + " " + C().M_TITLE_PT + "pt " + C().TITLE_FAMILY + ";letter-spacing:" + C().TITLE_LETTER_SPACING + "px;margin:6px 0 10px}" +
      "  .p5m-copy{margin:0 auto 12px;color:#a7bacb}" +
      "  .p5m-copy h3{margin:0 0 6px;color:#eaf0f6;font:600 " + C().M_COPY_H_PT + "px Newsreader, Georgia, serif}" +
      "  .p5m-copy p{margin:0;font:400 " + C().M_COPY_BODY_PT + "px/1.55 Inter, system-ui}" +
      "  .p5m-svg{width:100%;height:auto;display:block}" +
      "}";
    document.head.appendChild(s);
  }

  function drawMobile(ctx, dims) {
    ensureMobileCSS();
    ctx.canvas.style.position = "relative";
    ctx.canvas.style.inset = "auto";
    ctx.canvas.style.pointerEvents = "auto";

    const wrap = document.createElement("div");
    wrap.className = "p5m-wrap";

    const copyHTML = seoCopyHTML(); // uses C()
    wrap.innerHTML =
      (C().TITLE_SHOW ? '<div class="p5m-title">'+C().TITLE_TEXT+"</div>" : "") +
      '<div class="p5m-copy">'+ copyHTML +'</div>';

    const svg = document.createElementNS(NS, "svg");
    svg.classList.add("p5m-svg");
    // Single, fixed viewBox scales nicely on phones (static == CPU-light)
    svg.setAttribute("viewBox", `0 0 ${dims.W} ${dims.H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "auto");
    wrap.appendChild(svg);
    ctx.canvas.appendChild(wrap);
    return svg;
  }

  // -------------------- SEO copy --------------------
  function seoCopyHTML() {
    return (
      '<h3>SPHERE-3: our AI Orchestrator</h3>' +
      '<p><b>SPHERE-3</b> blends Olympiad-grade math with multi-LLM reasoning to set live weights ' +
      'across <b>Intent</b>, <b>Time</b>, <b>Weight</b>, <b>Character</b>, and <b>Platform</b>. ' +
      'It routes every company to <b>cool / warm / hot / hot+</b> and a <b>right-channel-now score</b> ' +
      'so packaging teams engage where conversion is most likely.</p>' +
      '<p>Keywords: packaging lead scoring • time-to-buy signal • intent scoring • platform fit • AI orchestrator • ' +
      'SPHERE-3 • Artemis-B • B2B packaging buyers • hot plus leads.</p>'
    );
  }

  // -------------------- main draw --------------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    const isMobile = (window.PROCESS_FORCE_MOBILE === true) || (window.innerWidth <= C().MOBILE_BREAKPOINT);

    // overall canvas bounds from Steps component
    const railW = ctx.bounds.width * C().WIDTH_RATIO;
    const W = Math.max(300, railW);
    const H = Math.min(C().HEIGHT_MAX_PX, ctx.bounds.sH - 40);

    // Where the orchestration graphic sits (right rail)
    const x0 = ctx.bounds.width * C().STACK_X_RATIO + C().NUDGE_X;
    const y0 = H * C().STACK_TOP_RATIO + C().NUDGE_Y;

    // Create SVG
    let svg;
    if (isMobile) {
      svg = drawMobile(ctx, { W, H });
    } else {
      svg = document.createElementNS(NS, "svg");
      svg.style.position = "absolute";
      svg.style.left = ctx.bounds.left + "px";
      svg.style.top = ctx.bounds.top + "px";
      svg.setAttribute("width", ctx.bounds.width);
      svg.setAttribute("height", H);
      svg.setAttribute("viewBox", `0 0 ${ctx.bounds.width} ${H}`);
      ctx.canvas.appendChild(svg);
    }

    // Title (desktop only, mobile already added above)
    if (!isMobile && C().TITLE_SHOW) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", (x0 + (W/2)) + C().TITLE_OFFSET_X);
      t.setAttribute("y", (y0) + C().TITLE_OFFSET_Y);
      Object.assign(t, {
        textContent: C().TITLE_TEXT
      });
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", C().TITLE_COLOR);
      t.setAttribute("font-family", C().TITLE_FAMILY);
      t.setAttribute("font-weight", C().TITLE_WEIGHT);
      t.setAttribute("font-size", `${C().TITLE_PT}pt`);
      t.style.letterSpacing = `${C().TITLE_LETTER_SPACING}px`;
      svg.appendChild(t);
    }

    // Dimensions for columns inside orchestration area
    const colGap = W * C().COL_GAP_RATIO;
    const colW = W * C().COL_W_RATIO;
    const innerW = (C().COLS.length * colW) + ((C().COLS.length - 1) * colGap);
    const left = x0 + (W - innerW)/2;
    const top = y0 + 8;
    const itemBaseH = H * C().ITEM_H_RATIO;
    const itemGap = H * C().ITEM_GAP_RATIO;

    // Draw columns & shapes (record centers for connections)
    const colCenters = []; // array of arrays [{cx,cy}]
    const heads = C().HEADINGS;
    C().COLS.forEach((col, cIdx) => {
      const x = left + cIdx * (colW + colGap);
      const yStart = top + 24; // headroom for heading text
      const centers = [];

      // heading
      if (C().HEADINGS_SHOW && heads && heads[cIdx]) {
        addFO(svg, x, top - 6, colW, 20,
          `<div style="font:${C().HEAD_WEIGHT} ${C().HEAD_PT}pt ${C().COPY_FAMILY};letter-spacing:${C().HEAD_LETTER_SPACING}px;color:${C().HEAD_COLOR};opacity:0.95">${heads[cIdx]}</div>`);
      }

      let y = yStart;
      col.items.forEach((type, i) => {
        // size variations to keep proportions close to screenshots
        const h = (type === "circle") ? itemBaseH * 0.9 :
                  (type === "diamond") ? itemBaseH * 0.9 :
                  itemBaseH;
        const w = colW;

        // shape path
        let d;
        if (type === "rect") {
          d = rr(x, y, w, h, C().RADIUS_RECT);
          addPath(svg, d, C().SHAPE_COLOR, C().SHAPE_WIDTH);
          centers.push({ cx: x + w/2, cy: y + h/2 });
        } else if (type === "pill") {
          d = rr(x, y, w, h, C().RADIUS_PILL);
          addPath(svg, d, C().SHAPE_COLOR, C().SHAPE_WIDTH);
          centers.push({ cx: x + w/2, cy: y + h/2 });
        } else if (type === "oval") {
          d = rr(x, y, w, h, C().RADIUS_OVAL);
          addPath(svg, d, C().SHAPE_COLOR, C().SHAPE_WIDTH);
          centers.push({ cx: x + w/2, cy: y + h/2 });
        } else if (type === "circle") {
          const r = Math.min(w, h) / 2;
          const cx = x + w/2, cy = y + h/2;
          const c = document.createElementNS(NS, "circle");
          c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
          c.setAttribute("fill", "none"); c.setAttribute("stroke", C().SHAPE_COLOR);
          c.setAttribute("stroke-width", C().SHAPE_WIDTH);
          svg.appendChild(c);
          centers.push({ cx, cy });
        } else if (type === "diamond") {
          const cx = x + w/2, cy = y + h/2;
          d = diamond(cx, cy, w * 0.9, h * 0.9);
          addPath(svg, d, C().SHAPE_COLOR, C().SHAPE_WIDTH);
          centers.push({ cx, cy });
        }

        y += h + itemGap;
      });

      // tail (ghost last 10%)
      if (C().TAIL_SHOW) {
        const tailH = H * C().TAIL_H_RATIO;
        const tail = document.createElementNS(NS, "rect");
        tail.setAttribute("x", x); tail.setAttribute("y", H - tailH);
        tail.setAttribute("width", colW); tail.setAttribute("height", tailH);
        tail.setAttribute("fill", C().SHAPE_COLOR);
        tail.style.opacity = C().TAIL_OPACITY;
        svg.appendChild(tail);
      }

      colCenters.push(centers);
    });

    // Mesh lines between adjacent columns
    if (C().DRAW_MESH) {
      for (let i = 0; i < colCenters.length - 1; i++) {
        const a = colCenters[i], b = colCenters[i + 1];
        for (const p of a) {
          for (const q of b) {
            addPath(svg, `M ${p.cx} ${p.cy} L ${q.cx} ${q.cy}`,
              C().LINE_COLOR, C().LINE_WIDTH, C().LINE_OPACITY);
          }
        }
      }
    }

    // Left copy (desktop)
    if (!isMobile && typeof ctx.mountCopy === "function") {
      const leftCopy = ctx.bounds.left + ctx.bounds.width * C().COPY_LEFT_RATIO + C().COPY_NUDGE_X;
      const topCopy  = ctx.bounds.top  + H * C().COPY_TOP_RATIO + C().COPY_NUDGE_Y;
      const el = ctx.mountCopy({ top: topCopy, left: leftCopy, html: seoCopyHTML() });
      el.style.maxWidth = `${C().COPY_MAX_W_PX}px`;
      el.style.fontFamily = C().COPY_FAMILY;

      const h3 = el.querySelector("h3");
      if (h3) { h3.style.cssText = `margin:0 0 8px;color:${C().COPY_COLOR_HEAD};font:${C().COPY_H_WEIGHT} ${C().COPY_H_PT}pt Newsreader, Georgia, serif`; }

      const ps = el.querySelectorAll("p");
      ps.forEach((p) => p.style.cssText =
        `margin:0 0 8px;color:${C().COPY_COLOR_BODY};font:${C().COPY_BODY_WEIGHT} ${C().COPY_BODY_PT}pt ${C().COPY_FAMILY}; line-height:${C().COPY_LINE_HEIGHT}`);
    }
  };
})();