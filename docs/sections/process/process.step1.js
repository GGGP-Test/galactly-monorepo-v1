// sections/process/process.step1.js
(() => {
  // Safety: ensure registry exists even if this loads early
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};

  // STEP 1 scene: copy left + 2 flowing pills on right
  window.PROCESS_SCENES[1] = function(ctx){
    const { canvas, bounds, makeFlowGradients, mountCopy } = ctx;
    const b = bounds;
    const ns = "http://www.w3.org/2000/svg";

    // --- left-side copy (inside lamp) ---
    const leftClamp = Math.max(b.railRight + 28, b.left + 24);
    const copy = mountCopy({
      top:  b.top + 56,
      left: leftClamp,
      html: `
        <h3>We analyze your signals.</h3>
        <p>We connect what your site says with market activity and build a clean signal stream.
        Then we score it so your sales team sees the real heat first.</p>
      `,
    });

    // --- right canvas ---
    const nodeW = b.width, nodeH = Math.min(560, b.sH - 40);
    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  nodeW);
    svg.setAttribute("height", nodeH);
    svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);
    canvas.appendChild(svg);

    // pill geometry
    const pillW = Math.min(320, nodeW * 0.40);
    const pillH = 68;
    const r = 16;

    // place both pills toward the right half
    const baseX = Math.max(24, nodeW * 0.56);
    const p1 = { x: baseX,     y: Math.max(24, nodeH * 0.25) };
    const p2 = { x: baseX,     y: Math.max(24, nodeH * 0.25) + 120 };

    // right edge for trail (in this svg space)
    const xTrailEnd = (b.sW - 10) - b.left;

    // defs: reuse the same flowing colors helper
    const defs = makeFlowGradients({
      pillX: p1.x, pillY: p1.y, pillW,
      yMid: p1.y + pillH/2,
      xTrailEnd
    });
    svg.appendChild(defs);

    // helper to draw a rounded “pill” outline with flowing stroke
    const pillPath = (x,y) => {
      const d = `M ${x+r} ${y} H ${x+pillW-r} Q ${x+pillW} ${y} ${x+pillW} ${y+r}
                 V ${y+pillH-r} Q ${x+pillW} ${y+pillH} ${x+pillW-r} ${y+pillH}
                 H ${x+r} Q ${x} ${y+pillH} ${x} ${y+pillH-r}
                 V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
      const path = document.createElementNS(ns,"path");
      path.setAttribute("d", d);
      path.setAttribute("fill","none");
      path.setAttribute("stroke","url(#gradFlow)");
      path.setAttribute("stroke-width","2.5");
      path.setAttribute("stroke-linejoin","round");
      path.setAttribute("class","glow");
      svg.appendChild(path);

      // pleasant draw-in
      const len = path.getTotalLength();
      path.style.strokeDasharray  = String(len);
      path.style.strokeDashoffset = String(len);
      path.getBoundingClientRect();
      path.style.transition = "stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
      requestAnimationFrame(()=> path.style.strokeDashoffset = "0");
      return path;
    };

    pillPath(p1.x, p1.y);
    pillPath(p2.x, p2.y);

    // labels
    const label = (x,y,t) => {
      const text = document.createElementNS(ns,"text");
      text.setAttribute("x", x + 16);
      text.setAttribute("y", y + pillH/2 + 6);
      text.setAttribute("fill","#ddeaef");
      text.setAttribute("font-weight","800");
      text.setAttribute("font-size","16");
      text.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
      text.textContent = t;
      svg.appendChild(text);
    };
    label(p1.x, p1.y, "Signals");
    label(p2.x, p2.y, "Score");

    // connectors (same liquid trail)
    const mkLine = (x1,y1,x2,y2) => {
      const line = document.createElementNS(ns,"line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1);
      line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      line.setAttribute("stroke","url(#gradTrailFlow)");
      line.setAttribute("stroke-width","2.5");
      line.setAttribute("stroke-linecap","round");
      line.setAttribute("class","glow");
      svg.appendChild(line);
    };
    // p1 -> right edge
    mkLine(p1.x + pillW, p1.y + pillH/2, xTrailEnd, p1.y + pillH/2);
    // p2 -> right edge
    mkLine(p2.x + pillW, p2.y + pillH/2, xTrailEnd, p2.y + pillH/2);

    // push copy a bit left of the first pill, if needed
    requestAnimationFrame(() => {
      const boxLeftAbs = b.left + p1.x;
      const copyBox    = copy.getBoundingClientRect();
      let idealLeft    = Math.min(copyBox.left, boxLeftAbs - 44 - copyBox.width);
      idealLeft        = Math.max(idealLeft, leftClamp);
      copy.style.left  = idealLeft + "px";
    });
  };
})();