// sections/process/steps/process.step1.js
(() => {
  const STEP = 1;
  const NS = "http://www.w3.org/2000/svg";

  // ---- safe config accessor (does not change your values) ----
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step1 = root.step1 || {};
    return root.step1;
  }
  const prefersReduce = () =>
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || !!C().REDUCE_MOTION;

  // ---- utility: paths & text ----
  function rr(x,y,w,h,r){
    const R = Math.min(r, Math.min(w,h)/2);
    return `M ${x+R} ${y} H ${x+w-R} Q ${x+w} ${y} ${x+w} ${y+R}
            V ${y+h-R} Q ${x+w} ${y+h} ${x+w-R} ${y+h}
            H ${x+R}   Q ${x}   ${y+h} ${x}   ${y+h-R}
            V ${y+R}   Q ${x}   ${y}   ${x+R} ${y} Z`;
  }
  function diamond(cx,cy,w,h){ const hw=w/2, hh=h/2; return `M ${cx} ${cy-hh} L ${cx+hw} ${cy} L ${cx} ${cy+hh} L ${cx-hw} ${cy} Z`; }

  function addPath(svg, d, stroke, sw){
    const p = document.createElementNS(NS,"path");
    p.setAttribute("d", d); p.setAttribute("fill","none");
    p.setAttribute("stroke", stroke); p.setAttribute("stroke-width", sw);
    p.setAttribute("stroke-linejoin","round"); p.setAttribute("stroke-linecap","round");
    p.setAttribute("class","glow"); svg.appendChild(p); return p;
  }
  function addFO(svg, x,y,w,h, html, styles){
    const fo = document.createElementNS(NS,"foreignObject");
    fo.setAttribute("x",x); fo.setAttribute("y",y); fo.setAttribute("width",w); fo.setAttribute("height",h);
    const d = document.createElement("div");
    d.setAttribute("xmlns","http://www.w3.org/1999/xhtml");
    Object.assign(d.style, {
      width:"100%", height:"100%", display:"flex",
      alignItems:"center", justifyContent:"center", textAlign:"center",
      color:"#ddeaef", whiteSpace:"pre-wrap", wordBreak:"break-word",
      pointerEvents:"none"
    }, styles||{});
    d.innerHTML = html; fo.appendChild(d); svg.appendChild(fo);
  }

  // ---- gradients ----
  // Outline gradient (same cyan↔gold look as step 0)
  function mountOutlineGradients(svg, spanX){
    const defs = document.createElementNS(NS,"defs");

    const gFlow = document.createElementNS(NS,"linearGradient");
    gFlow.id = "gradFlow";
    gFlow.setAttribute("gradientUnits","userSpaceOnUse");
    gFlow.setAttribute("x1", 0); gFlow.setAttribute("y1", 0);
    gFlow.setAttribute("x2", spanX); gFlow.setAttribute("y2", 0);
    [["0%", C().COLOR_GOLD],["35%","rgba(255,255,255,.95)"],["75%", C().COLOR_CYAN],["100%","rgba(99,211,255,.60)"]]
      .forEach(([o,c])=>{ const s=document.createElementNS(NS,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gFlow.appendChild(s); });
    if (!prefersReduce() && C().FLOW_SPEED_S>0){
      const a = document.createElementNS(NS,"animateTransform");
      a.setAttribute("attributeName","gradientTransform");
      a.setAttribute("type","translate");
      a.setAttribute("from","0 0"); a.setAttribute("to", `${spanX} 0`);
      a.setAttribute("dur", `${C().FLOW_SPEED_S}s`);
      a.setAttribute("repeatCount","indefinite"); gFlow.appendChild(a);
    }
    defs.appendChild(gFlow);
    svg.appendChild(defs);
  }

  // Per-segment trail gradient whose span equals the *actual line length*.
  // This is the key change: the animation distance == line length, so one full
  // journey happens before repeat.
  function makeTrailGradient(svg, id, x1,y1,x2,y2){
    const defs = svg.querySelector("defs") || svg.appendChild(document.createElementNS(NS,"defs"));
    const len = Math.hypot(x2-x1, y2-y1);

    const g = document.createElementNS(NS,"linearGradient");
    g.id = id;
    g.setAttribute("gradientUnits","userSpaceOnUse");
    g.setAttribute("x1", x1); g.setAttribute("y1", y1);
    g.setAttribute("x2", x2); g.setAttribute("y2", y2);
    [["0%", C().COLOR_GOLD],["45%", C().COLOR_CYAN],["100%","rgba(99,211,255,.18)"]]
      .forEach(([o,c])=>{ const s=document.createElementNS(NS,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); defs.appendChild ? null : 0; g.appendChild(s); });

    if (!prefersReduce() && C().FLOW_SPEED_S>0){
      const anim = document.createElementNS(NS,"animateTransform");
      anim.setAttribute("attributeName","gradientTransform");
      anim.setAttribute("type","translate");
      // Move along the line axis by exactly its length. For vertical segments we
      // translate in Y; for horizontal, in X. For diagonals, both.
      const dx = (x2-x1), dy = (y2-y1);
      anim.setAttribute("from","0 0");
      anim.setAttribute("to", `${dx} ${dy}`);
      anim.setAttribute("dur", `${C().FLOW_SPEED_S}s`);
      anim.setAttribute("repeatCount","indefinite");
      g.appendChild(anim);
    }
    defs.appendChild(g);
    return `url(#${id})`;
  }

  // ---- scene registration ----
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw({ canvas, bounds, mountCopy }){
    const b = bounds; const W = b.width; const H = Math.min(560, b.sH-40);

    const svg = document.createElementNS(NS,"svg");
    svg.style.position="absolute"; svg.style.left=b.left+"px"; svg.style.top=b.top+"px";
    svg.setAttribute("width",W); svg.setAttribute("height",H); svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
    canvas.appendChild(svg);

    // outline gradient matches step 0 look
    mountOutlineGradients(svg, W * 0.15);

    // geometry
    const boxW = W * C().BOX_W_RATIO;
    const boxH = H * C().BOX_H_RATIO;
    const gap  = H * C().GAP_RATIO;
    let x = W * C().STACK_X_RATIO + C().NUDGE_X;
    let y = H * C().STACK_TOP_RATIO + C().NUDGE_Y;
    const cx = x + boxW/2;

    const items = [];

    // 1
    addPath(svg, rr(x,y,boxW,boxH,C().RADIUS_PILL), "url(#gradFlow)", C().STROKE_PX);
    addFO(svg, x,y,boxW,boxH,
      C().LABEL_RECT_1,
      { font:`${C().FONT_WEIGHT_BOX} ${C().FONT_PT_PILL}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing:`${C().FONT_LETTER_SPACING}px`, lineHeight:`${C().LINE_HEIGHT_EM}em`,
        textTransform:C().UPPERCASE?'uppercase':'none', padding:`${C().PADDING_Y}px ${C().PADDING_X}px` });
    items.push({x,y,w:boxW,h:boxH}); y += boxH + gap;

    // 2
    addPath(svg, rr(x,y,boxW,boxH,C().RADIUS_PILL), "url(#gradFlow)", C().STROKE_PX);
    addFO(svg, x,y,boxW,boxH,
      C().LABEL_RECT_2,
      { font:`${C().FONT_WEIGHT_BOX} ${C().FONT_PT_PILL}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing:`${C().FONT_LETTER_SPACING}px`, lineHeight:`${C().LINE_HEIGHT_EM}em`,
        textTransform:C().UPPERCASE?'uppercase':'none', padding:`${C().PADDING_Y}px ${C().PADDING_X}px` });
    items.push({x,y,w:boxW,h:boxH}); y += boxH + gap;

    // 3
    addPath(svg, rr(x,y,boxW,boxH,C().RADIUS_PILL), "url(#gradFlow)", C().STROKE_PX);
    addFO(svg, x,y,boxW,boxH,
      C().LABEL_ROUND_3,
      { font:`${C().FONT_WEIGHT_BOX} ${C().FONT_PT_ROUND}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing:`${C().FONT_LETTER_SPACING}px`, lineHeight:`${C().LINE_HEIGHT_EM}em`,
        textTransform:C().UPPERCASE?'uppercase':'none', padding:`${C().PADDING_Y}px ${C().PADDING_X}px` });
    items.push({x,y,w:boxW,h:boxH}); y += boxH + gap;

    // 4
    addPath(svg, rr(x,y,boxW,boxH,999), "url(#gradFlow)", C().STROKE_PX);
    addFO(svg, x,y,boxW,boxH,
      C().LABEL_OVAL_4,
      { font:`${C().FONT_WEIGHT_BOX} ${C().FONT_PT_OVAL}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing:`${C().FONT_LETTER_SPACING}px`, lineHeight:`${C().LINE_HEIGHT_EM}em`,
        textTransform:C().UPPERCASE?'uppercase':'none', padding:`${C().PADDING_Y}px ${C().PADDING_X}px` });
    items.push({x,y,w:boxW,h:boxH}); y += boxH + gap;

    // 5 (diamond)
    const dh = boxH * C().DIAMOND_SCALE;
    addPath(svg, diamond(cx, y + dh/2, boxW, dh), "url(#gradFlow)", C().STROKE_PX);
    addFO(svg, x,y,boxW,dh,
      C().LABEL_DIAMOND_5,
      { font:`${C().FONT_WEIGHT_BOX} ${C().FONT_PT_DIAMOND}pt ${C().FONT_FAMILY_BOX}`,
        letterSpacing:`${C().FONT_LETTER_SPACING}px`, lineHeight:`${C().LINE_HEIGHT_EM}em`,
        textTransform:C().UPPERCASE?'uppercase':'none', padding:`${Math.max(2,C().PADDING_Y-2)}px ${C().PADDING_X}px` });
    items.push({x,y,w:boxW,h:dh});
    const dotsStartY = y + dh + C().DOTS_Y_OFFSET;

    // title
    if (C().TITLE_SHOW){
      const t = document.createElementNS(NS,"text");
      const top = items[0];
      t.setAttribute("x", top.x + top.w/2 + (C().TITLE_OFFSET_X||0));
      t.setAttribute("y", top.y + (C().TITLE_OFFSET_Y||0));
      t.setAttribute("text-anchor","middle");
      t.setAttribute("fill","#ddeaef");
      t.setAttribute("font-family", C().TITLE_FAMILY);
      t.setAttribute("font-weight", C().TITLE_WEIGHT);
      t.setAttribute("font-size", `${C().TITLE_PT}pt`);
      t.style.letterSpacing = `${C().TITLE_LETTER_SPACING||0}px`;
      t.textContent = C().TITLE_TEXT;
      svg.appendChild(t);
    }

    // three dots (same glow family)
    if (C().DOTS_COUNT>0){
      const cxDots = x + boxW/2;
      let yy = dotsStartY;
      for (let i=0;i<C().DOTS_COUNT;i++){
        const c = document.createElementNS(NS,"circle");
        c.setAttribute("cx", cxDots); c.setAttribute("cy", yy);
        c.setAttribute("r", C().DOTS_SIZE_PX);
        c.setAttribute("fill", C().COLOR_CYAN);
        c.setAttribute("class","glow");
        svg.appendChild(c); yy += C().DOTS_GAP_PX;
      }
    }

    // ---- RAILS anchored to first box edge (flow spans full length) ----
    if (items.length){
      const first = items[0];
      const attachY = first.y + first.h * (0.5 + C().H_LINE_Y_BIAS);

      // LEFT rail
      if (C().SHOW_LEFT_LINE){
        const xs = W * Math.max(0, Math.min(1, C().LEFT_STOP_RATIO));
        const xe = first.x - C().CONNECT_X_PAD;
        const gradL = makeTrailGradient(svg, "gradTrailLeft", xs, attachY, xe, attachY);
        addPath(svg, `M ${xs} ${attachY} H ${xe}`, gradL, C().LINE_STROKE_PX);
      }
      // RIGHT rail
      if (C().SHOW_RIGHT_LINE){
        const xs = first.x + first.w + C().CONNECT_X_PAD;
        const xe = W - C().RIGHT_MARGIN_PX;
        const gradR = makeTrailGradient(svg, "gradTrailRight", xs, attachY, xe, attachY);
        addPath(svg, `M ${xs} ${attachY} H ${xe}`, gradR, C().LINE_STROKE_PX);
      }
    }

    // ---- vertical connectors between boxes (each spans its own full length) ----
    for (let i=0;i<items.length-1;i++){
      const a = items[i], b2 = items[i+1];
      const xMid = a.x + a.w/2;
      const y1 = a.y + a.h + Math.max(2, C().STROKE_PX);
      const y2 = b2.y - Math.max(2, C().STROKE_PX);
      const gradV = makeTrailGradient(svg, `gradTrailV${i}`, xMid, y1, xMid, y2);
      addPath(svg, `M ${xMid} ${y1} V ${y2}`, gradV, C().LINE_STROKE_PX);
    }

    // ---- Copy block (independent coordinates) ----
    const left = b.left + W * (C().COPY_LEFT_RATIO||0) + (C().COPY_NUDGE_X||0);
    const top  = b.top  + H * (C().COPY_TOP_RATIO ||0) + (C().COPY_NUDGE_Y||0);
    const html = `
      <h3>Who buys the fastest?</h3>
      <p>We rank accounts by a live <b>intent score</b> built for packaging suppliers:
      searches per time block, technology on site, customer scale by <b>LTV/CAC</b>,
      tools they interact with, and company size. The score bubbles up buyers most likely to
      convert now so your team prioritizes quotes, samples, and demos that close quickly.</p>`;
    if (typeof mountCopy === "function"){
      const el = mountCopy({ top, left, html });
      el.style.maxWidth = `${C().COPY_MAX_W_PX}px`;
      el.style.fontFamily = C().COPY_FAMILY;
      const h = el.querySelector("h3"); if (h) h.style.font = `${C().COPY_H_WEIGHT} ${C().COPY_H_PT}pt ${C().COPY_FAMILY}`;
      const p = el.querySelector("p"); if (p) p.style.cssText = `font:${C().COPY_BODY_WEIGHT} ${C().COPY_BODY_PT}pt ${C().COPY_FAMILY}; line-height:${C().COPY_LINE_HEIGHT}`;
    } else {
      const div = document.createElement("div");
      div.className="copy show";
      Object.assign(div.style,{position:"absolute",left:`${left}px`,top:`${top}px`,maxWidth:`${C().COPY_MAX_W_PX}px`,pointerEvents:"auto",fontFamily:C().COPY_FAMILY});
      div.innerHTML = html; canvas.appendChild(div);
    }
  };
})();