// Step 1: "Who buys the fastest?"
(() => {
  const NS = "http://www.w3.org/2000/svg";

  // --- defaults (safe if process.js didn't define them yet) ---
  const DEF = {
    // layout (all ratios measured against lamp width/height)
    BOX_W_RATIO: 0.095,      // width  as % of lamp width (clamped below)
    BOX_H_RATIO: 0.18,       // height as % of lamp height
    GAP_RATIO:   0.070,      // vertical gap between boxes
    STACK_X_RATIO:   0.72,   // where the stack sits horizontally (0..1 across lamp)
    STACK_TOP_RATIO: 0.22,   // top offset for the first box (0..1 down lamp)
    NUDGE_X: 0,              // px; nudges box stack only (not the copy)
    NUDGE_Y: 0,              // px

    // rail behavior (anchored to top box midline)
    LEFT_STOP_RATIO:  0.36,  // where left rail stops (inside lamp; 0 = lamp left, 1 = lamp right)
    RIGHT_MARGIN_PX:  12,    // right-side padding before rail ends

    // stroke + color-flow
    STROKE_W: 2.25,          // outline thickness (px)
    FLOW_SPEED_S: 6,         // gradient travel duration (seconds)
    COLOR_GOLD: "rgba(230,195,107,1)",
    COLOR_GOLD_SOFT: "rgba(242,220,160,0.9)",
    COLOR_CYAN: "rgba(99,211,255,1)",
    COLOR_CYAN_FADE: "rgba(99,211,255,0.18)",
    TEXT_COLOR: "#ddeaef",

    // inner padding for text inside each shape
    TEXT_PAD_X: 10,          // px (left+right)
    TEXT_PAD_Y: 8,           // px (top+bottom)

    // fonts (px) and weights per shape
    FONT_PT:        12,      // default fall-back
    FONT_PT_PILL:   12,      // 1st + 2nd rectangles
    FONT_PT_OVAL:   12,      // oval
    FONT_PT_DIAMOND:11,      // diamond (usually a touch smaller)
    FONT_WEIGHT:    800,     // text weight inside shapes

    // copy block (independent of boxes)
    COPY_LEFT_RATIO: 0.035,  // left offset within lamp
    COPY_TOP_RATIO:  0.18,   // top offset within lamp
    COPY_NUDGE_X:    0,      // px
    COPY_NUDGE_Y:    0,      // px

    // heading above the stack
    TITLE: "Intent score factors",
    TITLE_PT: 14,
    TITLE_WEIGHT: 700,
  };

  // register scene
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_CONFIG = window.PROCESS_CONFIG || {};
  window.PROCESS_CONFIG.step1 = Object.assign({}, DEF, window.PROCESS_CONFIG.step1 || {});

  // util: clamp
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // make an SVG gradient that flows; ids are unique per render
  function makeLocalFlowGradients(svg, idBase, cfg, x1, y1, x2, y2) {
    const defs = document.createElementNS(NS, "defs");

    const grad = document.createElementNS(NS, "linearGradient");
    grad.id = idBase + "_flow";
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("x1", x1); grad.setAttribute("y1", y1);
    grad.setAttribute("x2", x2); grad.setAttribute("y2", y2);
    [
      ["0%",  cfg.COLOR_GOLD_SOFT],
      ["35%", "rgba(255,255,255,0.95)"],
      ["75%", cfg.COLOR_CYAN],
      ["100%", cfg.COLOR_CYAN_FADE],
    ].forEach(([o,c]) => { const s=document.createElementNS(NS,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); grad.appendChild(s); });
    const anim = document.createElementNS(NS,"animateTransform");
    anim.setAttribute("attributeName","gradientTransform");
    anim.setAttribute("type","translate");
    anim.setAttribute("from","0 0");
    anim.setAttribute("to", `${(x2-x1)} 0`);
    anim.setAttribute("dur", `${cfg.FLOW_SPEED_S}s`);
    anim.setAttribute("repeatCount","indefinite");
    grad.appendChild(anim);
    defs.appendChild(grad);

    const trail = document.createElementNS(NS, "linearGradient");
    trail.id = idBase + "_trail";
    trail.setAttribute("gradientUnits", "userSpaceOnUse");
    trail.setAttribute("x1", x2); trail.setAttribute("y1", y1);
    trail.setAttribute("x2", x2 + 1); trail.setAttribute("y2", y1);
    [
      ["0%",  cfg.COLOR_GOLD_SOFT],
      ["45%", cfg.COLOR_CYAN],
      ["100%", cfg.COLOR_CYAN_FADE],
    ].forEach(([o,c]) => { const s=document.createElementNS(NS,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); trail.appendChild(s); });
    defs.appendChild(trail);

    svg.appendChild(defs);
    return { stroke: `url(#${grad.id})`, trail: `url(#${trail.id})` };
  }

  function drawRoundedRectPath(x, y, w, h, r) {
    r = Math.min(r, w/2, h/2);
    return `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h}
            H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
  }
  const drawDiamondPath = (cx, cy, w, h) =>
    `M ${cx} ${cy-h/2} L ${cx+w/2} ${cy} L ${cx} ${cy+h/2} L ${cx-w/2} ${cy} Z`;

  // text via foreignObject (natural wrapping + vertical padding)
  function mountBoxText(svg, x, y, w, h, txt, fontPx, weight, cfg) {
    const fo = document.createElementNS(NS, "foreignObject");
    fo.setAttribute("x", x + cfg.TEXT_PAD_X);
    fo.setAttribute("y", y + cfg.TEXT_PAD_Y);
    fo.setAttribute("width",  Math.max(1, w - 2*cfg.TEXT_PAD_X));
    fo.setAttribute("height", Math.max(1, h - 2*cfg.TEXT_PAD_Y));
    const div = document.createElement("div");
    div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    div.style.cssText = `
      width:100%;height:100%;display:flex;align-items:center;justify-content:center;
      text-align:center;line-height:1.05;color:${cfg.TEXT_COLOR};
      font:${weight} ${fontPx}px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      word-wrap:break-word; overflow:hidden;`;
    div.textContent = txt;
    fo.appendChild(div);
    svg.appendChild(fo);
  }

  // main scene
  window.PROCESS_SCENES[1] = (ctx) => {
    const cfg = window.PROCESS_CONFIG.step1;
    const B = typeof ctx.bounds === "function" ? ctx.bounds() : ctx.bounds;
    const W = B.width, H = Math.min(560, B.sH - 40);
    const lampL = B.left, lampT = B.top;

    // svg stage
    const svg = document.createElementNS(NS, "svg");
    svg.style.position = "absolute";
    svg.style.left = lampL + "px";
    svg.style.top  = lampT  + "px";
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    ctx.canvas.appendChild(svg);

    // sizing (responsive + clamps so text stays readable)
    const boxW = clamp(W * cfg.BOX_W_RATIO, 200, 340);
    const boxH = clamp(H * cfg.BOX_H_RATIO, 62, 110);
    const gap  = clamp(H * cfg.GAP_RATIO,   12,  40);

    // stack position (centered on X by ratio; then nudged in px)
    const stackCenterX = clamp(W * cfg.STACK_X_RATIO, 0, W) + cfg.NUDGE_X;
    const stackTopY    = clamp(H * cfg.STACK_TOP_RATIO, 0, H - 5*boxH - 4*gap) + cfg.NUDGE_Y;

    // top box rect
    const bx = stackCenterX - boxW/2;
    const by = (i)=> stackTopY + i*(boxH + gap);

    // flowing gradients unique to this svg
    const gid = "g" + Math.floor(Math.random()*1e6);
    const g   = makeLocalFlowGradients(svg, gid, cfg, bx, by(0), bx+boxW, by(0));

    // helper to draw a glowing stroked path with "draw" animation
    function strokePath(d) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill","none");
      p.setAttribute("stroke", g.stroke);
      p.setAttribute("stroke-width", cfg.STROKE_W);
      p.setAttribute("stroke-linejoin","round");
      p.classList.add("glow");
      svg.appendChild(p);
      const len = p.getTotalLength();
      p.style.strokeDasharray  = String(len);
      p.style.strokeDashoffset = String(len);
      p.getBoundingClientRect();
      p.style.transition = "stroke-dashoffset 900ms cubic-bezier(.22,.61,.36,1)";
      requestAnimationFrame(() => p.style.strokeDashoffset = "0");
      return p;
    }

    // 1) Rect (rounded corners)
    const r1 = strokePath(drawRoundedRectPath(bx, by(0), boxW, boxH, 12));
    mountBoxText(svg, bx, by(0), boxW, boxH, "Number of Searches / TimeBlock",
                 cfg.FONT_PT_PILL || cfg.FONT_PT, cfg.FONT_WEIGHT, cfg);

    // 2) Rect (rounded corners)
    const r2 = strokePath(drawRoundedRectPath(bx, by(1), boxW, boxH, 12));
    mountBoxText(svg, bx, by(1), boxW, boxH, "Technologies used at the location",
                 cfg.FONT_PT_PILL || cfg.FONT_PT, cfg.FONT_WEIGHT, cfg);

    // 3) Capsule (radius = h/2)
    const rCaps = strokePath(drawRoundedRectPath(bx, by(2), boxW, boxH, boxH/2));
    mountBoxText(svg, bx, by(2), boxW, boxH, "Number of customers based on LTV/CAC",
                 cfg.FONT_PT_PILL || cfg.FONT_PT, cfg.FONT_WEIGHT, cfg);

    // 4) Oval
    const oX = stackCenterX, oY = by(3) + boxH/2, rx = boxW/2, ry = boxH/2;
    const oval = document.createElementNS(NS, "ellipse");
    oval.setAttribute("cx", oX); oval.setAttribute("cy", oY);
    oval.setAttribute("rx", rx); oval.setAttribute("ry", ry);
    oval.setAttribute("fill", "none");
    oval.setAttribute("stroke", g.stroke);
    oval.setAttribute("stroke-width", cfg.STROKE_W);
    oval.classList.add("glow");
    svg.appendChild(oval);
    // text on oval
    mountBoxText(svg, bx, by(3), boxW, boxH, "Tools interacted",
                 cfg.FONT_PT_OVAL || cfg.FONT_PT, cfg.FONT_WEIGHT, cfg);

    // 5) Diamond
    const dCx = stackCenterX, dCy = by(4) + boxH/2;
    const diamond = strokePath(drawDiamondPath(dCx, dCy, boxW*0.90, boxH*0.90));
    mountBoxText(svg, dCx - boxW*0.45, dCy - boxH*0.45, boxW*0.90, boxH*0.90,
                 "Company Size", cfg.FONT_PT_DIAMOND || cfg.FONT_PT, cfg.FONT_WEIGHT, cfg);

    // dots (…)
    const dotsCy = dCy + boxH*0.60;
    const dot = (i) => {
      const c = document.createElementNS(NS,"circle");
      c.setAttribute("cx", dCx);
      c.setAttribute("cy", dotsCy + i*10);
      c.setAttribute("r", 2.2);
      c.setAttribute("fill", cfg.COLOR_CYAN);
      c.classList.add("glow");
      svg.appendChild(c);
    };
    dot(0); dot(1); dot(2);

    // left & right rails — ANCHORED TO TOP BOX MIDLINE
    const yMidTop = by(0) + boxH/2;
    const leftEndX  = clamp(W * cfg.LEFT_STOP_RATIO, 0, stackCenterX - boxW/2 - 8);
    const rightEndX = W - cfg.RIGHT_MARGIN_PX;

    const rail = (x1,y1,x2,y2, stroke) => {
      const ln = document.createElementNS(NS,"line");
      ln.setAttribute("x1", x1); ln.setAttribute("y1", y1);
      ln.setAttribute("x2", x2); ln.setAttribute("y2", y2);
      ln.setAttribute("stroke", stroke);
      ln.setAttribute("stroke-width", cfg.STROKE_W);
      ln.setAttribute("stroke-linecap","round");
      ln.classList.add("glow");
      svg.appendChild(ln);
      return ln;
    };

    // Left rail: from leftStop -> left edge of top box
    rail(leftEndX, yMidTop, bx, yMidTop, g.trail);
    // Right rail: from right edge of top box -> rightEndX
    rail(bx + boxW, yMidTop, rightEndX, yMidTop, g.trail);

    // Title above the stack
    const title = document.createElementNS(NS, "text");
    title.setAttribute("x", stackCenterX);
    title.setAttribute("y", by(0) - 12);
    title.setAttribute("text-anchor","middle");
    title.setAttribute("fill", cfg.TEXT_COLOR);
    title.setAttribute("font-size", cfg.TITLE_PT);
    title.setAttribute("font-weight", cfg.TITLE_WEIGHT);
    title.setAttribute("font-family", "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
    title.textContent = cfg.TITLE;
    svg.appendChild(title);

    // Copy block on the left (independent coords)
    if (ctx.mountCopy){
      const copyLeft = lampL + W*cfg.COPY_LEFT_RATIO + cfg.COPY_NUDGE_X;
      const copyTop  = lampT + H*cfg.COPY_TOP_RATIO + cfg.COPY_NUDGE_Y;
      const copyHTML = `
        <h3>Who buys the fastest?</h3>
        <p>We rank accounts by a live <strong>intent score</strong> built for packaging suppliers:
        searches per time block, technology on site, customer scale by LTV/CAC, tools they interact with,
        and company size. The score bubbles up buyers most likely to convert <em>now</em> so your team
        prioritizes quotes, samples, and demos that close quickly.</p>`;
      ctx.mountCopy({ top: copyTop, left: copyLeft, html: copyHTML });
    }
  };
})();