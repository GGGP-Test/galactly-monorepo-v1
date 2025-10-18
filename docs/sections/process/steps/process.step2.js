// sections/process/process.step2.js
(() => {
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};

  window.PROCESS_SCENES[2] = function(ctx){
    const { canvas, bounds, makeFlowGradients, mountCopy } = ctx;
    const b  = bounds;
    const ns = "http://www.w3.org/2000/svg";

    // ----- Left copy (inside lamp), SEO-tuned for packaging suppliers -----
    const leftClamp = Math.max(b.railRight + 28, b.left + 24);
    const copy = mountCopy({
      top:  b.top + 54,
      left: leftClamp,
      html: `
        <h3>Who buys the fastest?</h3>
        <p>We rank buyers by a live <strong>intent score</strong> built for packaging suppliers:
        searches per time block, tech in their facility, customer scale by LTV/CAC, tools they touch,
        and company size. The score surfaces accounts most likely to convert <em>now</em> so your team
        prioritizes demos, quotes, and samples that close quickly.</p>
      `,
    });

    // ----- Right canvas (SVG) -----
    const nodeW = b.width, nodeH = Math.min(560, b.sH - 40);
    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  nodeW);
    svg.setAttribute("height", nodeH);
    svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);
    canvas.appendChild(svg);

    // Layout
    const W = nodeW;
    const H = nodeH;
    const baseX = Math.max(24, W * 0.58);        // right half stack
    const colW  = Math.min(360, W * 0.44);
    const gapY  = 86;
    const startY= Math.max(18, H * 0.16);

    // Right edge (screen space → this SVG space)
    const xRight = (b.sW - 10) - b.left;

    // Flowing gradients (outline + right trail)
    svg.appendChild(makeFlowGradients({
      pillX: baseX, pillY: startY, pillW: colW,
      yMid: startY + 54/2, xTrailEnd: xRight
    }));

    // Add a left-side flowing trail as well (for continuity coming in)
    const gradLeft = document.createElementNS(ns, "linearGradient");
    gradLeft.id = "gradTrailLeft";
    gradLeft.setAttribute("gradientUnits", "userSpaceOnUse");
    gradLeft.setAttribute("x1", 0); gradLeft.setAttribute("y1", startY + 54/2);
    gradLeft.setAttribute("x2", baseX); gradLeft.setAttribute("y2", startY + 54/2);
    [["0%","rgba(99,211,255,.18)"],["55%","rgba(99,211,255,.90)"],["100%","rgba(230,195,107,.92)"]]
      .forEach(([o,c])=>{ const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gradLeft.appendChild(s); });
    const aL = document.createElementNS(ns,"animateTransform");
    aL.setAttribute("attributeName","gradientTransform"); aL.setAttribute("type","translate");
    aL.setAttribute("from","0 0"); aL.setAttribute("to", `${baseX} 0`);
    aL.setAttribute("dur","6s"); aL.setAttribute("repeatCount","indefinite");
    gradLeft.appendChild(aL);
    const defsExtra = document.createElementNS(ns,"defs"); defsExtra.appendChild(gradLeft); svg.appendChild(defsExtra);

    // Helpers
    const drawIn = (path) => {
      const len = path.getTotalLength();
      path.style.strokeDasharray  = String(len);
      path.style.strokeDashoffset = String(len);
      path.getBoundingClientRect();
      path.style.transition = "stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
      requestAnimationFrame(()=> path.style.strokeDashoffset = "0");
    };

    const addText = (x, y, label, size=15, weight="800") => {
      const t = document.createElementNS(ns,"text");
      t.setAttribute("x", x); t.setAttribute("y", y);
      t.setAttribute("fill","#ddeaef");
      t.setAttribute("font-size", String(size));
      t.setAttribute("font-weight", weight);
      t.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
      t.textContent = label; svg.appendChild(t);
    };

    // ----- Continuous trails (left in, right out) -----
    const yCable = startY + 54/2; // align with first box center
    const lineL = document.createElementNS(ns,"line");
    lineL.setAttribute("x1", 0);        lineL.setAttribute("y1", yCable);
    lineL.setAttribute("x2", baseX-10); lineL.setAttribute("y2", yCable);
    lineL.setAttribute("stroke","url(#gradTrailLeft)");
    lineL.setAttribute("stroke-width","2.5");
    lineL.setAttribute("stroke-linecap","round");
    lineL.setAttribute("class","glow");
    svg.appendChild(lineL);

    const lineR = document.createElementNS(ns,"line");
    lineR.setAttribute("x1", baseX + colW + 10); lineR.setAttribute("y1", yCable);
    lineR.setAttribute("x2", xRight);            lineR.setAttribute("y2", yCable);
    lineR.setAttribute("stroke","url(#gradTrailFlow)");
    lineR.setAttribute("stroke-width","2.5");
    lineR.setAttribute("stroke-linecap","round");
    lineR.setAttribute("class","glow");
    svg.appendChild(lineR);

    // ----- Shapes (exact order + styles you requested) -----
    const shapes = [
      { kind:"rect",        h:54,  text:"Number of Searches / TimeBlock" },
      { kind:"rect",        h:54,  text:"Technologies used at the location" },
      { kind:"roundrect",   h:62,  text:"Number of customers based on LTV/CAC" },
      { kind:"oval",        h:56,  text:"Tools interacted" },
      { kind:"diamond",     h:72,  text:"Company Size" },
    ];

    shapes.forEach((s, i)=>{
      const x = baseX, y = startY + i*gapY, w = colW, h = s.h;

      if (s.kind === "rect" || s.kind === "roundrect"){
        const r = s.kind === "roundrect" ? 16 : 3;
        const d = `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r}
                   V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h}
                   H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r}
                   V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
        const path = document.createElementNS(ns,"path");
        path.setAttribute("d", d);
        path.setAttribute("fill","none");
        path.setAttribute("stroke","url(#gradFlow)");
        path.setAttribute("stroke-width","2.5");
        path.setAttribute("stroke-linejoin","round");
        path.setAttribute("class","glow");
        svg.appendChild(path);
        drawIn(path);
        addText(x+16, y + h/2 + 5, s.text, 15, "800");
      }

      if (s.kind === "oval"){
        const cx = x + w/2, cy = y + h/2, rx = w/2, ry = h/2;
        const el = document.createElementNS(ns,"ellipse");
        el.setAttribute("cx", cx); el.setAttribute("cy", cy);
        el.setAttribute("rx", rx); el.setAttribute("ry", ry);
        el.setAttribute("fill","none");
        el.setAttribute("stroke","url(#gradFlow)");
        el.setAttribute("stroke-width","2.5");
        el.setAttribute("class","glow");
        svg.appendChild(el);
        // emulate draw-in for ellipse
        const fake = document.createElementNS(ns,"path");
        fake.setAttribute("d", `M ${x} ${cy} A ${rx} ${ry} 0 1 1 ${x+w-0.1} ${cy} A ${rx} ${ry} 0 1 1 ${x} ${cy}`);
        fake.setAttribute("fill","none"); fake.setAttribute("stroke","transparent");
        svg.appendChild(fake); drawIn(fake); svg.removeChild(fake);
        addText(x+16, y + h/2 + 5, s.text, 15, "800");
      }

      if (s.kind === "diamond"){
        const cx = x + w/2, cy = y + h/2, rx = w/2, ry = h/2;
        const d = `M ${cx} ${cy-ry} L ${cx+rx} ${cy} L ${cx} ${cy+ry} L ${cx-rx} ${cy} Z`;
        const path = document.createElementNS(ns,"path");
        path.setAttribute("d", d);
        path.setAttribute("fill","none");
        path.setAttribute("stroke","url(#gradFlow)");
        path.setAttribute("stroke-width","2.5");
        path.setAttribute("stroke-linejoin","round");
        path.setAttribute("class","glow");
        svg.appendChild(path);
        drawIn(path);
        addText(x+16, y + h/2 + 5, s.text, 15, "800");
      }
    });

    // ----- Three dots below (suggesting more factors) -----
    const lastY = startY + (shapes.length-1)*gapY + shapes[shapes.length-1].h + 18;
    [0,1,2].forEach((k)=>{
      const c = document.createElementNS(ns,"circle");
      c.setAttribute("cx", baseX + colW/2);
      c.setAttribute("cy", lastY + k*14);
      c.setAttribute("r", 3.5);
      c.setAttribute("fill","rgba(99,211,255,.95)");
      c.setAttribute("class","glow");
      svg.appendChild(c);
    });

    // Keep copy nicely left of the first box
    requestAnimationFrame(() => {
      const boxLeftAbs = b.left + baseX;
      const copyBox    = copy.getBoundingClientRect();
      let idealLeft    = Math.min(copyBox.left, boxLeftAbs - 44 - copyBox.width);
      idealLeft        = Math.max(idealLeft, leftClamp);
      copy.style.left  = idealLeft + "px";
    });
  };
})();