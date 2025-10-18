// docs/sections/process/steps/process.step1.js
// Step 1 scene: "Who buys the fastest?" — stacked shapes with flowing outline
(() => {
  // register with the core router in process.js
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};

  // knobs you can tweak later from the console if you want
  const DEFAULTS = {
    STACK_NUDGE_X: 84,   // move whole stack left/right inside the lamp
    STACK_NUDGE_Y: 12,   // move whole stack up/down inside the lamp
    BOX_W: 320,          // base width of rectangular/pill boxes
    BOX_H: 60,           // base height of rectangular/pill boxes
    GAP: 18,             // vertical gap between boxes
    FONT_FAMILY: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    FONT_SIZE: 15,
  };

  // The scene function called by process.js
  window.PROCESS_SCENES[1] = function sceneStep1(ctx){
    const { ns, canvas, bounds, makeFlowGradients, mountCopy } = ctx;
    const C = Object.assign({}, DEFAULTS, (window.PROCESS_CONFIG?.step1 || {}));
    const b = bounds;

    // Stage SVG sized to the lamp area
    const nodeW = b.width;
    const nodeH = Math.min(560, b.sH - 40);

    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  nodeW);
    svg.setAttribute("height", nodeH);
    svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);
    canvas.appendChild(svg);

    // Placement math — keep stack on the right, inside the lamp, but not too far
    const stackX = Math.min(nodeW - 30 - C.BOX_W, Math.max(18, nodeW * 0.56)) + C.STACK_NUDGE_X;
    const stackY0 = Math.max(18, nodeH * 0.18) + C.STACK_NUDGE_Y;

    // Gradient defs: flowing outline + flowing trail (same palette as Step 0)
    // We also add a full-width line gradient so the seam looks continuous.
    (function addDefs(){
      // reuse the helper so the rightward “to next section” line flows
      const xTrailEnd = (b.sW - 10) - b.left;
      const yMidForGrad = stackY0 + C.BOX_H / 2;
      svg.appendChild(makeFlowGradients({
        pillX: stackX,
        pillY: stackY0,
        pillW: C.BOX_W,
        yMid: yMidForGrad,
        xTrailEnd
      }));

      // full-line gradient across the lamp (left → right)
      const defs = svg.querySelector("defs") || svg.appendChild(document.createElementNS(ns, "defs"));
      const gLine = document.createElementNS(ns, "linearGradient");
      gLine.id = "gradLineFull_s1";
      gLine.setAttribute("gradientUnits","userSpaceOnUse");
      gLine.setAttribute("x1", 0); gLine.setAttribute("y1", yMidForGrad);
      gLine.setAttribute("x2", nodeW); gLine.setAttribute("y2", yMidForGrad);
      [
        ["0%","rgba(230,195,107,.92)"],
        ["45%","rgba(255,255,255,.90)"],
        ["100%","rgba(99,211,255,.60)"]
      ].forEach(([o,c])=>{
        const stop = document.createElementNS(ns,"stop");
        stop.setAttribute("offset", o);
        stop.setAttribute("stop-color", c);
        gLine.appendChild(stop);
      });
      const anim = document.createElementNS(ns,"animateTransform");
      anim.setAttribute("attributeName","gradientTransform");
      anim.setAttribute("type","translate");
      anim.setAttribute("from","0 0");
      anim.setAttribute("to", `${nodeW} 0`);
      anim.setAttribute("dur","6s");
      anim.setAttribute("repeatCount","indefinite");
      gLine.appendChild(anim);
      defs.appendChild(gLine);
    })();

    // Incoming line from the left seam, and outgoing line to the screen edge
    const yFlow = stackY0 - 14; // a subtle “rail” over the top line of the first box
    const lineIn = document.createElementNS(ns,"line");
    lineIn.setAttribute("x1", 6);
    lineIn.setAttribute("y1", yFlow);
    lineIn.setAttribute("x2", stackX - 18);
    lineIn.setAttribute("y2", yFlow);
    lineIn.setAttribute("stroke", "url(#gradLineFull_s1)");
    lineIn.setAttribute("stroke-width", "2.2");
    lineIn.setAttribute("stroke-linecap", "round");
    lineIn.setAttribute("class","glow");
    svg.appendChild(lineIn);

    const lineOut = document.createElementNS(ns,"line");
    lineOut.setAttribute("x1", stackX + C.BOX_W + 18);
    lineOut.setAttribute("y1", yFlow);
    lineOut.setAttribute("x2", (b.sW - 10) - b.left);
    lineOut.setAttribute("y2", yFlow);
    lineOut.setAttribute("stroke", "url(#gradTrailFlow)");
    lineOut.setAttribute("stroke-width", "2.2");
    lineOut.setAttribute("stroke-linecap", "round");
    lineOut.setAttribute("class","glow");
    svg.appendChild(lineOut);

    // Helpers to draw shapes
    const strokeCommon = { stroke: "url(#gradFlow)", "stroke-width": 2.2, fill: "none" };
    const setAttrs = (el, attrs) => { for (const k in attrs) el.setAttribute(k, String(attrs[k])); return el; };

    function roundedRectPath(x, y, w, h, r){
      return `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
    }
    function textCenter(label, cx, cy, size=C.FONT_SIZE){
      const t = document.createElementNS(ns,"text");
      t.setAttribute("x", cx);
      t.setAttribute("y", cy);
      t.setAttribute("fill", "#e8f2fb");
      t.setAttribute("font-family", C.FONT_FAMILY);
      t.setAttribute("font-weight", "700");
      t.setAttribute("font-size", String(size));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "middle");
      t.style.letterSpacing = ".2px";

      // allow manual line breaks with \n
      const lines = String(label).split(/\n/g);
      const lh = Math.round(size * 1.15);
      lines.forEach((ln, i)=>{
        const sp = document.createElementNS(ns,"tspan");
        sp.setAttribute("x", cx);
        sp.setAttribute("dy", i===0 ? "0" : String(lh));
        sp.textContent = ln;
        t.appendChild(sp);
      });
      return t;
    }

    // Stack data — line breaks added to match your mock
    const items = [
      { label:"Number of Searches /\nTimeBlock", kind:"rect"   },
      { label:"Technologies used at\nthe location", kind:"rect" },
      { label:"Number of customers based on\nLTV/CAC", kind:"pill" },
      { label:"Tools interacted", kind:"oval" },
      { label:"Company Size", kind:"diamond" },
    ];

    const shapes = [];
    let y = stackY0;
    const W = C.BOX_W, H = C.BOX_H;

    items.forEach((it, idx)=>{
      const cx = stackX + W/2;
      const cy = y + H/2;

      if (it.kind === "rect" || it.kind === "pill"){
        const r = it.kind === "pill" ? Math.min(22, H/2) : 10;
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", roundedRectPath(stackX, y, W, H, r));
        setAttrs(path, strokeCommon);
        path.setAttribute("class","glow");
        svg.appendChild(path);
        shapes.push({ cx, cy, top:y, bottom:y+H, left:stackX, right:stackX+W });
      }
      else if (it.kind === "oval"){
        const rx = W/2, ry = Math.max(22, Math.round(H*0.55));
        const ell = document.createElementNS(ns,"ellipse");
        setAttrs(ell, Object.assign({}, strokeCommon, { cx, cy, rx, ry }));
        ell.setAttribute("class","glow");
        svg.appendChild(ell);
        // adjust recorded top/bottom to the ellipse size
        shapes.push({ cx, cy, top:cy-ry, bottom:cy+ry, left:cx-rx, right:cx+rx });
      }
      else if (it.kind === "diamond"){
        const dw = Math.round(W * 0.64);     // a bit narrower than the boxes
        const dh = Math.round(H * 1.10);     // a touch taller
        const d = document.createElementNS(ns,"path");
        const p = [
          [cx, cy - dh/2],
          [cx + dw/2, cy],
          [cx, cy + dh/2],
          [cx - dw/2, cy],
          [cx, cy - dh/2]
        ];
        d.setAttribute("d", `M ${p[0][0]} ${p[0][1]} L ${p[1][0]} ${p[1][1]} L ${p[2][0]} ${p[2][1]} L ${p[3][0]} ${p[3][1]} Z`);
        setAttrs(d, strokeCommon);
        d.setAttribute("class","glow");
        svg.appendChild(d);
        shapes.push({ cx, cy, top:cy-dh/2, bottom:cy+dh/2, left:cx-dw/2, right:cx+dw/2 });
      }

      // Labels — auto smaller for the long LTV/CAC one
      const fs = it.label.includes("LTV/CAC") ? C.FONT_SIZE-1 : C.FONT_SIZE;
      svg.appendChild(textCenter(it.label, cx, cy, fs));

      y += (H + C.GAP);
    });

    // Connectors between shapes (subtle vertical spine)
    for (let i=0;i<shapes.length-1;i++){
      const a = shapes[i], b2 = shapes[i+1];
      const link = document.createElementNS(ns,"line");
      link.setAttribute("x1", a.cx);
      link.setAttribute("y1", a.bottom + 4);
      link.setAttribute("x2", b2.cx);
      link.setAttribute("y2", b2.top - 4);
      link.setAttribute("stroke", "url(#gradFlow)");
      link.setAttribute("stroke-width", "1.8");
      link.setAttribute("stroke-linecap", "round");
      link.setAttribute("class","glow");
      svg.appendChild(link);
    }

    // The three dots indicating “more”
    const last = shapes[shapes.length-1];
    const dotsY0 = last.bottom + 10;
    for (let i=0;i<3;i++){
      const c = document.createElementNS(ns,"circle");
      c.setAttribute("cx", last.cx);
      c.setAttribute("cy", dotsY0 + i*10);
      c.setAttribute("r", 2.4);
      c.setAttribute("fill", "rgba(99,211,255,.95)");
      c.style.filter = "drop-shadow(0 0 8px rgba(99,211,255,.5)) drop-shadow(0 0 14px rgba(242,220,160,.35))";
      svg.appendChild(c);
    }

    // Left copy (SEO-tight, boxes keep their own font styling)
    const copyLeft = Math.max(b.railRight + 24, b.left + 18);
    const copyTop  = Math.max(16, stackY0 - 30);
    mountCopy({
      top: copyTop,
      left: copyLeft,
      html: `
        <h3>Who buys the fastest?</h3>
        <p>We rank accounts by a live <strong>intent score</strong> built for packaging suppliers:
        searches per time block, technology on site, customer scale by <strong>LTV/CAC</strong>,
        the tools they interact with, and company size. The score bubbles up buyers most likely to
        convert now, so your team prioritizes quotes, samples, and demos that close quickly.</p>
      `
    });
  };
})();