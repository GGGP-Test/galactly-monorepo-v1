// sections/process/steps/process.step1.js
(() => {
  // Register step 1 scene. process.js calls this with { ns, canvas, bounds(), ... }
  const STEP = 1;

  // Safe defaults so the scene works even if knobs were never set
  const DEF = {
    BOX_W_RATIO: 0.095, BOX_H_RATIO: 0.22, GAP_RATIO: 0.075,
    STACK_X_RATIO: 0.705, STACK_TOP_RATIO: 0.21, NUDGE_X: 0, NUDGE_Y: 0,
    RADIUS_RECT: 18, RADIUS_PILL: 18, RADIUS_OVAL: 999, DIAMOND_SCALE: 0.80,
    SHOW_RECT_1: true, SHOW_RECT_2: true, SHOW_ROUND_3: true, SHOW_OVAL_4: true, SHOW_DIAMOND_5: true,
    DOTS_COUNT: 3, DOTS_SIZE_PX: 5.5, DOTS_GAP_PX: 12, DOTS_Y_OFFSET: 10,

    LEFT_STOP_RATIO: 0.365, RIGHT_MARGIN_PX: 12, H_LINE_Y_BIAS: -0.06, CONNECT_X_PAD: 8,
    LINE_STROKE_PX: 2.0, LINE_GLOW_PX: 14, SHOW_LEFT_LINE: true, SHOW_RIGHT_LINE: true,

    FONT_PT: 12, FONT_PT_PILL: 12, FONT_PT_ROUND: 12, FONT_PT_OVAL: 12, FONT_PT_DIAMOND: 11,
    FONT_FAMILY_BOX: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    FONT_WEIGHT_BOX: 800, FONT_LETTER_SPACING: 0.2, LINE_HEIGHT_EM: 1.05,
    PADDING_X: 12, PADDING_Y: 10, UPPERCASE: false,

    LABEL_RECT_1: "Number of Searches / TimeBlock",
    LABEL_RECT_2: "Technologies used at the location",
    LABEL_ROUND_3:"Number of customers based on LTV/CAC",
    LABEL_OVAL_4: "Tools interacted",
    LABEL_DIAMOND_5:"Company Size",

    TITLE_SHOW: true, TITLE_TEXT: "Intent score factors",
    TITLE_PT: 14, TITLE_WEIGHT: 700,
    TITLE_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    TITLE_OFFSET_X: -8, TITLE_OFFSET_Y: -18, TITLE_LETTER_SPACING: 0.2,

    COPY_LEFT_RATIO: 0.035, COPY_TOP_RATIO: 0.18, COPY_NUDGE_X: 0, COPY_NUDGE_Y: 0, COPY_MAX_W_PX: 300,
    COPY_H_PT: 26, COPY_H_WEIGHT: 600, COPY_BODY_PT: 15, COPY_BODY_WEIGHT: 400,
    COPY_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    COPY_LINE_HEIGHT: 1.6,

    STROKE_PX: 2.2, GLOW_PX: 16, FLOW_SPEED_S: 6.5,
    COLOR_CYAN: "rgba(99,211,255,0.95)", COLOR_GOLD: "rgba(242,220,160,0.92)",
    REDUCE_MOTION: false,

    BP_MED_W: 900, BP_MED_SCALE: 0.92,
    BP_SMALL_W: 640, BP_SMALL_SCALE: 0.84,
    BP_SMALL_FONT_PT: { PILL: 11, ROUND: 11, OVAL: 11, DIAMOND: 10 }
  };

  function getC(){
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step1 = root.step1 || {};
    // shallow fill
    for (const k in DEF) if (!(k in root.step1)) root.step1[k] = DEF[k];
    return root.step1;
  }

  // Helpers
  const NS = "http://www.w3.org/2000/svg";
  const prefersReduced = () =>
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || getC().REDUCE_MOTION;

  function makeFlowGradients(svg, { x1, y1, x2, y2, speedSec }){
    const defs = document.createElementNS(NS,"defs");
    const grad = document.createElementNS(NS,"linearGradient");
    grad.id = "gradFlowStep1";
    grad.setAttribute("gradientUnits","userSpaceOnUse");
    grad.setAttribute("x1", x1); grad.setAttribute("y1", y1);
    grad.setAttribute("x2", x2); grad.setAttribute("y2", y2);

    const C = getC();
    const stops = [
      ["0%",  C.COLOR_GOLD],
      ["35%", "rgba(255,255,255,.95)"],
      ["75%", C.COLOR_CYAN],
      ["100%", "rgba(99,211,255,.60)"]
    ];
    stops.forEach(([o, col]) => {
      const s = document.createElementNS(NS,"stop");
      s.setAttribute("offset", o); s.setAttribute("stop-color", col); grad.appendChild(s);
    });

    if (!prefersReduced() && speedSec>0){
      const anim = document.createElementNS(NS,"animateTransform");
      anim.setAttribute("attributeName","gradientTransform");
      anim.setAttribute("type","translate");
      anim.setAttribute("from","0 0");
      anim.setAttribute("to", `${(x2-x1)} 0`);
      anim.setAttribute("dur", `${speedSec}s`);
      anim.setAttribute("repeatCount","indefinite");
      grad.appendChild(anim);
    }
    defs.appendChild(grad);

    const trail = document.createElementNS(NS,"linearGradient");
    trail.id = "gradTrailStep1";
    trail.setAttribute("gradientUnits","userSpaceOnUse");
    trail.setAttribute("x1", x2); trail.setAttribute("y1", y1);
    trail.setAttribute("x2", x2 + Math.abs(x2-x1)); trail.setAttribute("y2", y1);

    [["0%", C.COLOR_GOLD],["45%",C.COLOR_CYAN],["100%","rgba(99,211,255,.18)"]]
      .forEach(([o, col]) => { const s=document.createElementNS(NS,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",col); trail.appendChild(s); });

    if (!prefersReduced() && speedSec>0){
      const anim2 = document.createElementNS(NS,"animateTransform");
      anim2.setAttribute("attributeName","gradientTransform");
      anim2.setAttribute("type","translate");
      anim2.setAttribute("from","0 0");
      anim2.setAttribute("to", `${Math.abs(x2-x1)} 0`);
      anim2.setAttribute("dur", `${speedSec}s`);
      anim2.setAttribute("repeatCount","indefinite");
      trail.appendChild(anim2);
    }
    defs.appendChild(trail);
    svg.appendChild(defs);
  }

  function addPath(svg, d, stroke, strokeWidth){
    const p = document.createElementNS(NS,"path");
    p.setAttribute("d", d);
    p.setAttribute("fill","none");
    p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", strokeWidth);
    p.setAttribute("stroke-linejoin","round");
    p.setAttribute("stroke-linecap","round");
    p.setAttribute("class","glow");
    return svg.appendChild(p), p;
  }

  function addRoundedRectPath(x,y,w,h,r){
    const rr = Math.min(r, Math.min(w,h)/2);
    return `M ${x+rr} ${y}
            H ${x+w-rr} Q ${x+w} ${y} ${x+w} ${y+rr}
            V ${y+h-rr} Q ${x+w} ${y+h} ${x+w-rr} ${y+h}
            H ${x+rr}   Q ${x}   ${y+h} ${x}   ${y+h-rr}
            V ${y+rr}   Q ${x}   ${y}   ${x+rr} ${y} Z`;
  }

  function addDiamondPath(cx,cy,w,h){
    const hw=w/2, hh=h/2;
    return `M ${cx} ${cy-hh} L ${cx+hw} ${cy} L ${cx} ${cy+hh} L ${cx-hw} ${cy} Z`;
  }

  function addForeignLabel(svg, x,y,w,h, html, styles){
    const fo = document.createElementNS(NS,"foreignObject");
    fo.setAttribute("x", x); fo.setAttribute("y", y);
    fo.setAttribute("width", w); fo.setAttribute("height", h);
    const div = document.createElement("div");
    div.setAttribute("xmlns","http://www.w3.org/1999/xhtml");
    Object.assign(div.style, {
      width: "100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center",
      textAlign:"center", color:"#ddeaef", pointerEvents:"none",
      whiteSpace:"pre-wrap", wordBreak:"break-word"
    }, styles||{});
    div.innerHTML = html;
    fo.appendChild(div);
    svg.appendChild(fo);
  }

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  // Scene renderer
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx){
    const C = getC();
    const b = ctx.bounds;           // {left,width,top,sH,...}
    const W = b.width;
    const H = Math.min(560, b.sH - 40);

    // Create SVG stage
    const svg = document.createElementNS(NS,"svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    ctx.canvas.appendChild(svg);

    // Responsiveness
    let scale = 1;
    const sw = b.sW || (b.sLeft + b.width); // rough
    if (sw < C.BP_MED_W)   scale *= C.BP_MED_SCALE;
    if (sw < C.BP_SMALL_W) scale *= C.BP_SMALL_SCALE;

    const boxW = W * C.BOX_W_RATIO * scale;
    const boxH = H * C.BOX_H_RATIO * scale;
    const gap  = H * C.GAP_RATIO * scale;

    let stackX = W * C.STACK_X_RATIO + C.NUDGE_X;
    let stackY = H * C.STACK_TOP_RATIO + C.NUDGE_Y;

    // Flow gradients shared by shapes + rails
    makeFlowGradients(svg, { x1: 0, y1: 0, x2: boxW, y2: 0, speedSec: C.FLOW_SPEED_S });

    // Shapes (x is center-aligned)
    const cx = stackX + boxW/2;
    let y = stackY;

    const items = [];

    function pushRounded(label, r, fontPt){
      const x = stackX, h = boxH;
      const d = addRoundedRectPath(x, y, boxW, h, r);
      addPath(svg, d, "url(#gradFlowStep1)", C.STROKE_PX);
      // label via foreignObject (wrapping + padding)
      const pt = fontPt || C.FONT_PT_PILL;
      const styles = {
        font: `${C.FONT_WEIGHT_BOX} ${pt}pt ${C.FONT_FAMILY_BOX}`,
        letterSpacing: `${C.FONT_LETTER_SPACING}px`,
        lineHeight: `${C.LINE_HEIGHT_EM}em`,
        textTransform: C.UPPERCASE? "uppercase" : "none",
        padding: `${C.PADDING_Y}px ${C.PADDING_X}px`
      };
      addForeignLabel(svg, x, y, boxW, h, label, styles);
      items.push({ x, y, w:boxW, h });
      y += h + gap;
    }

    function pushOval(label, fontPt){
      const x = stackX, h = boxH;
      const d = addRoundedRectPath(x, y, boxW, h, C.RADIUS_OVAL);
      addPath(svg, d, "url(#gradFlowStep1)", C.STROKE_PX);
      const pt = fontPt || C.FONT_PT_OVAL;
      const styles = {
        font: `${C.FONT_WEIGHT_BOX} ${pt}pt ${C.FONT_FAMILY_BOX}`,
        letterSpacing: `${C.FONT_LETTER_SPACING}px`,
        lineHeight: `${C.LINE_HEIGHT_EM}em`,
        textTransform: C.UPPERCASE? "uppercase" : "none",
        padding: `${C.PADDING_Y}px ${C.PADDING_X}px`
      };
      addForeignLabel(svg, x, y, boxW, h, label, styles);
      items.push({ x, y, w:boxW, h });
      y += h + gap;
    }

    function pushDiamond(label, fontPt){
      const h = boxH * C.DIAMOND_SCALE;
      const d = addDiamondPath(cx, y + h/2, boxW, h);
      addPath(svg, d, "url(#gradFlowStep1)", C.STROKE_PX);
      const pt = fontPt || C.FONT_PT_DIAMOND;
      const styles = {
        font: `${C.FONT_WEIGHT_BOX} ${pt}pt ${C.FONT_FAMILY_BOX}`,
        letterSpacing: `${C.FONT_LETTER_SPACING}px`,
        lineHeight: `${C.LINE_HEIGHT_EM}em`,
        textTransform: C.UPPERCASE? "uppercase" : "none",
        padding: `${Math.max(4,C.PADDING_Y-2)}px ${C.PADDING_X}px`
      };
      // foreignObject area for diamond: use its bbox rectangle
      addForeignLabel(svg, stackX, y, boxW, h, label, styles);
      items.push({ x: stackX, y, w:boxW, h });
      y += h + gap;
    }

    // 1 rect, 2 rect, 3 rounded, 4 oval, 5 diamond
    if (C.SHOW_RECT_1)   pushRounded(C.LABEL_RECT_1, C.RADIUS_RECT,  C.FONT_PT_PILL);
    if (C.SHOW_RECT_2)   pushRounded(C.LABEL_RECT_2, C.RADIUS_PILL,  C.FONT_PT_PILL);
    if (C.SHOW_ROUND_3)  pushRounded(C.LABEL_ROUND_3, C.RADIUS_PILL, C.FONT_PT_ROUND);
    if (C.SHOW_OVAL_4)   pushOval   (C.LABEL_OVAL_4,  C.FONT_PT_OVAL);
    const lastItemTop = y;
    if (C.SHOW_DIAMOND_5) pushDiamond(C.LABEL_DIAMOND_5, C.FONT_PT_DIAMOND);

    // Dots under diamond
    if (C.DOTS_COUNT>0 && items.length){
      const last = items[items.length-1];
      const cxDot = last.x + last.w/2;
      let dy = last.y + last.h + C.DOTS_Y_OFFSET;
      for (let i=0;i<C.DOTS_COUNT;i++){
        const c = document.createElementNS(NS,"circle");
        c.setAttribute("cx", cxDot);
        c.setAttribute("cy", dy);
        c.setAttribute("r", C.DOTS_SIZE_PX);
        c.setAttribute("fill", C.COLOR_GOLD);
        c.setAttribute("class","glow");
        svg.appendChild(c);
        dy += C.DOTS_GAP_PX;
      }
    }

    // Title above stack
    if (C.TITLE_SHOW && items.length){
      const topBox = items[0];
      const tx = topBox.x + topBox.w/2 + C.TITLE_OFFSET_X;
      const ty = topBox.y + C.TITLE_OFFSET_Y;
      const t = document.createElementNS(NS,"text");
      t.setAttribute("x", tx); t.setAttribute("y", ty);
      t.setAttribute("text-anchor","middle");
      t.setAttribute("fill","#ddeaef");
      t.setAttribute("font-family", C.TITLE_FAMILY);
      t.setAttribute("font-weight", C.TITLE_WEIGHT);
      t.setAttribute("font-size", `${C.TITLE_PT}pt`);
      t.textContent = C.TITLE_TEXT;
      t.style.letterSpacing = `${C.TITLE_LETTER_SPACING}px`;
      svg.appendChild(t);
    }

    // Rails (left/right) — anchor to the first box center (won’t pierce stroke)
    if (items.length){
      const first = items[0];
      const yAttach = first.y + first.h * (0.5 + C.H_LINE_Y_BIAS);
      // left
      if (C.SHOW_LEFT_LINE){
        const xStart = W * clamp(C.LEFT_STOP_RATIO, 0, 1);
        const xEnd   = first.x - C.CONNECT_X_PAD;
        const d = `M ${xStart} ${yAttach} H ${xEnd}`;
        addPath(svg, d, "url(#gradTrailStep1)", C.LINE_STROKE_PX);
      }
      // right
      if (C.SHOW_RIGHT_LINE){
        const xStart = first.x + first.w + C.CONNECT_X_PAD;
        const xEnd   = W - C.RIGHT_MARGIN_PX;
        const d = `M ${xStart} ${yAttach} H ${xEnd}`;
        addPath(svg, d, "url(#gradTrailStep1)", C.LINE_STROKE_PX);
      }
    }

    // Copy block (independent coords). Use mountCopy if host provided one.
    const mountCopy = ctx.mountCopy;
    const left = b.left + W * C.COPY_LEFT_RATIO + C.COPY_NUDGE_X;
    const top  = b.top  + H * C.COPY_TOP_RATIO  + C.COPY_NUDGE_Y;

    const copyHTML = `
      <h3>Who buys the fastest?</h3>
      <p>We rank accounts by a live <b>intent score</b> built for packaging suppliers:
      searches per time block, technology on site, customer scale by <b>LTV/CAC</b>,
      tools they interact with, and company size. The score bubbles up buyers most likely to
      convert now so your team prioritizes quotes, samples, and demos that close quickly.</p>
    `;

    if (typeof mountCopy === "function"){
      const el = mountCopy({ top, left, html: copyHTML });
      el.style.maxWidth = `${C.COPY_MAX_W_PX}px`;
      el.style.fontFamily = C.COPY_FAMILY;
      el.querySelector("h3") && (el.querySelector("h3").style.font =
        `${C.COPY_H_WEIGHT} ${C.COPY_H_PT}pt ${C.COPY_FAMILY}`);
      el.querySelector("p") && (el.querySelector("p").style.cssText =
        `font:${C.COPY_BODY_WEIGHT} ${C.COPY_BODY_PT}pt ${C.COPY_FAMILY}; line-height:${C.COPY_LINE_HEIGHT}`);
    } else {
      // fallback
      const div = document.createElement("div");
      div.className = "copy show";
      Object.assign(div.style, { position:"absolute", left:`${left}px`, top:`${top}px`,
        maxWidth:`${C.COPY_MAX_W_PX}px`, pointerEvents:"auto" });
      div.innerHTML = copyHTML;
      ctx.canvas.appendChild(div);
    }
  };
})();