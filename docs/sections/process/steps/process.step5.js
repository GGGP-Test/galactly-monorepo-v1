// sections/process/steps/process.step5.js
(() => {
  const STEP = 5;
  const NS = "http://www.w3.org/2000/svg";

  // -------------------- CONFIG --------------------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step5 = root.step5 || {};
    const dflt = {
      // ===== Layout (desktop) =====
      COL_W_RATIO: 0.10,                  // width of each column stack
      COL_GAP_RATIO: 0.12,                // gap between columns
      H_MAX: 560,
      STACK_TOP_RATIO: 0.18,
      NUDGE_X: -30, NUDGE_Y: -6,

      // Element sizing
      RADIUS_RECT: 14, RADIUS_PILL: 18, RADIUS_OVAL: 999,
      STROKE_PX: 2.8, LINE_STROKE_PX: 2.2, GLOW_PX: 16,

      // Animation & colors
      COLOR_CYAN: "rgba(99,211,255,0.95)", 
      COLOR_GOLD: "rgba(242,220,160,0.92)",
      COLOR_WIRE: "rgba(242,220,160,0.86)",
      FLOW_SPEED_S: 6.5, REDUCE_MOTION: false,

      // Dots under each column (continuation hint)
      DOTS_COUNT: 3, DOTS_SIZE_PX: 2.2, DOTS_GAP_PX: 24, DOTS_Y_OFFSET: 22,

      // Title above cluster (desktop)
      TITLE_SHOW: true,
      TITLE_TEXT: "AI Orchestrator — What matters, when it matters",
      TITLE_PT: 14, TITLE_WEIGHT: 700,
      TITLE_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_OFFSET_X: 0, TITLE_OFFSET_Y: -28, TITLE_LETTER_SPACING: 0.2,

      // Left copy (desktop)
      COPY_LEFT_RATIO: 0.035, COPY_TOP_RATIO: 0.16,
      COPY_NUDGE_X: 0, COPY_NUDGE_Y: 0, COPY_MAX_W_PX: 360,
      COPY_H_PT: 24, COPY_H_WEIGHT: 600, COPY_BODY_PT: 12, COPY_BODY_WEIGHT: 400,
      COPY_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_LINE_HEIGHT: 1.6,

      // ===== MOBILE (phones only; desktop unaffected) =====
      MOBILE_BREAKPOINT: 640,
      M_MAX_W: 520, M_SIDE_PAD: 16, M_TITLE_PT: 16,
      M_COPY_H_PT: 22, M_COPY_BODY_PT: 14,
      M_SECTION_TOP: 40, M_SECTION_BOTTOM: 72,
      M_BORDER_PX: 2, M_FONT_PT: 11,

      // ===== SEO copy =====
      TITLE_SEO: "AI Orchestrator for B2B Packaging — real-time lead weighting",
      COPY_SEO_HTML:
        '<h3>Who to contact, on which channel, and when.</h3>\
         <p><b>SPHERE-3</b> is our AI orchestrator. It blends an Olympiad-grade\
         mathematical engine with adaptive AI to <b>weight signals across Steps 0-4</b>\
         (YourCompany.com, Intent, Time Sensitivity, Weight/Retention, Platform).\
         It continuously rebalances as data changes to output three things:\
         <b>lead tier</b> (Cool/Warm/Hot/Hot+), a <b>recommended channel</b>\
         (email, phone, LinkedIn, IG DM, etc.), and an <b>urgency nudge</b> when\
         timing spikes. That means fewer shots in the dark and more first-call closes\
         for <b>packaging suppliers</b> and converters selling to B2B buyers.</p>\
         <p>Because time beats pitch, SPHERE-3 prioritizes recency and deadlines:\
         launches, trade-shows, approvals, and reorder windows. When the data says\
         \"now\", the system routes the right rep to the right buyer on the right\
         channel.</p>',

      // ===== Optional UX sugar (can toggle later) =====
      SUGAR_RECOMMENDED_PULSE: true,   // gently pulse wires into the chosen channel stack
      SUGAR_URGENCY_HOT_PLUS: true,    // add subtle glow if a theoretical lead tier is Hot+

      // Fade/blur for the last element in each stack (to suggest more beyond)
      FADE_OPACITY: 0.55, BLUR_STDDEV: 1.2,

      // Column recipes (no labels; shapes mirror previous steps)
      // Types: 'rect', 'pill', 'oval', 'diamond', 'circle'
      COLS: [
        // Step 0: YourCompany.com (tiny intake node)
        { kind: "input", items: [ { type: "circle", wPct: 0.36, hPct: 0.36 } ] },

        // Step 1: Intent Score (wide rects + oval + diamond)
        { kind: "intent", items: [
          { type: "rect",   hPct: 0.13 },
          { type: "rect",   hPct: 0.09 },
          { type: "pill",   hPct: 0.10 },
          { type: "oval",   hPct: 0.12 },
          { type: "diamond",hPct: 0.12, fade: true }
        ]},

        // Step 2: Time Sensitivity (was Character in old sketch; keep our time stack rhythm)
        { kind: "time", items: [
          { type: "rect",   hPct: 0.14 },
          { type: "rect",   hPct: 0.10 },
          { type: "oval",   hPct: 0.12 },
          { type: "rect",   hPct: 0.12, fade: true }
        ]},

        // Step 3: Weight Score (oval head + rects)
        { kind: "weight", items: [
          { type: "oval",   hPct: 0.14 },
          { type: "rect",   hPct: 0.11 },
          { type: "rect",   hPct: 0.10 },
          { type: "rect",   hPct: 0.12, fade: true }
        ]},

        // Step 4: Platform Score (diamond -> rect -> circle)
        { kind: "platform", items: [
          { type: "diamond",hPct: 0.12 },
          { type: "pill",   hPct: 0.12 },
          { type: "circle", hPct: 0.20, fade: true }
        ]},

        // Final suggested action block (arrow -> square)
        { kind: "output", items: [
          { type: "arrow",  wPct: 0.40, hPct: 0.08 },
          { type: "rect",   hPct: 0.16 }
        ]}
      ]
    };
    for (const k in dflt) if (!(k in root.step5)) root.step5[k] = dflt[k];
    return root.step5;
  }

  // -------------------- helpers --------------------
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

    // wire gradient
    const gWire = document.createElementNS(NS, "linearGradient");
    gWire.id = "gradWire"; gWire.setAttribute("gradientUnits", "userSpaceOnUse");
    gWire.setAttribute("x1", 0); gWire.setAttribute("y1", y);
    gWire.setAttribute("x2", spanX); gWire.setAttribute("y2", y);
    [["0%", C().COLOR_GOLD], ["100%", C().COLOR_CYAN]]
      .forEach(([o, c]) => { const s = document.createElementNS(NS, "stop"); s.setAttribute("offset", o); s.setAttribute("stop-color", c); gWire.appendChild(s); });
    defs.appendChild(gWire);

    // blur filter for bottom items
    const f = document.createElementNS(NS, "filter");
    f.setAttribute("id", "fadeBlur");
    const blur = document.createElementNS(NS, "feGaussianBlur");
    blur.setAttribute("stdDeviation", C().BLUR_STDDEV);
    f.appendChild(blur);
    defs.appendChild(f);

    svg.appendChild(defs);
  }

  function rr(x, y, w, h, r) {
    const R = Math.min(r, Math.min(w, h) / 2);
    return `M ${x + R} ${y} H ${x + w - R} Q ${x + w} ${y} ${x + w} ${y + R}
            V ${y + h - R} Q ${x + w} ${y + h} ${x + w - R} ${y + h}
            H ${x + R} Q ${x} ${y + h} ${x} ${y + h - R}
            V ${y + R} Q ${x} ${y} ${x + R} ${y} Z`;
  }
  function diamond(x, y, w, h) {
    const cx = x + w/2, cy = y + h/2;
    return `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`;
  }
  function addPath(svg, d, stroke, sw, extra={}) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", sw);
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("class", "glow");
    for (const k in extra) p.setAttribute(k, extra[k]);
    svg.appendChild(p);
    return p;
  }
  function addCircle(svg, cx, cy, r, stroke, sw, fillNone=true) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
    if (fillNone) c.setAttribute("fill", "none");
    c.setAttribute("stroke", stroke); c.setAttribute("stroke-width", sw);
    c.setAttribute("class", "glow");
    svg.appendChild(c);
    return c;
  }
  function addArrow(svg, x, y, w, h, stroke, sw) {
    const midY = y + h/2;
    const head = Math.min(16, w * 0.35);
    const body = w - head;
    const d = `M ${x} ${midY} H ${x + body} M ${x + body} ${midY - h*0.6} L ${x + w} ${midY} L ${x + body} ${midY + h*0.6}`;
    return addPath(svg, d, stroke, sw);
  }

  function connectAll(svg, fromList, toList, colorStroke) {
    const stroke = colorStroke || "url(#gradWire)";
    fromList.forEach(a => {
      const ax = a.x + a.w; const ay = a.y + a.h/2;
      toList.forEach(b => {
        const bx = b.x; const by = b.y + b.h/2;
        const ctrl = (bx-ax) * 0.35;
        const d = `M ${ax} ${ay} C ${ax+ctrl} ${ay}, ${bx-ctrl} ${by}, ${bx} ${by}`;
        addPath(svg, d, stroke, C().LINE_STROKE_PX, { opacity: 0.9 });
      });
    });
  }

  // -------------------- MOBILE DOM --------------------
  function ensureMobileCSS() {
    const id = "p5m-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style"); s.id = id;
    const cyan = C().COLOR_CYAN, bp = C().MOBILE_BREAKPOINT;
    s.textContent =
      "@media (max-width:"+bp+"px){" +
      "  html,body,#section-process{overflow-x:hidden}" +
      "  #section-process .p5m-wrap{position:relative;margin:"+C().M_SECTION_TOP+"px auto "+C().M_SECTION_BOTTOM+"px !important;max-width:"+C().M_MAX_W+"px;padding:0 "+C().M_SIDE_PAD+"px 12px;z-index:0}" +
      "  .p5m-title{text-align:center;color:#ddeaef;font:"+C().TITLE_WEIGHT+" "+C().M_TITLE_PT+"pt "+C().TITLE_FAMILY+";letter-spacing:"+C().TITLE_LETTER_SPACING+"px;margin:6px 0 10px}" +
      "  .p5m-copy{margin:0 auto 14px;color:#a7bacb}" +
      "  .p5m-copy h3{margin:0 0 8px;color:#eaf0f6;font:600 "+C().M_COPY_H_PT+"px Newsreader, Georgia, serif}" +
      "  .p5m-copy p{margin:0;font:400 "+C().M_COPY_BODY_PT+"px/1.55 Inter, system-ui}" +
      "  .p5m-svg-wrap{overflow-x:auto;border:"+C().M_BORDER_PX+"px solid rgba(99,211,255,.25);border-radius:12px;padding:8px}" +
      "  .p5m-svg{min-width:760px;display:block}" +
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
      '<div class="p5m-svg-wrap"><svg class="p5m-svg" viewBox="0 0 900 420"></svg></div>';
    ctx.canvas.appendChild(wrap);

    const svg = wrap.querySelector("svg");
    const W = 900, H = 420;
    makeFlowGradients(svg, { spanX: W * 0.15, y: 0 });
    // reuse the desktop renderer scaled to mobile viewBox
    drawWorkflow(svg, { W, H });
  }

  // -------------------- DESKTOP / CORE DRAW --------------------
  function drawWorkflow(svg, dims) {
    const { W, H } = dims;
    const colW = W * C().COL_W_RATIO;
    const gap = W * C().COL_GAP_RATIO;

    // build columns (positions + boxes)
    const stacks = [];
    let x = (W * 0.08) + C().NUDGE_X; // left margin
    const topY = H * C().STACK_TOP_RATIO + C().NUDGE_Y;
    const usableH = H * (0.64);

    function drawItem(type, x, y, w, h, fade=false) {
      const stroke = "url(#gradFlow)";
      const sw = C().STROKE_PX;
      let drawn;
      if (type === "rect") {
        drawn = addPath(svg, rr(x, y, w, h, C().RADIUS_RECT), stroke, sw);
      } else if (type === "pill") {
        drawn = addPath(svg, rr(x, y, w, h, C().RADIUS_PILL), stroke, sw);
      } else if (type === "oval") {
        drawn = addPath(svg, rr(x, y, w, h, C().RADIUS_OVAL), stroke, sw);
      } else if (type === "diamond") {
        drawn = addPath(svg, diamond(x, y, w, h), stroke, sw);
      } else if (type === "circle") {
        const r = Math.min(w, h)/2;
        drawn = addCircle(svg, x + w/2, y + h/2, r, stroke, sw);
      } else if (type === "arrow") {
        drawn = addArrow(svg, x, y, w, h, "url(#gradFlow)", C().LINE_STROKE_PX);
      }
      if (fade) {
        drawn.setAttribute("opacity", C().FADE_OPACITY);
        drawn.setAttribute("filter", "url(#fadeBlur)");
      }
      return drawn;
    }

    function stackColumn(colSpec) {
      const parts = [];
      let y = topY;
      const localW = colW;

      // special tiny input column (single small circle)
      if (colSpec.kind === "input") {
        const d = colSpec.items[0];
        const size = Math.min(colW * (d.wPct || 0.42), usableH * 0.18);
        const cx = x + size/2;
        const cy = y + size/2 + 8;
        const g = addCircle(svg, cx, cy, size/2, "url(#gradFlow)", C().STROKE_PX);
        parts.push({ x: cx - size/2, y: cy - size/2, w: size, h: size, el: g });
        stacks.push(parts);
        x += colW + gap;
        return parts;
      }

      // distribute heights
      const totalHPct = colSpec.items.reduce((s, it)=> s + (it.hPct || 0.1), 0);
      const unitH = (usableH) / (totalHPct + (colSpec.items.length - 1) * 0.18);
      const gapY = unitH * 0.18;

      colSpec.items.forEach((it, idx) => {
        const h = unitH * (it.hPct || 0.1);
        const w = localW;
        const item = { x, y, w, h };
        drawItem(it.type, x, y, w, h, it.fade === true);
        parts.push(item);
        y += h + gapY;
      });

      // continuation dots
      if (C().DOTS_COUNT > 0) {
        let dotY = y + C().DOTS_Y_OFFSET;
        const centerX = x + colW / 2;
        for (let i=0;i<C().DOTS_COUNT;i++){
          const c = document.createElementNS(NS, "circle");
          c.setAttribute("cx", centerX); c.setAttribute("cy", dotY);
          c.setAttribute("r", C().DOTS_SIZE_PX);
          c.setAttribute("fill", C().COLOR_CYAN);
          c.setAttribute("class", "glow");
          svg.appendChild(c);
          dotY += C().DOTS_GAP_PX;
        }
      }

      stacks.push(parts);
      x += colW + gap;
      return parts;
    }

    // draw all stacks
    const cols = C().COLS.map(c => stackColumn(c));

    // Interconnections (keep the dense “neural” feel)
    // input -> intent (fan-out)
    connectAll(svg, cols[0], cols[1], C().COLOR_WIRE);

    // intent <-> time (full bipartite)
    connectAll(svg, cols[1], cols[2]);

    // time <-> weight
    connectAll(svg, cols[2], cols[3]);

    // weight -> platform: converge wires toward first platform node area then split
    connectAll(svg, cols[3], [cols[4][0], cols[4][1], cols[4][2]]);

    // platform vertical rail (diamond -> rect -> circle)
    const p = cols[4];
    const pxMid = p[0].x + p[0].w/2;
    addPath(svg, `M ${pxMid} ${p[0].y + p[0].h} V ${p[1].y} M ${pxMid} ${p[1].y + p[1].h} V ${p[2].y}`,
            "url(#gradFlow)", C().LINE_STROKE_PX);

    // platform -> output arrow -> block
    const outCol = cols[5];
    const from = p[1]; // mid pill (recommended channel hub)
    const ax = from.x + from.w; const ay = from.y + from.h/2;
    const bx = outCol[0].x; const by = outCol[0].y + outCol[0].h/2;
    addPath(svg, `M ${ax} ${ay} C ${ax+40} ${ay}, ${bx-40} ${by}, ${bx} ${by}`, "url(#gradWire)", C().LINE_STROKE_PX);

    // optional sugar: pulse the wire & glow if urgency/hot+
    if (C().SUGAR_RECOMMENDED_PULSE && !reduceMotion()) {
      const all = svg.querySelectorAll("path");
      all.forEach(el => {
        if (Math.random() < 0.12) {
          el.setAttribute("stroke-dasharray", "6 8");
          const a = document.createElementNS(NS, "animate");
          a.setAttribute("attributeName", "stroke-dashoffset");
          a.setAttribute("from", "0"); a.setAttribute("to", "-56");
          a.setAttribute("dur", "3.5s"); a.setAttribute("repeatCount", "indefinite");
          el.appendChild(a);
        }
      });
    }
    if (C().SUGAR_URGENCY_HOT_PLUS) {
      const circle = svg.querySelectorAll("circle");
      circle.forEach((c,i) => { if (i%7===0) c.setAttribute("filter", "url(#fadeBlur)"); });
    }

    // Title above overall cluster
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

  // -------------------- DESKTOP SCENE --------------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    const b = ctx.bounds;
    const isMobile = (window.PROCESS_FORCE_MOBILE === true) || (window.innerWidth <= C().MOBILE_BREAKPOINT);
    if (isMobile) { drawMobile(ctx); return; }

    const W = b.width, H = Math.min(C().H_MAX, b.sH - 40);
    const svg = document.createElementNS(NS, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top = b.top + "px";
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    ctx.canvas.appendChild(svg);

    makeFlowGradients(svg, { spanX: W * 0.15, y: 0 });
    drawWorkflow(svg, { W, H });

    // Left copy block (SEO text)
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