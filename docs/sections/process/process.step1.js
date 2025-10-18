// sections/process/steps/process.step1.js
(() => {
  // Register STEP 1 scene. process.js will call us with a fresh config clone.
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[1] = function sceneStep1(ctx){
    const ns = (ctx && ctx.ns) || "http://www.w3.org/2000/svg";
    const canvas = ctx.canvas;
    const b = (ctx && ctx.bounds) || (window.PROCESS_GET_BOUNDS && window.PROCESS_GET_BOUNDS()) || {left:0, top:0, width:800, sH:560, sW:1200};
    const makeFlowGradients = (ctx && ctx.makeFlowGradients) || (()=>document.createElementNS(ns,"defs"));

    // ----- defaults (all ratios are of the lamp area) -----
    const C = Object.assign({
      // stack sizing/placement (independent from copy)
      BOX_W_RATIO: 0.32,   // width ≈ 32% lamp width (squarer)
      BOX_H_RATIO: 0.12,   // height ≈ 12% lamp height
      GAP_RATIO:    0.06,  // vertical gap between boxes
      STACK_X_RATIO: 0.69, // horizontal anchor of stack center
      STACK_TOP_RATIO: 0.24,
      NUDGE_X: 0,          // px fine-tune (boxes only)
      NUDGE_Y: 0,          // px fine-tune (boxes only)

      // fonts
      FONT_PT: 13,         // base font size for rectangles
      FONT_PT_PILL: 13,    // for capsule/oval
      FONT_PT_DIAMOND: 12,

      // rails
      LEFT_STOP_RATIO: 0.40,   // left rail stops before copy (as % of lamp width)
      RIGHT_MARGIN_PX: 10,     // how far to the right edge it should go

      // copy (independent from stack)
      COPY: {
        LEFT_MARGIN_PX: 24,    // inside lamp
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
        SHOW_LEFT_LINE: true,
      }
    }, ctx && ctx.config ? ctx.config : {});

    // ----- derived sizes -----
    const W = b.width;
    const H = Math.min(560, b.sH - 40);
    const boxW = Math.max(180, C.BOX_W_RATIO * W);
    const boxH = Math.max(56,  C.BOX_H_RATIO * H);
    const gap  = Math.max(12,  C.GAP_RATIO    * H);

    // stack anchor (center of first row)
    const stackX = b.left + C.STACK_X_RATIO * W + C.NUDGE_X;
    const stackTop = b.top + C.STACK_TOP_RATIO * H + C.NUDGE_Y;

    // helper: create SVG stage
    const svg = document.createElementNS(ns,"svg");
    svg.style.position="absolute"; svg.style.left=b.left+"px"; svg.style.top=b.top+"px";
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    canvas.appendChild(svg);

    // helper: text in the middle
    function addCenteredText(x, y, str, size, weight=800){
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
    }

    // helper: rounded rect path (radius)
    function rr(x,y,w,h,r){
      const d = [
        `M ${x+r} ${y}`,
        `H ${x+w-r}`,
        `Q ${x+w} ${y} ${x+w} ${y+r}`,
        `V ${y+h-r}`,
        `Q ${x+w} ${y+h} ${x+w-r} ${y+h}`,
        `H ${x+r}`,
        `Q ${x} ${y+h} ${x} ${y+h-r}`,
        `V ${y+r}`,
        `Q ${x} ${y} ${x+r} ${y}`,
        `Z`
      ].join(" ");
      return d;
    }

    // helper: diamond path
    function diamond(x,y,w,h){
      const cx=x+w/2, cy=y+h/2;
      return `M ${cx} ${y} L ${x+w} ${cy} L ${cx} ${y+h} L ${x} ${cy} Z`;
    }

    // stack positions
    const rows = [
      { key:"r1", label:"Number of Searches / TimeBlock", kind:"rect"    },
      { key:"r2", label:"Technologies used at the location", kind:"rect" },
      { key:"r3", label:"Number of customers based on LTV/CAC", kind:"capsule" },
      { key:"r4", label:"Tools interacted", kind:"oval" },
      { key:"r5", label:"Company Size", kind:"diamond" },
    ];

    // gradient flow anchored to first box leading to right edge
    const firstX = stackX - boxW/2;
    const firstY = stackTop;
    const yMidFirst = firstY + boxH/2;
    const xRightEnd = (b.sW - C.RIGHT_MARGIN_PX) - b.left;
    svg.appendChild(makeFlowGradients({
      pillX: firstX, pillY: firstY, pillW: boxW,
      yMid: yMidFirst, xTrailEnd: xRightEnd
    }));

    // draw left rail (stops before copy) and right rail (connected to first box)
    // Left rail Y is aligned with copy title baseline; we’ll compute after mounting copy.
    const leftLine = document.createElementNS(ns,"line");
    const leftRailStartX = 0; // visually from lamp’s left edge
    const leftRailEndX   = C.LEFT_STOP_RATIO * W;
    leftLine.setAttribute("x1", leftRailStartX);
    leftLine.setAttribute("x2", leftRailEndX);
    // y1/y2 set later after copy is placed
    leftLine.setAttribute("stroke","url(#gradTrailFlow)");
    leftLine.setAttribute("stroke-width","2.5");
    leftLine.setAttribute("stroke-linecap","round");
    leftLine.setAttribute("class","glow");
    svg.appendChild(leftLine);

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

    // draw each row
    rows.forEach((row, i)=>{
      const x = stackX - boxW/2;
      const y = stackTop + i*(boxH + gap);
      const group = document.createElementNS(ns,"g"); svg.appendChild(group);

      if (row.kind==="rect" || row.kind==="capsule"){
        const r = row.kind==="rect" ? Math.min(12, boxH*0.18) : Math.min(boxH/2, 18); // capsule is very round
        const p = document.createElementNS(ns,"path");
        p.setAttribute("d", rr(x,y,boxW,boxH,r));
        p.setAttribute("fill","none"); p.setAttribute("stroke","url(#gradFlow)");
        p.setAttribute("stroke-width","2.2"); p.setAttribute("class","glow");
        group.appendChild(p);

        const txt = addCenteredText(x+boxW/2, y+boxH/2, row.label, C.FONT_PT);
        group.appendChild(txt);
      }
      else if (row.kind==="oval"){
        const cx = x + boxW/2, cy = y + boxH/2;
        const rx = boxW/2, ry = boxH/2;
        const o = document.createElementNS(ns,"ellipse");
        o.setAttribute("cx", cx); o.setAttribute("cy", cy);
        o.setAttribute("rx", rx); o.setAttribute("ry", ry);
        o.setAttribute("fill","none"); o.setAttribute("stroke","url(#gradFlow)");
        o.setAttribute("stroke-width","2.2"); o.setAttribute("class","glow");
        group.appendChild(o);

        const txt = addCenteredText(cx, cy, row.label, C.FONT_PT_PILL);
        group.appendChild(txt);
      }
      else if (row.kind==="diamond"){
        const d = document.createElementNS(ns,"path");
        d.setAttribute("d", diamond(x,y,boxW,boxH));
        d.setAttribute("fill","none"); d.setAttribute("stroke","url(#gradFlow)");
        d.setAttribute("stroke-width","2.2"); d.setAttribute("class","glow");
        group.appendChild(d);

        const txt = addCenteredText(x+boxW/2, y+boxH/2, row.label, C.FONT_PT_DIAMOND);
        group.appendChild(txt);

        // three dots below the diamond
        const dotCx = x + boxW/2;
        const dotStartY = y + boxH + 18;
        for (let k=0;k<3;k++){
          const circ = document.createElementNS(ns,"circle");
          circ.setAttribute("cx", dotCx);
          circ.setAttribute("cy", dotStartY + k*12);
          circ.setAttribute("r", 2.3);
          circ.setAttribute("fill", "rgba(242,220,160,0.95)");
          circ.setAttribute("class","glow");
          group.appendChild(circ);
        }
      }

      // connector downwards (subtle)
      if (i < rows.length-1){
        const line = document.createElementNS(ns,"line");
        line.setAttribute("x1", stackX); line.setAttribute("x2", stackX);
        line.setAttribute("y1", y + boxH); line.setAttribute("y2", y + boxH + gap);
        line.setAttribute("stroke","rgba(242,220,160,.45)");
        line.setAttribute("stroke-width","1.4");
        svg.appendChild(line);
      }
    });

    // ----- copy block (independent) -----
    const copyLeft = b.left + Math.max(C.COPY.LEFT_MARGIN_PX, 24) + (C.COPY.NUDGE_X||0);
    const copyTop  = b.top + C.COPY.TOP_RATIO*H + (C.COPY.NUDGE_Y||0);

    const copyEl = document.createElement("div");
    copyEl.className = "copy";
    copyEl.style.left = `${copyLeft}px`;
    copyEl.style.top  = `${copyTop}px`;
    copyEl.style.maxWidth = (C.COPY.WIDTH_MAX||320) + "px";
    copyEl.innerHTML = `<h3>${C.COPY.TITLE}</h3>${C.COPY.HTML}`;
    canvas.appendChild(copyEl);
    requestAnimationFrame(()=>copyEl.classList.add("show"));

    // position left rail on the title baseline and stop before the copy
    if (C.COPY.SHOW_LEFT_LINE){
      const h3 = copyEl.querySelector("h3");
      const r = h3 ? h3.getBoundingClientRect() : { top: copyTop+4, height: 24 };
      const baseline = (r.top - b.top) + r.height*0.62; // local Y inside SVG
      leftLine.setAttribute("y1", baseline);
      leftLine.setAttribute("y2", baseline);
    } else {
      svg.removeChild(leftLine);
    }
  };
})();