// sections/process/process.step1.js
(() => {
  // Step 1: "Who buys the fastest?" (intent score)
  // Registers with the scene router defined in sections/process/process.js
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};

  window.PROCESS_SCENES[1] = function (ctx) {
    const { canvas, bounds, makeFlowGradients, mountCopy } = ctx;
    const b  = bounds;
    const ns = "http://www.w3.org/2000/svg";

    // ------ Layout knobs (uniform sizes + thinner strokes) ------
    const H      = Math.min(560, b.sH - 40);
    const W      = b.width;          // SVG width == lamp width
    const COL_W  = Math.min(300, W * 0.40); // slimmer column so everything fits in the lamp
    const BOX_H  = 52;               // uniform height across shapes
    const GAP_Y  = 72;
    const START_Y= Math.max(18, H * 0.18);
    const STROKE = 1.8;              // thinner stroke as requested

    // Column X (to the right side, but inside the lamp)
    const baseX  = Math.max(18, W * 0.54);

    // Where the copy sits (inside lamp, left of shapes)
    const copyLeftClamp = Math.max(b.railRight + 28, b.left + 24);

    // ----- Left copy (SEO-tuned for packaging suppliers) -----
    const copy = mountCopy({
      top:  b.top + START_Y - 4,
      left: copyLeftClamp,
      html: `
        <h3>Who buys the fastest?</h3>
        <p>We rank accounts by a live <strong>intent score</strong> built for packaging suppliers:
        searches per time block, technology on site, customer scale by LTV/CAC, tools they interact with,
        and company size. The score bubbles up buyers most likely to convert <em>now</em> so your team
        prioritizes quotes, samples, and demos that close quickly.</p>
      `
    });

    // ----- Right SVG canvas -----
    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    canvas.appendChild(svg);

    // Right-edge in this SVG’s space
    const xRight = (b.sW - 10) - b.left;

    // Flowing gradients (outline + right trail) seeded from the first box
    svg.appendChild(makeFlowGradients({
      pillX: baseX, pillY: START_Y, pillW: COL_W,
      yMid: START_Y + BOX_H/2, xTrailEnd: xRight
    }));

    // Also add a left-side flowing trail for continuity coming in
    const defs = document.createElementNS(ns, "defs");
    const gLeft = document.createElementNS(ns, "linearGradient");
    gLeft.id = "gradTrailLeft";
    gLeft.setAttribute("gradientUnits", "userSpaceOnUse");
    gLeft.setAttribute("x1", 0); gLeft.setAttribute("y1", START_Y + BOX_H/2);
    gLeft.setAttribute("x2", baseX); gLeft.setAttribute("y2", START_Y + BOX_H/2);
    [["0%","rgba(99,211,255,.18)"],["55%","rgba(99,211,255,.90)"],["100%","rgba(230,195,107,.92)"]]
      .forEach(([o,c]) => { const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gLeft.appendChild(s); });
    const animL = document.createElementNS(ns, "animateTransform");
    animL.setAttribute("attributeName","gradientTransform");
    animL.setAttribute("type","translate");
    animL.setAttribute("from","0 0"); animL.setAttribute("to", `${baseX} 0`);
    animL.setAttribute("dur","6s"); animL.setAttribute("repeatCount","indefinite");
    gLeft.appendChild(animL);
    defs.appendChild(gLeft);
    svg.appendChild(defs);

    // Helpers
    const drawIn = (path) => {
      const len = path.getTotalLength();
      path.style.strokeDasharray  = String(len);
      path.style.strokeDashoffset = String(len);
      path.getBoundingClientRect();
      path.style.transition = "stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
      requestAnimationFrame(() => (path.style.strokeDashoffset = "0"));
    };

    const addLabel = (x, y, text) => {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", x);
      t.setAttribute("y", y);
      t.setAttribute("fill", "#ddeaef");
      t.setAttribute("font-size", "15");
      t.setAttribute("font-weight", "800");
      t.setAttribute("font-family", "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
      t.textContent = text;
      svg.appendChild(t);
    };

    // ----- Continuous cable left→stack and stack→right -----
    const yCable = START_Y + BOX_H/2;
    const lineL = document.createElementNS(ns, "line");
    lineL.setAttribute("x1", 0);         lineL.setAttribute("y1", yCable);
    lineL.setAttribute("x2", baseX - 10); lineL.setAttribute("y2", yCable);
    lineL.setAttribute("stroke", "url(#gradTrailLeft)");
    lineL.setAttribute("stroke-width", String(STROKE));
    lineL.setAttribute("stroke-linecap","round");
    lineL.setAttribute("class","glow");
    svg.appendChild(lineL);

    const lineR = document.createElementNS(ns, "line");
    lineR.setAttribute("x1", baseX + COL_W + 10); lineR.setAttribute("y1", yCable);
    lineR.setAttribute("x2", xRight);             lineR.setAttribute("y2", yCable);
    lineR.setAttribute("stroke", "url(#gradTrailFlow)");
    lineR.setAttribute("stroke-width", String(STROKE));
    lineR.setAttribute("stroke-linecap","round");
    lineR.setAttribute("class","glow");
    svg.appendChild(lineR);

    // ----- Uniform stack of shapes (exact order you specified) -----
    const items = [
      { kind: "rect",      text: "Number of Searches / TimeBlock" },
      { kind: "rect",      text: "Technologies used at the location" },
      { kind: "roundrect", text: "Number of customers based on LTV/CAC" },
      { kind: "oval",      text: "Tools interacted" },
      { kind: "diamond",   text: "Company Size" },
    ];

    items.forEach((s, i) => {
      const x = baseX, y = START_Y + i * GAP_Y, w = COL_W, h = BOX_H;

      if (s.kind === "rect" || s.kind === "roundrect") {
        const r = s.kind === "roundrect" ? 16 : 4;
        const d = `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r}
                   V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h}
                   H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r}
                   V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill","none");
        path.setAttribute("stroke","url(#gradFlow)");
        path.setAttribute("stroke-width", String(STROKE));
        path.setAttribute("stroke-linejoin","round");
        path.setAttribute("class","glow");
        svg.appendChild(path);
        drawIn(path);
        addLabel(x + 16, y + h/2 + 5, s.text);
      }

      if (s.kind === "oval") {
        const cx = x + w/2, cy = y + h/2, rx = w/2, ry = h/2;
        const el = document.createElementNS(ns, "ellipse");
        el.setAttribute("cx", cx); el.setAttribute("cy", cy);
        el.setAttribute("rx", rx); el.setAttribute("ry", ry);
        el.setAttribute("fill","none");
        el.setAttribute("stroke","url(#gradFlow)");
        el.setAttribute("stroke-width", String(STROKE));
        el.setAttribute("class","glow");
        svg.appendChild(el);
        // draw-in animation for ellipse (via invisible path)
        const fake = document.createElementNS(ns,"path");
        fake.setAttribute("d", `M ${x} ${cy} A ${rx} ${ry} 0 1 1 ${x+w-0.1} ${cy} A ${rx} ${ry} 0 1 1 ${x} ${cy}`);
        fake.setAttribute("fill","none"); fake.setAttribute("stroke","transparent");
        svg.appendChild(fake); drawIn(fake); svg.removeChild(fake);
        addLabel(x + 16, y + h/2 + 5, s.text);
      }

      if (s.kind === "diamond") {
        const cx = x + w/2, cy = y + h/2, rx = w/2, ry = h/2;
        const d = `M ${cx} ${cy-ry} L ${cx+rx} ${cy} L ${cx} ${cy+ry} L ${cx-rx} ${cy} Z`;
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill","none");
        path.setAttribute("stroke","url(#gradFlow)");
        path.setAttribute("stroke-width", String(STROKE));
        path.setAttribute("stroke-linejoin","round");
        path.setAttribute("class","glow");
        svg.appendChild(path);
        drawIn(path);
        addLabel(x + 16, y + h/2 + 5, s.text);
      }
    });

    // Three dots below (indicating more factors)
    const lastY = START_Y + (items.length - 1) * GAP_Y + BOX_H + 18;
    [0,1,2].forEach(k => {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", baseX + COL_W/2);
      c.setAttribute("cy", lastY + k * 14);
      c.setAttribute("r", 3.5);
      c.setAttribute("fill", "rgba(99,211,255,.95)");
      c.setAttribute("class","glow");
      svg.appendChild(c);
    });

    // Keep copy neatly left of the first box
    requestAnimationFrame(() => {
      const boxLeftAbs = b.left + baseX;
      const copyBox    = copy.getBoundingClientRect();
      let idealLeft    = Math.min(copyBox.left, boxLeftAbs - 44 - copyBox.width);
      idealLeft        = Math.max(idealLeft, copyLeftClamp);
      copy.style.left  = idealLeft + "px";
    });
  };
})();