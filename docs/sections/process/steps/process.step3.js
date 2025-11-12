// sections/process/steps/process.step3.js
(() => {
  const STEP = 3;
  const NS = "http://www.w3.org/2000/svg";

  // -------------------- CONFIG (DESKTOP UNCHANGED; MOBILE ONLY VIA M_* KNOBS) --------------------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step3 = root.step3 || {};
    const dflt = {
      // ===== DESKTOP knobs (same visuals) =====
      BOX_W_RATIO: 0.10, BOX_H_RATIO: 0.12, GAP_RATIO: 0.035,
      STACK_X_RATIO: 0.705, STACK_TOP_RATIO: 0.21, NUDGE_X: -230, NUDGE_Y: -20,
      RADIUS_RECT: 14, RADIUS_PILL: 18, RADIUS_OVAL: 999, DIAMOND_SCALE: 1,
      SHOW_LEFT_LINE: true, SHOW_RIGHT_LINE: true,
      LEFT_STOP_RATIO: 0.35, RIGHT_MARGIN_PX: 16, H_LINE_Y_BIAS: -0.06,
      CONNECT_X_PAD: 8, LINE_STROKE_PX: 2.5,

      FONT_PT_CIRCLE: 8, FONT_PT_BOX: 8, FONT_PT_DIAMOND: 7,
      FONT_WEIGHT_BOX: 525,
      FONT_FAMILY_BOX: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      FONT_LETTER_SPACING: 0.3, LINE_HEIGHT_EM: 1.15,
      PADDING_X: 4, PADDING_Y: 4, UPPERCASE: false,

      // Title (desktop)
      TITLE_SHOW: true,
      TITLE_TEXT: "Weight Score — Who stays the longest?",
      TITLE_PT: 14, TITLE_WEIGHT: 700,
      TITLE_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_OFFSET_X: 0, TITLE_OFFSET_Y: -28, TITLE_LETTER_SPACING: 0.2,

      // Left copy (desktop)
      COPY_LEFT_RATIO: 0.035, COPY_TOP_RATIO: 0.18,
      COPY_NUDGE_X: -20, COPY_NUDGE_Y: 0, COPY_MAX_W_PX: 300,
      COPY_H_PT: 20, COPY_H_WEIGHT: 500, COPY_BODY_PT: 11, COPY_BODY_WEIGHT: 400,
      COPY_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_LINE_HEIGHT: 1.6,

      // Animation & colors
      STROKE_PX: 2.8, GLOW_PX: 16, FLOW_SPEED_S: 6.5, REDUCE_MOTION: false,
      COLOR_CYAN: "rgba(99,211,255,0.95)", COLOR_GOLD: "rgba(242,220,160,0.92)",

      // Dots
      DOTS_COUNT: 3, DOTS_SIZE_PX: 2.2, DOTS_GAP_PX: 26, DOTS_Y_OFFSET: 26,

      // ===== MOBILE (phones only; desktop unaffected) =====
      MOBILE_BREAKPOINT: 640,
      M_MAX_W: 520, M_SIDE_PAD: 16, M_STACK_GAP: 14,
      M_BOX_MIN_H: 56, M_BORDER_PX: 2, M_FONT_PT: 11,
      M_TITLE_PT: 16, M_COPY_H_PT: 22, M_COPY_BODY_PT: 14,

      // NEW: inter-step spacing for phones, same idea as step1
      M_SECTION_TOP: 40,
      M_SECTION_BOTTOM: 72,

      // Shape sizes (desktop + mobile)
      CIRCLE_DESKTOP_DIAM_RATIO: 0.10,
      CIRCLE_MOBILE_DIAM_PX: 96,

      // ===== Labels / copy =====
      TITLE_SEO: "Who becomes a long-term customer?",
      COPY_SEO_HTML:
        '<h3>Who becomes a long-term customer?</h3>\
         <p>Our <b>Weight Score</b> estimates retention by combining several signals:\
         how much the product depends on packaging, how deeply packaging is embedded in operations,\
         reorder cadence & SKU velocity, and the risk of switching due to specs, approvals, or compliance.\
         It highlights accounts likely to stay and grow — not just click.</p>',

      ITEMS: [
        { type: "circle", label: "Product-Packaging Reliance", circleDiamRatio: null, fontPt: null },
        { type: "pill",   label: "Ops Lock-In (lines/specs)",  heightRatio: null, fontPt: null },
        { type: "rect",   label: "Cadence & SKU Velocity",     heightRatio: null, fontPt: null },
        { type: "oval",   label: "Switching Risk / Approvals", heightRatio: null, fontPt: null }
      ]
    };
    for (const k in dflt) if (!(k in root.step3)) root.step3[k] = dflt[k];
    return root.step3;
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

  // -------------------- MOBILE: DOM layout (no rail; prevents nested scroll) --------------------
  function ensureMobileCSS() {
    const id = "p2m-style";
    if (document.getElementById(id)) return;

    const s = document.createElement("style"); s.id = id;
    const bp = C().MOBILE_BREAKPOINT;
    const cyan = C().COLOR_CYAN;

    s.textContent =
      "@media (max-width:" + bp + "px){" +
      "  html,body,#section-process{overflow-x:hidden}" +
      // same spacing philosophy as step1 (distinct class .s2 so it only affects step2)
      "  #section-process .p2m-wrap.s2{position:relative;margin:" + C().M_SECTION_TOP + "px auto " + C().M_SECTION_BOTTOM + "px !important;max-width:" + C().M_MAX_W + "px;padding:0 " + C().M_SIDE_PAD + "px 12px;z-index:0}" +
      "  .p2m-title{text-align:center;color:#ddeaef;font:" + C().TITLE_WEIGHT + " " + C().M_TITLE_PT + "pt " + C().TITLE_FAMILY + ";letter-spacing:" + C().TITLE_LETTER_SPACING + "px;margin:6px 0 10px}" +
      "  .p2m-copy{margin:0 auto 14px;color:#a7bacb}" +
      "  .p2m-copy h3{margin:0 0 8px;color:#eaf0f6;font:600 " + C().M_COPY_H_PT + "px Newsreader, Georgia, serif}" +
      "  .p2m-copy p{margin:0;font:400 " + C().M_COPY_BODY_PT + "px/1.55 Inter, system-ui}" +
      "  .p2m-stack{display:flex;flex-direction:column;align-items:center;gap:" + C().M_STACK_GAP + "px}" +
      "  .p2m-box{width:100%;min-height:" + C().M_BOX_MIN_H + "px;border:" + C().M_BORDER_PX + "px solid " + cyan + ";border-radius:14px;padding:10px 12px;display:flex;align-items:center;justify-content:center;text-align:center;color:#ddeaef;background:rgba(255,255,255,.02);font:" + C().FONT_WEIGHT_BOX + " " + C().M_FONT_PT + "pt " + C().FONT_FAMILY_BOX + ";letter-spacing:" + C().FONT_LETTER_SPACING + "px;line-height:" + C().LINE_HEIGHT_EM + "em}" +
      "  .p2m-oval{border-radius:9999px}" +
      "  .p2m-circle{width:" + C().CIRCLE_MOBILE_DIAM_PX + "px;height:" + C().CIRCLE_MOBILE_DIAM_PX + "px;border:" + C().M_BORDER_PX + "px solid " + cyan + ";border-radius:9999px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.02);color:#ddeaef;text-align:center;padding:6px;font:" + C().FONT_WEIGHT_BOX + " " + C().M_FONT_PT + "pt " + C().FONT_FAMILY_BOX + ";letter-spacing:" + C().FONT_LETTER_SPACING + "px;line-height:" + C().LINE_HEIGHT_EM + "em}" +
      "  .p2m-dots{display:flex;gap:14px;justify-content:center;padding-top:8px}" +
      "  .p2m-dots i{width:6px;height:6px;border-radius:50%;background:" + cyan + ";display:inline-block}" +
      "}";
    document.head.appendChild(s);
  }

  function drawMobile(ctx) {
    ensureMobileCSS();

    // let the canvas flow with the page (prevents the “scroll-inside-scroll” trap)
    ctx.canvas.style.position = "relative";
    ctx.canvas.style.inset = "auto";
    ctx.canvas.style.pointerEvents = "auto";

    const wrap = document.createElement("div");
    wrap.className = "p2m-wrap s2";

    wrap.innerHTML =
      (C().TITLE_SHOW ? '<div class="p2m-title">' + C().TITLE_TEXT + "</div>" : "") +
      '<div class="p2m-copy">' + C().COPY_SEO_HTML + "</div>" +
      '<div class="p2m-stack">' +
      // circle first
      '<div class="p2m-circle">' + C().ITEMS[0].label + "</div>" +
      // pill / rect / oval
      '<div class="p2m-box">' + C().ITEMS[1].label + "</div>" +
      '<div class="p2m-box">' + C().ITEMS[2].label + "</div>" +
      '<div class="p2m-box p2m-oval">' + C().ITEMS[3].label + "</div>" +
      '<div class="p2m-dots"><i></i><i></i><i></i></div>' +
      "</div>";

    ctx.canvas.appendChild(wrap);
  }

  // -------------------- DESKTOP: identical behavior to Step 1 --------------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx) {
    const b = ctx.bounds;
    const isMobile = (window.PROCESS_FORCE_MOBILE === true) || (window.innerWidth <= C().MOBILE_BREAKPOINT);

    if (isMobile) { drawMobile(ctx); return; }

    // DESKTOP: keep original rail + right-side visuals layout
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

    // 1: circle
    {
      const diam = (C().ITEMS[0].circleDiamRatio || C().CIRCLE_DESKTOP_DIAM_RATIO) * W;
      const r = diam / 2;
      const cx = x + boxW / 2;
      const cy = y + r;
      addCircle(svg, cx, cy, r, "url(#gradFlow)", C().STROKE_PX);
      addFO(svg, cx - r, cy - r, diam, diam, C().ITEMS[0].label, {
        font: `${C().FONT_WEIGHT_BOX} ${C().FONT_PT_CIRCLE}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing: `${C().FONT_LETTER_SPACING}px`, lineHeight: `${C().LINE_HEIGHT_EM}em`,
        padding: "3px 4px"
      });
      itemsDrawn.push({ x: cx - r, y: cy - r, w: diam, h: diam, cx, cy });
      y += diam + gap;
    }
    // 2: pill
    {
      const h = boxH * (C().ITEMS[1].heightRatio || 1);
      addPath(svg, rr(x, y, boxW, h, C().RADIUS_PILL), "url(#gradFlow)", C().STROKE_PX);
      addFO(svg, x, y, boxW, h, C().ITEMS[1].label, {
        font: `${C().FONT_WEIGHT_BOX} ${C().FONT_PT_BOX}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing: `${C().FONT_LETTER_SPACING}px`, lineHeight: `${C().LINE_HEIGHT_EM}em`,
        padding: `${C().PADDING_Y}px ${C().PADDING_X}px`
      });
      itemsDrawn.push({ x, y, w: boxW, h }); y += h + gap;
    }
    // 3: rect
    {
      const h = boxH * (C().ITEMS[2].heightRatio || 1);
      addPath(svg, rr(x, y, boxW, h, C().RADIUS_RECT), "url(#gradFlow)", C().STROKE_PX);
      addFO(svg, x, y, boxW, h, C().ITEMS[2].label, {
        font: `${C().FONT_WEIGHT_BOX} ${C().FONT_PT_BOX}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing: `${C().FONT_LETTER_SPACING}px`, lineHeight: `${C().LINE_HEIGHT_EM}em`,
        padding: `${C().PADDING_Y}px ${C().PADDING_X}px`
      });
      itemsDrawn.push({ x, y, w: boxW, h }); y += h + gap;
    }
    // 4: oval
    {
      const h = boxH * (C().ITEMS[3].heightRatio || 1);
      addPath(svg, rr(x, y, boxW, h, C().RADIUS_OVAL), "url(#gradFlow)", C().STROKE_PX);
      addFO(svg, x, y, boxW, h, C().ITEMS[3].label, {
        font: `${C().FONT_WEIGHT_BOX} ${C().FONT_PT_BOX}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing: `${C().FONT_LETTER_SPACING}px`, lineHeight: `${C().LINE_HEIGHT_EM}em`,
        padding: `${C().PADDING_Y}px ${C().PADDING_X}px`
      });
      itemsDrawn.push({ x, y, w: boxW, h }); y += h + C().DOTS_Y_OFFSET;
    }

    // dots
    if (C().DOTS_COUNT > 0) {
      const centerX = x + boxW / 2; let dotY = y;
      for (let i = 0; i < C().DOTS_COUNT; i++) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", centerX); c.setAttribute("cy", dotY);
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
      t.setAttribute("x", (topBox.x + topBox.w / 2) + C().TITLE_OFFSET_X);
      t.setAttribute("y", (topBox.y) + C().TITLE_OFFSET_Y);
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
