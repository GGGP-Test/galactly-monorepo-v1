// sections/process/steps/process.step1.js
(() => {
  const ns = "http://www.w3.org/2000/svg";

  // Ensure globals exist and give Step 1 its own bucket
  window.PROCESS_CONFIG = window.PROCESS_CONFIG || {};
  const ROOT = window.PROCESS_CONFIG;
  ROOT.step1 = ROOT.step1 || {};
  ROOT.step1.COPY = ROOT.step1.COPY || {};

  // Safe repaint helper (works even if process.js didn’t define one)
  if (typeof window.PROCESS_REPAINT !== "function") {
    window.PROCESS_REPAINT = () => {
      // process.js redraws on resize; this piggybacks that path.
      window.dispatchEvent(new Event("resize"));
    };
  }

  // Register the scene for step 1
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[1] = function sceneStep1(ctx) {
    const canvas = ctx.canvas;
    const b = ctx.bounds; // already an object (not a function)
    const makeFlowGradients = ctx.makeFlowGradients || (() => document.createElementNS(ns, "defs"));

    // ---- defaults (all ratios are of the lamp area) ----
    const DEF = {
      // stack sizing / placement (independent of copy)
      BOX_W_RATIO: 0.34,   // squarer boxes
      BOX_H_RATIO: 0.12,
      GAP_RATIO:    0.065,
      STACK_X_RATIO: 0.70, // center of the stack within the lamp
      STACK_TOP_RATIO: 0.22,
      NUDGE_X: 0,          // px fine-tune (boxes only)
      NUDGE_Y: 0,          // px fine-tune (boxes only)

      // label sizes
      FONT_PT: 12,
      FONT_PT_PILL: 12,
      FONT_PT_DIAMOND: 11,

      // rails
      LEFT_STOP_RATIO: 0.38,  // how early the left rail stops
      RIGHT_MARGIN_PX: 10,    // right rail padding from screen edge

      // copy (independent)
      COPY: {
        LEFT_MARGIN_PX: 24,   // inside lamp seam
        TOP_RATIO: 0.18,
        WIDTH_MAX: 320,
        TITLE: "Who buys the fastest?",
        HTML: `<p>We rank accounts by a <b>live intent score</b> built for packaging suppliers:
               searches per time block, technology on site, customer scale by <b>LTV/CAC</b>,
               the tools they interact with, and company size. The score bubbles up buyers most
               likely to convert <b>now</b> so your team prioritizes quotes, samples, and demos
               that close quickly.</p>`,
        NUDGE_X: 0,
        NUDGE_Y: 0,
        SHOW_LEFT_LINE: true
      }
    };

    // Merge ROOT.step1 over defaults (including nested COPY)
    const C = Object.assign({}, DEF, ROOT.step1);
    C.COPY = Object.assign({}, DEF.COPY, ROOT.step1.COPY || {});

    // ----- derived sizes -----
    const W = b.width;
    const H = Math.min(560, b.sH - 40);
    const boxW = Math.max(180, C.BOX_W_RATIO * W);
    const boxH = Math.max(56,  C.BOX_H_RATIO * H);
    const gap  = Math.max(12,  C.GAP_RATIO    * H);

    const stackX   = b.left + C.STACK_X_RATIO * W + C.NUDGE_X; // visual center of boxes
    const stackTop = b.top  + C.STACK_TOP_RATIO * H + C.NUDGE_Y;

    // SVG stage
    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    canvas.appendChild(svg);

    // Helpers
    const rr = (x,y,w,h,r) => (
      `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h}` +
      ` H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`
    );
    const diamond = (x,y,w,h) => {
      const cx = x + w/2, cy = y + h/2;
      return `M ${cx} ${y} L ${x+w} ${cy} L ${cx} ${y+h} L ${x} ${cy} Z`;
    };
    const addCenteredText = (x, y, str, size, weight=800) => {
      const t = document.createElementNS(ns,"text");
      t.setAttribute("x", x);
      t.setAttribute("y", y);
      t.setAttribute("fill", "#eaf3f9");
      t.setAttribute("font-size", String(size));
      t.setAttribute("font-weight", String(weight));
      t.setAttribute("font-family", "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "middle");
      t.textContent = str;
      return t;
    };

    // Rows: 2 rounded-rects → capsule → oval → diamond
    const rows = [
      { label:"Number of Searches / TimeBlock",               kind:"rect"    },
      { label:"Technologies used at the location",            kind:"rect"    },
      { label:"Number of customers based on LTV/CAC",         kind:"capsule" },
      { label:"Tools interacted",                              kind:"oval"    },
      { label:"Company Size",                                  kind:"diamond" },
    ];

    // Flow gradients anchored to the first box
    const firstX = stackX - boxW/2;
    const firstY = stackTop;
    const yMidFirst = firstY + boxH/2;
    const xRightEnd = (b.sW - C.RIGHT_MARGIN_PX) - b.left;
    svg.appendChild(makeFlowGradients({
      pillX: firstX, pillY: firstY, pillW: boxW, yMid: yMidFirst, xTrailEnd: xRightEnd
    }));

    // Right rail: connected to the first box, not through it
    const rightLine = document.createElementNS(ns,"line");
    rightLine.setAttribute("x1", firstX + boxW);
    rightLine.setAttribute("y1", yMidFirst);
    rightLine.setAttribute("x2", xRightEnd);
    rightLine.setAttribute("y2", yMidFirst);
    rightLine.setAttribute("stroke","url(#gradTrailFlow)");
    rightLine.setAttribute("stroke-width","2.5");
    rightLine.setAttribute("stroke-linecap","round");
    rightLine.setAttribute("class","glow");
    svg.appendChild(rightLine);

    // Draw the stack
    rows.forEach((row, i) => {
      const x = stackX - boxW/2;
      const y = stackTop + i * (boxH + gap);
      const g = document.createElementNS(ns,"g");
      svg.appendChild(g);

      if (row.kind === "rect" || row.kind === "capsule") {
        const r = row.kind === "rect" ? Math.min(12, boxH*0.18) : Math.min(boxH/2, 18);
        const p = document.createElementNS(ns,"path");
        p.setAttribute("d", rr(x,y,boxW,boxH,r));
        p.setAttribute("fill","none"); p.setAttribute("stroke","url(#gradFlow)");
        p.setAttribute("stroke-width","2.2"); p.setAttribute("class","glow");
        g.appendChild(p);

        g.appendChild(addCenteredText(x+boxW/2, y+boxH/2, row.label, C.FONT_PT));
      }
      else if (row.kind === "oval") {
        const cx = x + boxW/2, cy = y + boxH/2;
        const o = document.createElementNS(ns,"ellipse");
        o.setAttribute("cx", cx); o.setAttribute("cy", cy);
        o.setAttribute("rx", boxW/2); o.setAttribute("ry", boxH/2);
        o.setAttribute("fill","none"); o.setAttribute("stroke","url(#gradFlow)");
        o.setAttribute("stroke-width","2.2"); o.setAttribute("class","glow");
        g.appendChild(o);

        g.appendChild(addCenteredText(cx, cy, row.label, C.FONT_PT_PILL));
      }
      else if (row.kind === "diamond") {
        const d = document.createElementNS(ns,"path");
        d.setAttribute("d", diamond(x,y,boxW,boxH));
        d.setAttribute("fill","none"); d.setAttribute("stroke","url(#gradFlow)");
        d.setAttribute("stroke-width","2.2"); d.setAttribute("class","glow");
        g.appendChild(d);

        g.appendChild(addCenteredText(x+boxW/2, y+boxH/2, row.label, C.FONT_PT_DIAMOND));

        // trailing dots
        const cx = x + boxW/2;
        const startY = y + boxH + 18;
        for (let k=0;k<3;k++){
          const c = document.createElementNS(ns,"circle");
          c.setAttribute("cx", cx);
          c.setAttribute("cy", startY + k*12);
          c.setAttribute("r", 2.3);
          c.setAttribute("fill", "rgba(242,220,160,0.95)");
          c.setAttribute("class","glow");
          g.appendChild(c);
        }
      }

      // subtle vertical connector between rows
      if (i < rows.length - 1) {
        const v = document.createElementNS(ns,"line");
        v.setAttribute("x1", stackX); v.setAttribute("x2", stackX);
        v.setAttribute("y1", y + boxH); v.setAttribute("y2", y + boxH + gap);
        v.setAttribute("stroke","rgba(242,220,160,.45)");
        v.setAttribute("stroke-width","1.4");
        svg.appendChild(v);
      }
    });

    // Copy block (independent of stack)
    const copyLeft = b.left + Math.max(C.COPY.LEFT_MARGIN_PX, 24) + (C.COPY.NUDGE_X || 0);
    const copyTop  = b.top  + C.COPY.TOP_RATIO * H + (C.COPY.NUDGE_Y || 0);
    const copy = document.createElement("div");
    copy.className = "copy";
    copy.style.left = `${copyLeft}px`;
    copy.style.top  = `${copyTop}px`;
    copy.style.maxWidth = (C.COPY.WIDTH_MAX || 320) + "px";
    copy.innerHTML = `<h3>${C.COPY.TITLE}</h3>${C.COPY.HTML}`;
    canvas.appendChild(copy);
    requestAnimationFrame(() => copy.classList.add("show"));

    // Left rail: stops before the copy (aligned to title baseline)
    if (C.COPY.SHOW_LEFT_LINE) {
      const leftLine = document.createElementNS(ns,"line");
      const stopX = C.LEFT_STOP_RATIO * W;
      const title = copy.querySelector("h3");
      const r = title ? title.getBoundingClientRect() : { top: copyTop + 4, height: 24 };
      const baseline = (r.top - b.top) + r.height * 0.62; // svg-local Y
      leftLine.setAttribute("x1", 0);
      leftLine.setAttribute("x2", stopX);
      leftLine.setAttribute("y1", baseline);
      leftLine.setAttribute("y2", baseline);
      leftLine.setAttribute("stroke","url(#gradTrailFlow)");
      leftLine.setAttribute("stroke-width","2.5");
      leftLine.setAttribute("stroke-linecap","round");
      leftLine.setAttribute("class","glow");
      svg.appendChild(leftLine);
    }
  };
})();