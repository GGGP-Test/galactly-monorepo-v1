// Step 1 – "Who buys the fastest?" (Intent score inputs)
// Works with process.js which calls scene({ bounds: bounds(), ... }) passing an OBJECT.
(() => {
  if (!window.PROCESS_SCENES) return;

  // ---- CONFIG (defaults; override in console via PROCESS_CONFIG.step1.*) ----
  const D = window.PROCESS_CONFIG = window.PROCESS_CONFIG || {};
  const C = D.step1 = Object.assign(
    {
      BOX_W: 220,
      BOX_H: 74,
      GAP:   14,
      FONT_PX: 13,

      // stack (boxes) placement (0..1 across/ down the lamp) + pixel nudges
      STACK_ALIGN: 0.68,
      STACK_TOP_Y_PCT: 0.26,
      NUDGE_X: 0,
      NUDGE_Y: 0,

      // copy (left text) placement — independent of nudges
      COPY_LEFT_PX: 24,
      COPY_TOP_PX:  10,

      // rails
      LINE_MARGIN_FROM_COPY: 14
    },
    D.step1 || {}
  );

  // ---- helpers ----
  const ns = "http://www.w3.org/2000/svg";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const rrectPath = (x,y,w,h,r) =>
    `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;

  const diamondPath = (cx,cy,w,h) => {
    const rx=w/2, ry=h/2;
    return `M ${cx} ${cy-ry} L ${cx+rx} ${cy} L ${cx} ${cy+ry} L ${cx-rx} ${cy} Z`;
  };

  function label(svg, cx, cy, lines, fontPx){
    const t = document.createElementNS(ns,"text");
    t.setAttribute("x", cx);
    t.setAttribute("y", cy);
    t.setAttribute("text-anchor","middle");
    t.setAttribute("dominant-baseline","middle");
    t.setAttribute("fill","#e8f2f9");
    t.setAttribute("font-weight","800");
    t.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
    t.setAttribute("font-size", fontPx);
    if (lines.length<=1){ t.textContent = lines[0] || ""; }
    else{
      const lh = fontPx*1.25;
      t.setAttribute("dy", -(lh*(lines.length-1)/2));
      lines.forEach((txt,i)=>{
        const s=document.createElementNS(ns,"tspan");
        s.setAttribute("x",cx); s.setAttribute("dy", i? lh:0);
        s.textContent = txt; t.appendChild(s);
      });
    }
    svg.appendChild(t);
  }

  // ---- main scene ----
  window.PROCESS_SCENES[1] = ({ canvas, bounds, mountCopy }) => {
    // bounds is an OBJECT from process.js
    const b = bounds;

    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);

    const lampW = b.width;
    const lampH = Math.min(560, b.sH - 40);

    // mild responsive scale tied to lamp width
    const s    = clamp(lampW/520, 0.85, 1.25);
    const BOX_W= Math.round(C.BOX_W*s);
    const BOX_H= Math.round(C.BOX_H*s);
    const GAP  = Math.round(C.GAP*s);
    const FONT = Math.round(C.FONT_PX * clamp(lampW/640, 0.9, 1.15));

    // SVG anchored to lamp
    const svg = document.createElementNS(ns,"svg");
    svg.style.position="absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  lampW);
    svg.setAttribute("height", lampH);
    svg.setAttribute("viewBox", `0 0 ${lampW} ${lampH}`);
    canvas.appendChild(svg);

    // gradients (unique ids for this step)
    const defs = document.createElementNS(ns,"defs");

    const gFlow = document.createElementNS(ns,"linearGradient");
    gFlow.id="s1Flow"; gFlow.setAttribute("gradientUnits","userSpaceOnUse");
    gFlow.setAttribute("x1",0); gFlow.setAttribute("y1",0);
    gFlow.setAttribute("x2",BOX_W); gFlow.setAttribute("y2",0);
    [["0%","rgba(230,195,107,.95)"],["35%","rgba(255,255,255,.95)"],["75%","rgba(99,211,255,.95)"],["100%","rgba(99,211,255,.50)"]]
      .forEach(([o,c])=>{ const st=document.createElementNS(ns,"stop"); st.setAttribute("offset",o); st.setAttribute("stop-color",c); gFlow.appendChild(st); });
    const a1=document.createElementNS(ns,"animateTransform");
    a1.setAttribute("attributeName","gradientTransform"); a1.setAttribute("type","translate");
    a1.setAttribute("from","0 0"); a1.setAttribute("to", `${BOX_W} 0`);
    a1.setAttribute("dur","6s"); a1.setAttribute("repeatCount","indefinite");
    gFlow.appendChild(a1);

    const gTrail=document.createElementNS(ns,"linearGradient");
    gTrail.id="s1Trail"; gTrail.setAttribute("gradientUnits","userSpaceOnUse");
    gTrail.setAttribute("x1",0); gTrail.setAttribute("y1",0);
    gTrail.setAttribute("x2",lampW); gTrail.setAttribute("y2",0);
    [["0%","rgba(230,195,107,.90)"],["45%","rgba(99,211,255,.90)"],["100%","rgba(99,211,255,.18)"]]
      .forEach(([o,c])=>{ const st=document.createElementNS(ns,"stop"); st.setAttribute("offset",o); st.setAttribute("stop-color",c); gTrail.appendChild(st); });
    const a2=document.createElementNS(ns,"animateTransform");
    a2.setAttribute("attributeName","gradientTransform"); a2.setAttribute("type","translate");
    a2.setAttribute("from","0 0"); a2.setAttribute("to", `${lampW} 0`);
    a2.setAttribute("dur","6s"); a2.setAttribute("repeatCount","indefinite");
    gTrail.appendChild(a2);

    defs.appendChild(gFlow); defs.appendChild(gTrail);
    svg.appendChild(defs);

    // stack position (boxes)
    const stackLeft = Math.round(lampW*C.STACK_ALIGN - BOX_W/2 + C.NUDGE_X);
    const firstY    = Math.round(lampH*C.STACK_TOP_Y_PCT + C.NUDGE_Y);
    const strokeW   = 2;

    const addPath = (d) => {
      const p=document.createElementNS(ns,"path");
      p.setAttribute("d",d); p.setAttribute("fill","none");
      p.setAttribute("stroke","url(#s1Flow)"); p.setAttribute("stroke-width", String(strokeW));
      p.setAttribute("stroke-linejoin","round"); p.setAttribute("class","glow");
      svg.appendChild(p); return p;
    };

    // 1
    const y1 = firstY;
    addPath(rrectPath(stackLeft, y1, BOX_W, BOX_H, 12));
    label(svg, stackLeft+BOX_W/2, y1+BOX_H/2, ["Number of Searches /","TimeBlock"], FONT);

    // 2
    const y2 = y1 + BOX_H + GAP;
    addPath(rrectPath(stackLeft, y2, BOX_W, BOX_H, 12));
    label(svg, stackLeft+BOX_W/2, y2+BOX_H/2, ["Technologies used at","the location"], FONT);

    // 3 (extra rounded)
    const y3 = y2 + BOX_H + GAP;
    addPath(rrectPath(stackLeft, y3, BOX_W, BOX_H, Math.min(22, BOX_H/2 - 2)));
    label(svg, stackLeft+BOX_W/2, y3+BOX_H/2, ["Number of customers based on","LTV/CAC"], FONT);

    // 4 (oval)
    const y4 = y3 + BOX_H + GAP;
    const oval = document.createElementNS(ns,"ellipse");
    oval.setAttribute("cx", stackLeft+BOX_W/2); oval.setAttribute("cy", y4+BOX_H/2);
    oval.setAttribute("rx", BOX_W/2); oval.setAttribute("ry", BOX_H/2);
    oval.setAttribute("fill","none"); oval.setAttribute("stroke","url(#s1Flow)");
    oval.setAttribute("stroke-width", String(strokeW)); oval.setAttribute("class","glow");
    svg.appendChild(oval);
    label(svg, stackLeft+BOX_W/2, y4+BOX_H/2, ["Tools interacted"], FONT);

    // 5 (diamond)
    const y5   = y4 + BOX_H + GAP + Math.round(4*s);
    const diaW = BOX_W*0.82, diaH = BOX_H*0.82;
    addPath(diamondPath(stackLeft+BOX_W/2, y5+diaH/2, diaW, diaH));
    label(svg, stackLeft+BOX_W/2, y5+diaH/2, ["Company Size"], FONT);

    // dots
    const dotsY0 = y5 + diaH + Math.round(10*s);
    for(let i=0;i<3;i++){
      const c=document.createElementNS(ns,"circle");
      c.setAttribute("cx", stackLeft+BOX_W/2);
      c.setAttribute("cy", dotsY0 + i*12);
      c.setAttribute("r", 2.2);
      c.setAttribute("fill","rgba(99,211,255,.9)");
      c.style.filter="drop-shadow(0 0 6px rgba(99,211,255,.6)) drop-shadow(0 0 12px rgba(242,220,160,.35))";
      svg.appendChild(c);
    }

    // copy (independent)
    const copy = mountCopy({
      top:  b.top  + C.COPY_TOP_PX,
      left: b.left + C.COPY_LEFT_PX,
      html: `
        <h3>Who buys the fastest?</h3>
        <p>We rank accounts by a live <strong>intent score</strong> built for packaging suppliers:
        searches per time block, technology on site, customer scale by <strong>LTV/CAC</strong>,
        tools they interact with, and company size. The score bubbles up buyers most likely to convert
        <em>now</em> so your team prioritizes quotes, samples, and demos that close quickly.</p>
      `
    });

    // rails — never cross copy or box
    requestAnimationFrame(() => {
      const copyBox = copy.getBoundingClientRect();

      // left rail: stop before copy, then short connector to first box
      const leftY  = y1 + BOX_H/2;
      const xStart = 8;
      const xStop  = Math.max(10, (copyBox.left - C.LINE_MARGIN_FROM_COPY) - b.left);
      const pathL  = document.createElementNS(ns,"path");
      pathL.setAttribute("d", `M ${xStart} ${leftY} H ${xStop} M ${xStop} ${leftY} L ${stackLeft} ${leftY}`);
      pathL.setAttribute("fill","none");
      pathL.setAttribute("stroke","url(#s1Trail)");
      pathL.setAttribute("stroke-width","2.5");
      pathL.setAttribute("stroke-linecap","round");
      pathL.setAttribute("class","glow");
      svg.insertBefore(pathL, svg.firstChild.nextSibling);

      // right rail: from box outer edge to lamp right edge (not through box)
      const x1 = stackLeft + BOX_W + 1;
      const x2 = lampW - 10;
      const pathR = document.createElementNS(ns,"path");
      pathR.setAttribute("d", `M ${x1} ${leftY} H ${x2}`);
      pathR.setAttribute("fill","none");
      pathR.setAttribute("stroke","url(#s1Trail)");
      pathR.setAttribute("stroke-width","2.5");
      pathR.setAttribute("stroke-linecap","round");
      pathR.setAttribute("class","glow");
      svg.appendChild(pathR);
    });
  };
})();