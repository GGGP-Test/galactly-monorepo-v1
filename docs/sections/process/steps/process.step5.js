// sections/process/steps/process.step5.js
(() => {
  const STEP = 5;
  const NS = "http://www.w3.org/2000/svg";

  // -------------------- CONFIG (STATIC + CPU-LIGHT) --------------------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step5 = root.step5 || {};
    const dflt = {
      // Canvas sizing
      H_MAX: 560,
      MOBILE_BREAKPOINT: 640,

      // Column layout (desktop)
      LEFT_MARGIN_RATIO: 0.08,      // keeps cluster in the right “lamp” rail
      COL_W_RATIO: 0.10,
      COL_GAP_RATIO: 0.12,
      STACK_TOP_RATIO: 0.18,
      NUDGE_X: -30, NUDGE_Y: -6,

      // Wiring density (keep this small for CPU; raise if you want fuller mesh)
      WIRE_DENSITY: 6,              // 3–10 is reasonable
      WIRE_COLOR: "rgba(242,220,160,0.85)",

      // Shape strokes
      SHAPE_COLOR: "rgba(99,211,255,0.95)",
      STROKE_PX: 2.2,
      LINE_STROKE_PX: 1.9,

      // Rounds
      RADIUS_RECT: 14, RADIUS_PILL: 18, RADIUS_OVAL: 999,

      // Continuation hint dots
      DOTS_COUNT: 3, DOTS_SIZE_PX: 2.2, DOTS_GAP_PX: 22, DOTS_Y_OFFSET: 20,

      // Subtle “more goes on” fade (no blur for CPU)
      FADE_OPACITY: 0.55,

      // Title
      TITLE_SHOW: true,
      TITLE_TEXT: "AI Orchestrator — Weighted Decision Engine",
      TITLE_PT: 14, TITLE_WEIGHT: 700,
      TITLE_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_OFFSET_X: 0, TITLE_OFFSET_Y: -28, TITLE_LETTER_SPACING: 0.2,

      // Left copy (desktop)
      COPY_LEFT_RATIO: 0.035, COPY_TOP_RATIO: 0.16,
      COPY_NUDGE_X: 0, COPY_NUDGE_Y: 0, COPY_MAX_W_PX: 360,
      COPY_H_PT: 24, COPY_H_WEIGHT: 600, COPY_BODY_PT: 12, COPY_BODY_WEIGHT: 400,
      COPY_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_LINE_HEIGHT: 1.6,

      // Mobile layout
      M_MAX_W: 520, M_SIDE_PAD: 16,
      M_TITLE_PT: 16, M_COPY_H_PT: 22, M_COPY_BODY_PT: 14,
      M_SECTION_TOP: 40, M_SECTION_BOTTOM: 72,
      M_BORDER_PX: 2,

      // SEO / sales copy (left rail)
      TITLE_SEO: "AI Orchestrator for B2B Packaging — real-time lead weighting",
      COPY_SEO_HTML:
        '<h3>AI Orchestrator for Packaging Sales</h3>\
         <p>Our orchestrator blends an Olympiad-level math engine with adaptive AI to <b>weight every signal</b> from Steps 0–4 — YourCompany.com intake, Intent, Time Sensitivity, Weight/Retention, and Platform. It updates continuously to output: a <b>lead tier</b> (Cool/Warm/Hot/Hot+), a <b>recommended channel</b> (email, phone, LinkedIn/IG DM), and a <b>timing nudge</b> when windows open.</p>\
         <p>For converters, label/flexpack shops, and corrugated providers, that means fewer cold touches and more well-timed, first-call wins. Plug it into your CRM and let the <b>right-channel-now</b> decision happen before your rep even dials.</p>',

      // Column recipes (no labels inside shapes)
      COLS: [
        // Step 0: YourCompany.com (intake)
        { kind: "input", items: [ { type: "circle", wPct: 0.36, hPct: 0.36 } ] },

        // Step 1: Intent Score
        { kind: "intent", items: [
          { type: "rect",   hPct: 0.13 },
          { type: "rect",   hPct: 0.09 },
          { type: "pill",   hPct: 0.10 },
          { type: "oval",   hPct: 0.12 },
          { type: "diamond",hPct: 0.12, fade: true }
        ]},

        // Step 2: Time Sensitivity
        { kind: "time", items: [
          { type: "rect",   hPct: 0.14 },
          { type: "rect",   hPct: 0.10 },
          { type: "oval",   hPct: 0.12 },
          { type: "rect",   hPct: 0.12, fade: true }
        ]},

        // Step 3: Weight Score
        { kind: "weight", items: [
          { type: "oval",   hPct: 0.14 },
          { type: "rect",   hPct: 0.11 },
          { type: "rect",   hPct: 0.10 },
          { type: "rect",   hPct: 0.12, fade: true }
        ]},

        // Step 4: Platform Score
        { kind: "platform", items: [
          { type: "diamond",hPct: 0.12 },
          { type: "pill",   hPct: 0.12 },
          { type: "circle", hPct: 0.20, fade: true }
        ]},

        // Output (arrow -> block)
        { kind: "output", items: [
          { type: "arrow",  wPct: 0.40, hPct: 0.08 },
          { type: "rect",   hPct: 0.16 }
        ]}
      ]
    };
    for (const k in dflt) if (!(k in root.step5)) root.step5[k] = dflt[k];
    return root.step5;
  }

  // -------------------- helpers (STATIC) --------------------
  const rr = (x, y, w, h, r) => {
    const R = Math.min(r, Math.min(w, h) / 2);
    return `M ${x + R} ${y} H ${x + w - R} Q ${x + w} ${y} ${x + w} ${y + R}
            V ${y + h - R} Q ${x + w} ${y + h} ${x + w - R} ${y + h}
            H ${x + R} Q ${x} ${y + h} ${x} ${y + h - R}
            V ${y + R} Q ${x} ${y} ${x + R} ${y} Z`;
  };
  const diamond = (x, y, w, h) => {
    const cx = x + w/2, cy = y + h/2;
    return `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`;
  };
  const addPath = (svg, d, stroke, sw, extra={}) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d); p.setAttribute("fill", "none");
    p.setAttribute("stroke", stroke); p.setAttribute("stroke-width", sw);
    p.setAttribute("stroke-linejoin", "round"); p.setAttribute("stroke-linecap", "round");
    p.style.filter = "none"; p.style.willChange = "auto";
    for (const k in extra) p.setAttribute(k, extra[k]);
    svg.appendChild(p); return p;
  };
  const addCircle = (svg, cx, cy, r, stroke, sw, fillNone=true) => {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
    if (fillNone) c.setAttribute("fill", "none");
    c.setAttribute("stroke", stroke); c.setAttribute("stroke-width", sw);
    svg.appendChild(c); return c;
  };
  const addArrow = (svg, x, y, w, h, stroke, sw) => {
    const midY = y + h/2, head = Math.min(16, w * 0.35), body = w - head;
    const d = `M ${x} ${midY} H ${x + body} M ${x + body} ${midY - h*0.6} L ${x + w} ${midY} L ${x + body} ${midY + h*0.6}`;
    return addPath(svg, d, stroke, sw);
  };

  function connectDense(svg, fromList, toList) {
    const stroke = C().WIRE_COLOR, sw = C().LINE_STROKE_PX;
    const fN = fromList.length, tN = toList.length;
    const steps = Math.max(1, C().WIRE_DENSITY);
    for (let i=0;i<steps;i++){
      const a = fromList[Math.floor(i * fN / steps)];
      const b = toList[Math.floor((steps-1-i) * tN / steps)];
      const ax = a.x + a.w, ay = a.y + a.h/2;
      const bx = b.x,       by = b.y + b.h/2;
      const ctrl = (bx-ax) * 0.35;
      const d = `M ${ax} ${ay} C ${ax+ctrl} ${ay}, ${bx-ctrl} ${by}, ${bx} ${by}`;
      addPath(svg, d, stroke, sw, { opacity: 0.9 });
    }
  }

  // -------------------- MOBILE DOM (STATIC SVG in a scroll container) --------------------
  function ensureMobileCSS() {
    const id = "p5m-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style"); s.id = id;
    const bp = C().MOBILE_BREAKPOINT;
    s.textContent =
      "@media (max-width:"+bp+"px){"+
      "  html,body,#section-process{overflow-x:hidden}"+
      "  #section-process .p5m-wrap{position:relative;margin:"+C().M_SECTION_TOP+"px auto "+C().M_SECTION_BOTTOM+"px !important;max-width:"+C().M_MAX_W+"px;padding:0 "+C().M_SIDE_PAD+"px 12px;z-index:0}"+
      "  .p5m-title{text-align:center;color:#ddeaef;font:"+C().TITLE_WEIGHT+" "+C().M_TITLE_PT+"pt "+C().TITLE_FAMILY+";letter-spacing:"+C().TITLE_LETTER_SPACING+"px;margin:6px 0 10px}"+
      "  .p5m-copy{margin:0 auto 14px;color:#a7bacb}"+
      "  .p5m-copy h3{margin:0 0 8px;color:#eaf0f6;font:600 "+C().M_COPY_H_PT+"px Newsreader, Georgia, serif}"+
      "  .p5m-copy p{margin:0;font:400 "+C().M_COPY_BODY_PT+"px/1.55 Inter, system-ui}"+
      "  .p5m-svg-wrap{overflow-x:auto;border:"+C().M_BORDER_PX+"px solid rgba(99,211,255,.25);border-radius:12px;padding:8px}"+
      "  .p5m-svg{min-width:860px;display:block}"+
      "}";
    document.head.appendChild(s);
  }

  function drawMobile(ctx) {
    ensureMobileCSS();
    ctx.canvas.style.position = "relative";
    ctx.canvas.style.inset = "auto";
    ctx.canvas.style.pointerEvents = "auto";

    const wrap = document.createElement("div"); wrap.className = "p5m-wrap";
    wrap.innerHTML =
      (C().TITLE_SHOW ? '<div class="p5m-title">AI Orchestrator</div>' : "") +
      '<div class="p5m-copy">'+ C().COPY_SEO_HTML +'</div>' +
      '<div class="p5m-svg-wrap"><svg class="p5m-svg" viewBox="0 0 960 420"></svg></div>';
    ctx.canvas.appendChild(wrap);

    const svg = wrap.querySelector("svg");
    drawWorkflow(svg, { W: 960, H: 420 });
  }

  // -------------------- CORE DRAW (STATIC) --------------------
  function drawWorkflow(svg, dims) {
    const { W, H } = dims;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.pointerEvents = "none"; // CPU: no hit-testing

    const colW = W * C().COL_W_RATIO;
    const gap = W * C().COL_GAP_RATIO;
    const leftStart = W * C().LEFT_MARGIN_RATIO + C().NUDGE_X;
    const topY = H * C().STACK_TOP_RATIO + C().NUDGE_Y;
    const usableH = H * 0.64;

    const stacks = [];
    let x = leftStart;

    function drawItem(type, x, y, w, h, fade=false) {
      const stroke = C().SHAPE_COLOR, sw = C().STROKE_PX;
      let drawn;
      if (type === "rect") drawn = addPath(svg, rr(x, y, w, h, C().RADIUS_RECT), stroke, sw);
      else if (type === "pill") drawn = addPath(svg, rr(x, y, w, h, C().RADIUS_PILL), stroke, sw);
      else if (type === "oval") drawn = addPath(svg, rr(x, y, w, h, C().RADIUS_OVAL), stroke, sw);
      else if (type === "diamond") drawn = addPath(svg, diamond(x, y, w, h), stroke, sw);
      else if (type === "circle") drawn = addCircle(svg, x + w/2, y + h/2, Math.min(w,h)/2, stroke, sw);
      else if (type === "arrow") drawn = addArrow(svg, x, y, w, h, C().SHAPE_COLOR, C().LINE_STROKE_PX);
      if (fade) drawn.setAttribute("opacity", C().FADE_OPACITY);
      return drawn;
    }

    function stackColumn(colSpec) {
      const parts = [];
      let y = topY;

      if (colSpec.kind === "input") {
        const d = colSpec.items[0];
        const size = Math.min(colW * (d.wPct || 0.42), usableH * 0.18);
        const cx = x + size/2, cy = y + size/2 + 8;
        addCircle(svg, cx, cy, size/2, C().SHAPE_COLOR, C().STROKE_PX);
        parts.push({ x: cx - size/2, y: cy - size/2, w: size, h: size });
        stacks.push(parts); x += colW + gap; return parts;
      }

      const totalHPct = colSpec.items.reduce((s, it)=> s + (it.hPct || 0.1), 0);
      const unitH = usableH / (totalHPct + (colSpec.items.length - 1) * 0.18);
      const gapY = unitH * 0.18;

      colSpec.items.forEach(it => {
        const h = unitH * (it.hPct || 0.1), w = colW;
        const item = { x, y, w, h };
        drawItem(it.type, x, y, w, h, it.fade === true);
        parts.push(item); y += h + gapY;
      });

      if (C().DOTS_COUNT > 0) {
        const cx = x + colW/2;
        let dy = y + C().DOTS_Y_OFFSET;
        for (let i=0;i<C().DOTS_COUNT;i++){
          const c = document.createElementNS(NS, "circle");
          c.setAttribute("cx", cx); c.setAttribute("cy", dy);
          c.setAttribute("r", C().DOTS_SIZE_PX);
          c.setAttribute("fill", C().SHAPE_COLOR);
          svg.appendChild(c); dy += C().DOTS_GAP_PX;
        }
      }

      stacks.push(parts); x += colW + gap; return parts;
    }

    // Build stacks per your screenshot / steps
    const cols = C().COLS.map(stackColumn);

    // Wiring (static, lightly dense for performance)
    connectDense(svg, cols[0], cols[1]); // input -> intent
    connectDense(svg, cols[1], cols[2]); // intent -> time
    connectDense(svg, cols[2], cols[3]); // time -> weight
    connectDense(svg, cols[3], cols[4]); // weight -> platform

    // Platform vertical rail (diamond -> pill -> circle)
    const p = cols[4];
    const px = p[0].x + p[0].w/2;
    addPath(svg, `M ${px} ${p[0].y + p[0].h} V ${p[1].y} M ${px} ${p[1].y + p[1].h} V ${p[2].y}`,
            C().WIRE_COLOR, C().LINE_STROKE_PX);

    // Platform -> output arrow wire
    const outCol = cols[5];
    const from = p[1];
    const ax = from.x + from.w, ay = from.y + from.h/2;
    const bx = outCol[0].x,     by = outCol[0].y + outCol[0].h/2;
    const ctrl = (bx-ax) * 0.35;
    addPath(svg, `M ${ax} ${ay} C ${ax+ctrl} ${ay}, ${bx-ctrl} ${by}, ${bx} ${by}`,
            C().WIRE_COLOR, C().LINE_STROKE_PX);

    // Title
    if (C().TITLE_SHOW) {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", W * 0.62 + C().TITLE_OFFSET_X);
      t.setAttribute("y", (H * C().STACK_TOP_RATIO) + C().TITLE_OFFSET_Y);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "#ddeaef");
      t.setAttribute("font-family", C().TITLE_FAMILY);
      t.setAttribute("font-weight", C().TITLE_WEIGHT);
      t.setAttribute("font-size", `${C().TITLE_PT}pt`);
      t.style.letterSpacing = `${C().TITLE_LETTER_SPACING}px`;
      t.textContent = C().TITLE_TEXT;
      svg.appendChild(t);
    }
  }

  // -------------------- SCENE --------------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    const b = ctx.bounds;
    const isMobile = (window.PROCESS_FORCE_MOBILE === true) || (window.innerWidth <= C().MOBILE_BREAKPOINT);
    if (isMobile) { drawMobile(ctx); return; }

    const W = b.width, H = Math.min(C().H_MAX, b.sH - 40);
    const svg = document.createElementNS(NS, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.pointerEvents = "none"; // CPU: static
    ctx.canvas.appendChild(svg);

    drawWorkflow(svg, { W, H });

    // Left copy (SEO)
    const left = b.left + W * C().COPY_LEFT_RATIO + C().COPY_NUDGE_X;
    const top  = b.top  + H * C().COPY_TOP_RATIO  + C().COPY_NUDGE_Y;
    if (typeof ctx.mountCopy === "function") {
      const el = ctx.mountCopy({ top, left, html: C().COPY_SEO_HTML });
      el.style.maxWidth = `${C().COPY_MAX_W_PX}px`;
      el.style.fontFamily = C().COPY_FAMILY;
      const h3 = el.querySelector("h3"); if (h3) h3.style.font = `${C().COPY_H_WEIGHT} ${C().COPY_H_PT}pt ${C().COPY_FAMILY}`;
      const p = el.querySelectorAll("p"); p.forEach(n => n.style.cssText = `font:${C().COPY_BODY_WEIGHT} ${C().COPY_BODY_PT}pt ${C().COPY_FAMILY}; line-height:${C().COPY_LINE_HEIGHT}`);
    }
  };
})();