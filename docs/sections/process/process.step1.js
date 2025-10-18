// Step 1 scene — "Who buys the fastest?"
// Shapes with flowing outline, connected rails, centered stack.
// TUNING: window.PROCESS_CONFIG.step1 (see knobs below)
(() => {
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};

  // ---- knobs you can change live in the console ----
  // Example:  PROCESS_CONFIG.step1.BOX_W = 380; PROCESS_SCENES[1]({/* will be ignored */}); // then click step 1 again
  const DEFAULTS = {
    STACK_ALIGN: 0.60,     // 0..1 inside the lamp (0=left, 1=right). Default keeps room for copy.
    NUDGE_X:  0,           // fine x nudge of the whole stack
    NUDGE_Y:  0,           // fine y nudge of the whole stack
    BOX_W:    360,         // width of rectangles/pill (chunkier than before)
    BOX_H:     86,         // height (closer to square)
    GAP:       16,         // vertical gap between shapes
    FONT_SIZE: 15,
    FONT_FAMILY: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    LINE_MARGIN_FROM_COPY: 14, // how far the left rail stops before the copy
  };

  window.PROCESS_SCENES[1] = function sceneStep1(ctx){
    const { ns, canvas, bounds, makeFlowGradients, mountCopy } = ctx;
    const b = bounds;
    const C = Object.assign({}, DEFAULTS, (window.PROCESS_CONFIG?.step1 || {}));

    // SVG stage
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

    // ----- COPY (left column) -----
    // We mount copy first so we know where its left edge is (to stop the left rail before it).
    const copyLeft = Math.max(b.railRight + 24, b.left + 18);
    const copyTop  = Math.max(16, nodeH * 0.18 - 30) + C.NUDGE_Y;
    const copyEl = mountCopy({
      top:  b.top + copyTop,
      left: copyLeft,
      html: `
        <h3>Who buys the fastest?</h3>
        <p>We rank accounts by a live <strong>intent score</strong> built for packaging suppliers:
        searches per time block, technology on site, customer scale by <strong>LTV/CAC</strong>,
        the tools they interact with, and company size. The score bubbles up buyers most likely to
        convert now, so your team prioritizes quotes, samples, and demos that close quickly.</p>
      `
    });

    // ----- stack placement (centered in lamp, with alignment knob) -----
    const W = C.BOX_W, H = C.BOX_H, G = C.GAP;
    const stackX = Math.round(nodeW * C.STACK_ALIGN - W/2) + C.NUDGE_X;
    const stackY0 = Math.max(18, nodeH * 0.18) + C.NUDGE_Y;

    // flowing gradients used by outlines and right-going “rail”
    const xTrailEnd = (b.sW - 10) - b.left;
    svg.appendChild(makeFlowGradients({
      pillX: stackX, pillY: stackY0, pillW: W,
      yMid: stackY0 + H/2,
      xTrailEnd
    }));

    // helpers
    const set = (el, o) => { for (const k in o) el.setAttribute(k, String(o[k])); return el; };
    const strokeCommon = { stroke: "url(#gradFlow)", "stroke-width": 2.2, fill: "none" };
    const roundedRect = (x,y,w,h,r)=>`M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
    function textCenter(label, cx, cy, size=C.FONT_SIZE){
      const t = document.createElementNS(ns,"text");
      set(t, { x:cx, y:cy, "text-anchor":"middle", "dominant-baseline":"middle",
               fill:"#e8f2fb", "font-weight":"700", "font-size":size, "font-family":C.FONT_FAMILY });
      t.style.letterSpacing = ".2px";
      const lines = String(label).split(/\n/);
      const lh = Math.round(size * 1.12);
      lines.forEach((ln,i)=>{ const s=document.createElementNS(ns,"tspan"); s.textContent=ln; set(s,{ x:cx, dy:i?lh:0}); t.appendChild(s); });
      return t;
    }

    // data (with manual line breaks like your mock)
    const items = [
      { label:"Number of Searches /\nTimeBlock", kind:"rect" },
      { label:"Technologies used at\nthe location", kind:"rect" },
      { label:"Number of customers based on\nLTV/CAC", kind:"pill" },
      { label:"Tools interacted", kind:"oval" },
      { label:"Company Size", kind:"diamond" },
    ];

    // draw shapes
    const shapes = [];
    let y = stackY0;
    items.forEach((it) => {
      const cx = stackX + W/2;
      const cy = y + H/2;

      if (it.kind === "rect" || it.kind === "pill"){
        const r = it.kind === "pill" ? Math.min(26, H/2) : 12;
        const p = document.createElementNS(ns, "path");
        p.setAttribute("d", roundedRect(stackX, y, W, H, r));
        set(p, strokeCommon); p.setAttribute("class","glow");
        svg.appendChild(p);
        shapes.push({ cx, cy, left:stackX, right:stackX+W, top:y, bottom:y+H });
      } else if (it.kind === "oval"){
        const rx = W/2, ry = Math.max(28, Math.round(H*0.58));
        const e = document.createElementNS(ns,"ellipse");
        set(e, Object.assign({}, strokeCommon, { cx, cy, rx, ry })); e.setAttribute("class","glow");
        svg.appendChild(e);
        shapes.push({ cx, cy, left:cx-rx, right:cx+rx, top:cy-ry, bottom:cy+ry });
      } else { // diamond
        const dw = Math.round(W * 0.66), dh = Math.round(H * 1.12);
        const d = document.createElementNS(ns,"path");
        d.setAttribute("d", `M ${cx} ${cy-dh/2} L ${cx+dw/2} ${cy} L ${cx} ${cy+dh/2} L ${cx-dw/2} ${cy} Z`);
        set(d, strokeCommon); d.setAttribute("class","glow"); svg.appendChild(d);
        shapes.push({ cx, cy, left:cx-dw/2, right:cx+dw/2, top:cy-dh/2, bottom:cy+dh/2 });
      }

      const fs = it.label.includes("LTV/CAC") ? C.FONT_SIZE-1 : C.FONT_SIZE;
      svg.appendChild(textCenter(it.label, cx, cy, fs));
      y += H + G;
    });

    // vertical connectors between shapes
    for (let i=0;i<shapes.length-1;i++){
      const a = shapes[i], b2 = shapes[i+1];
      const link = document.createElementNS(ns,"line");
      set(link, { x1:a.cx, y1:a.bottom+4, x2:b2.cx, y2:b2.top-4,
                  stroke:"url(#gradFlow)", "stroke-width":1.8, "stroke-linecap":"round" });
      link.setAttribute("class","glow");
      svg.appendChild(link);
    }

    // three dots under the diamond
    const last = shapes[shapes.length-1];
    const y0 = last.bottom + 10;
    for (let i=0;i<3;i++){
      const c = document.createElementNS(ns,"circle");
      set(c, { cx:last.cx, cy:y0 + i*10, r:2.4 });
      c.setAttribute("fill","rgba(99,211,255,.95)");
      c.style.filter = "drop-shadow(0 0 8px rgba(99,211,255,.5)) drop-shadow(0 0 14px rgba(242,220,160,.35))";
      svg.appendChild(c);
    }

    // ----- rails (now connected and copy-safe) -----
    // LEFT: stop before copy, then a short stub connects to the first box (no text overlap).
    const first = shapes[0];
    const copyRect = copyEl.getBoundingClientRect();
    const copyLeftInSvg = copyRect.left - b.left; // convert to this SVG’s x-space
    const xStop = Math.max(6, copyLeftInSvg - C.LINE_MARGIN_FROM_COPY);
    const yLine = first.cy;

    const leftRail = document.createElementNS(ns,"line");
    set(leftRail, { x1:6, y1:yLine, x2:xStop, y2:yLine,
                    stroke:"url(#gradFlow)", "stroke-width":2.2, "stroke-linecap":"round" });
    leftRail.setAttribute("class","glow"); svg.appendChild(leftRail);

    // short connector from rail end to the first box’s left edge (keeps the “connected” feel)
    const stub = document.createElementNS(ns,"line");
    const stubStart = Math.min(xStop + 8, first.left - 8); // keep it short and never hit the copy
    set(stub, { x1:stubStart, y1:yLine, x2:first.left, y2:yLine,
                stroke:"url(#gradFlow)", "stroke-width":2.2, "stroke-linecap":"round" });
    stub.setAttribute("class","glow"); svg.appendChild(stub);

    // RIGHT: start at the last box’s right edge → screen edge
    const rightRail = document.createElementNS(ns,"line");
    set(rightRail, { x1:last.right, y1:yLine, x2:xTrailEnd, y2:yLine,
                     stroke:"url(#gradTrailFlow)", "stroke-width":2.2, "stroke-linecap":"round" });
    rightRail.setAttribute("class","glow"); svg.appendChild(rightRail);
  };
})();