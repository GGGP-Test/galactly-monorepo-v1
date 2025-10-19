// sections/process/steps/process.step1.js
(() => {
  const STEP = 1;
  const NS = "http://www.w3.org/2000/svg";

  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step1 = root.step1 || {};
    const dflt = {
      // desktop knobs (unchanged) …
      BOX_W_RATIO: 0.10, BOX_H_RATIO: 0.12, GAP_RATIO: 0.035,
      STACK_X_RATIO: 0.705, STACK_TOP_RATIO: 0.21, NUDGE_X: -230, NUDGE_Y: -20,
      RADIUS_RECT: 18, RADIUS_PILL: 18, RADIUS_OVAL: 999, DIAMOND_SCALE: 1.2,
      SHOW_LEFT_LINE: true, SHOW_RIGHT_LINE: true,
      LEFT_STOP_RATIO: 0.35, RIGHT_MARGIN_PX: 16,
      H_LINE_Y_BIAS: -0.06, CONNECT_X_PAD: 8, LINE_STROKE_PX: 2.5,
      FONT_PT_PILL: 8, FONT_PT_ROUND: 8, FONT_PT_OVAL: 8, FONT_PT_DIAMOND: 7,
      FONT_WEIGHT_BOX: 525,
      FONT_FAMILY_BOX: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      FONT_LETTER_SPACING: 0.3, LINE_HEIGHT_EM: 1.15,
      PADDING_X: 4, PADDING_Y: 4, UPPERCASE: false,
      LABEL_RECT_1: "Back-To-Back Search (last 14d)",
      LABEL_RECT_2: "RFQ/RFP Keywords Detected",
      LABEL_ROUND_3: "Pricing & Sample Page Hits",
      LABEL_OVAL_4:  "Rising # of Ad Creatives (last 14d)",
      LABEL_DIAMOND_5: "Import/Export End of Cycle",
      TITLE_SHOW: true, TITLE_TEXT: "Time-to-Buy Intent",
      TITLE_PT: 14, TITLE_WEIGHT: 700,
      TITLE_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_OFFSET_X: 0, TITLE_OFFSET_Y: -28, TITLE_LETTER_SPACING: 0.2,
      COPY_LEFT_RATIO: 0.035, COPY_TOP_RATIO: 0.18, COPY_NUDGE_X: 0, COPY_NUDGE_Y: 0,
      COPY_MAX_W_PX: 300, COPY_H_PT: 24, COPY_H_WEIGHT: 500,
      COPY_BODY_PT: 12, COPY_BODY_WEIGHT: 400, COPY_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_LINE_HEIGHT: 1.6,
      STROKE_PX: 2.8, GLOW_PX: 16, FLOW_SPEED_S: 6.5,
      COLOR_CYAN: "rgba(99,211,255,0.95)", COLOR_GOLD: "rgba(242,220,160,0.92)",
      REDUCE_MOTION: false,
      DOTS_COUNT: 3, DOTS_SIZE_PX: 2.2, DOTS_GAP_PX: 26, DOTS_Y_OFFSET: 26,

      // ===== MOBILE knobs (phones/tablets) =====
      MOBILE_BREAKPOINT: 640,
      M_MAX_W: 520, M_SIDE_PAD: 16,
      M_STACK_GAP: 44, M_BOX_MIN_H: 56,
      M_BORDER_PX: 2, M_FONT_PT: 11,
      M_TITLE_PT: 16, M_COPY_H_PT: 22, M_COPY_BODY_PT: 14,

      // >>> new: section spacing knobs (mobile-only)
      M_SECTION_MARGIN_BOTTOM: 48,     // you tweak this freely
      M_TITLE_MARGIN_BOTTOM: 10,
      M_COPY_MARGIN_BOTTOM: 14
    };
    for (const k in dflt) if (!(k in root.step1)) root.step1[k] = dflt[k];
    return root.step1;
  }

  const reduceMotion = () =>
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || C().REDUCE_MOTION;

  // --- helpers (unchanged desktop) ---
  function makeFlowGradients(svg, { spanX, y }) { /* …unchanged… */ }
  function makeSegmentGradient(svg, x1, y, x2) { /* …unchanged… */ }
  const rr = (x,y,w,h,r) => { /* …unchanged… */ };
  const diamond = (cx,cy,w,h) => { /* …unchanged… */ };
  function addPath(svg, d, stroke, sw){ /* …unchanged… */ }
  function addFO(svg, x,y,w,h, html, styles){ /* …unchanged… */ }

  // --- MOBILE CSS (no margins here that could fight inline values) ---
  function ensureMobileCSS() {
    const id = "p1m-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style"); s.id = id;
    const bp = C().MOBILE_BREAKPOINT;
    const cyan = C().COLOR_CYAN;
    s.textContent = `
      @media (max-width:${bp}px){
        html, body, #section-process { overflow-x:hidden; }
        .p1m-wrap{ position:relative; max-width:${C().M_MAX_W}px; padding:0 ${C().M_SIDE_PAD}px 8px; margin:0 auto; }
        .p1m-title{
          text-align:center; color:#ddeaef;
          font:${C().TITLE_WEIGHT} ${C().M_TITLE_PT}pt ${C().TITLE_FAMILY};
          letter-spacing:${C().TITLE_LETTER_SPACING}px; margin:6px 0 ${C().M_TITLE_MARGIN_BOTTOM}px;
        }
        .p1m-copy{ margin:0 auto ${C().M_COPY_MARGIN_BOTTOM}px; color:#a7bacb; }
        .p1m-copy h3{ margin:0 0 8px; color:#eaf0f6; font:600 ${C().M_COPY_H_PT}px "Newsreader", Georgia, serif; }
        .p1m-copy p { margin:0; font:400 ${C().M_COPY_BODY_PT}px/1.55 Inter, system-ui; }

        .p1m-stack{ display:flex; flex-direction:column; align-items:center; gap:${C().M_STACK_GAP}px; }
        .p1m-box{
          width:100%; min-height:${C().M_BOX_MIN_H}px;
          border:${C().M_BORDER_PX}px solid ${cyan}; border-radius:14px;
          padding:10px 12px; display:flex; align-items:center; justify-content:center;
          text-align:center; color:#ddeaef; background:rgba(255,255,255,.02);
          font:${C().FONT_WEIGHT_BOX} ${C().M_FONT_PT}pt ${C().FONT_FAMILY_BOX};
          letter-spacing:${C().FONT_LETTER_SPACING}px; line-height:${C().LINE_HEIGHT_EM}em;
        }
        .p1m-box.oval{ border-radius:9999px }
        .p1m-diamond{
          width:45%; aspect-ratio:1/1; border:${C().M_BORDER_PX}px solid ${cyan};
          transform:rotate(45deg); background:rgba(255,255,255,.02); margin-top:2px;
          display:flex; align-items:center; justify-content:center;
        }
        .p1m-diamond > span{
          transform:rotate(-45deg); display:flex; align-items:center; justify-content:center;
          width:70%; height:70%; text-align:center; color:#ddeaef;
          font:${C().FONT_WEIGHT_BOX} ${Math.max(8, C().M_FONT_PT - 1)}pt ${C().FONT_FAMILY_BOX};
          letter-spacing:${C().FONT_LETTER_SPACING}px; line-height:${C().LINE_HEIGHT_EM}em;
          padding:10px 12px;
        }
        .p1m-dots{ display:flex; gap:14px; justify-content:center; padding-top:6px }
        .p1m-dots i{ width:6px; height:6px; border-radius:50%; background:${cyan}; display:inline-block; }
      }`;
    document.head.appendChild(s);
  }

  // --- MOBILE DRAW: now honors ctx.bounds.top via inline margin ---
  function drawMobile(ctx) {
    ensureMobileCSS();

    ctx.canvas.style.position = "relative";
    ctx.canvas.style.inset = "auto";
    ctx.canvas.style.pointerEvents = "auto";

    const wrap = document.createElement("div");
    wrap.className = "p1m-wrap";
    wrap.setAttribute("data-process-step", String(STEP));

    // respect the offset passed in from process.js mobile stack
    const topOffset = Math.max(0, (ctx && ctx.bounds && ctx.bounds.top) || 0);
    wrap.style.marginTop = topOffset + "px";                               // <<< key fix
    wrap.style.marginBottom = C().M_SECTION_MARGIN_BOTTOM + "px";          // your knob

    const copyHTML = `
      <h3>Who’s ready now?</h3>
      <p>Our <b>Time-to-Buy Intent</b> finds accounts most likely to purchase in the next cycle.
      We weight <b>recent</b> signals like search bursts, RFQ/RFP language, visits to pricing & sample pages,
      and events/trade shows activities, new product launches, new product shelf openings at big wholesalers and 38 more metrics, then surface the prospects your team should contact today.</p>`;

    wrap.innerHTML = `
      ${C().TITLE_SHOW ? `<div class="p1m-title">${C().TITLE_TEXT}</div>` : ``}
      <div class="p1m-copy">${copyHTML}</div>
      <div class="p1m-stack">
        <div class="p1m-box">${C().LABEL_RECT_1}</div>
        <div class="p1m-box">${C().LABEL_RECT_2}</div>
        <div class="p1m-box">${C().LABEL_ROUND_3}</div>
        <div class="p1m-box oval">${C().LABEL_OVAL_4}</div>
        <div class="p1m-diamond"><span>${C().LABEL_DIAMOND_5}</span></div>
        <div class="p1m-dots"><i></i><i></i><i></i></div>
      </div>
    `;

    ctx.canvas.appendChild(wrap);
  }

  // --- DESKTOP DRAW (unchanged) ---
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx){
    const b = ctx.bounds;
    const isMobile = (window.PROCESS_FORCE_MOBILE === true) ||
                     (window.innerWidth <= C().MOBILE_BREAKPOINT);
    if (isMobile) return drawMobile(ctx);

    // …desktop SVG, unchanged…
    /* (keep your original desktop code here exactly as before) */
  };
})();