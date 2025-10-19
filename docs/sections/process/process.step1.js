// docs/sections/process/steps/process.step1.js
(() => {
  // Register Step 1 scene. This file draws the “Intent Score” stack.
  const SCENES = (window.PROCESS_SCENES = window.PROCESS_SCENES || {});
  const CFG     = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
  CFG.step1     = CFG.step1 || {};

  SCENES[1] = function renderStep1(ctx){
    // ---- safety / env ----
    const ns     = ctx.ns || "http://www.w3.org/2000/svg";
    const b      = (typeof ctx.bounds === "function") ? ctx.bounds() : ctx.bounds;
    const C      = CFG.step1;

    if (!ctx.canvas || !b || !b.width || !b.sH) return; // hard-guard to avoid NaN

    // ---- stage ----
    const nodeW = b.width;
    const nodeH = Math.min(560, b.sH - 40);
    const svg   = document.createElementNS(ns, "svg");
    svg.setAttribute("width",  nodeW);
    svg.setAttribute("height", nodeH);
    svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";

    // unique ids so multiple repaints don’t collide
    const uid = "s1_" + Math.random().toString(36).slice(2, 8);

    // ---- helpers ----
    const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

    function rrPath(cx, cy, w, h, r){
      r = clamp(r, 0, Math.min(w, h)/2);
      const x = cx - w/2, y = cy - h/2;
      const xr = x + w, yr = y + h, r2 = r * 2;
      return [
        `M ${x+r} ${y}`,
        `H ${xr-r}`,
        `Q ${xr} ${y} ${xr} ${y+r}`,
        `V ${yr-r}`,
        `Q ${xr} ${yr} ${xr-r} ${yr}`,
        `H ${x+r}`,
        `Q ${x} ${yr} ${x} ${yr-r}`,
        `V ${y+r}`,
        `Q ${x} ${y} ${x+r} ${y}`,
        "Z"
      ].join(" ");
    }
    function diamondPath(cx, cy, w, h, scale=1){
      const hw = (w*scale)/2, hh = (h*scale)/2;
      return `M ${cx} ${cy-hh} L ${cx+hw} ${cy} L ${cx} ${cy+hh} L ${cx-hw} ${cy} Z`;
    }

    // flowing gradients (cyan↔gold), matching Step 0
    function makeStrokeGradient(id, x1, y1, x2, y2, moveBy, dur){
      const g = document.createElementNS(ns, "linearGradient");
      g.setAttribute("id", id);
      g.setAttribute("gradientUnits", "userSpaceOnUse");
      g.setAttribute("x1", x1); g.setAttribute("y1", y1);
      g.setAttribute("x2", x2); g.setAttribute("y2", y2);

      // same stop recipe you loved on step 0
      const stops = [
        ["0%",   "rgba(230,195,107,.95)"], // warm gold
        ["35%",  "rgba(255,255,255,.95)"], // white pop
        ["75%",  "rgba(99,211,255,.95)"],  // cyan
        ["100%", "rgba(99,211,255,.60)"]
      ];
      for (const [o,c] of stops){
        const s = document.createElementNS(ns, "stop");
        s.setAttribute("offset", o); s.setAttribute("stop-color", c);
        g.appendChild(s);
      }
      // flow across the ENTIRE segment (so it completes its journey)
      const a = document.createElementNS(ns, "animateTransform");
      a.setAttribute("attributeName","gradientTransform");
      a.setAttribute("type","translate");
      a.setAttribute("from","0 0");
      a.setAttribute("to", `${moveBy} 0`);
      a.setAttribute("dur", (C.FLOW_SPEED_S || 6.5) + "s");
      a.setAttribute("repeatCount","indefinite");
      g.appendChild(a);
      return g;
    }

    // ---- sizes / placement from config (your exact knobs) ----
    const BOX_W = nodeW * (C.BOX_W_RATIO   ?? 0.100);
    const BOX_H = nodeW * (C.BOX_H_RATIO   ?? 0.12);
    const GAP   = nodeW * (C.GAP_RATIO     ?? 0.035);

    const stackCX = (nodeW * (C.STACK_X_RATIO ?? 0.705)) + (C.NUDGE_X || 0);
    const stackTop= (nodeH * (C.STACK_TOP_RATIO ?? 0.21)) + (C.NUDGE_Y || 0);

    const R_RECT   = (C.RADIUS_RECT   ?? 18);
    const R_PILL   = (C.RADIUS_PILL   ?? 18);
    const R_OVAL   = (C.RADIUS_OVAL   ?? 999);
    const DIA_SCALE= (C.DIAMOND_SCALE ?? 1);

    const STROKE_PX = (C.STROKE_PX ?? 2.8);
    const LINE_STROKE = (C.LINE_STROKE_PX ?? 2.5);
    const GLOW = (C.GLOW_PX ?? 16);

    const CONNECT_X_PAD = (C.CONNECT_X_PAD ?? 8);
    const LEFT_STOP  = b.left + b.width * (C.LEFT_STOP_RATIO ?? 0.35);
    const RIGHT_END  = b.left + b.width - (C.RIGHT_MARGIN_PX ?? 16);

    // ---- defs (all gradients) ----
    const defs = document.createElementNS(ns, "defs");
    svg.appendChild(defs);

    // gradient for long horizontal rail
    const railYAnchorBias = (C.H_LINE_Y_BIAS ?? -0.06); // vs first box center
    // we know first box center y now (compute first)
    const y1 = stackTop + BOX_H/2 + railYAnchorBias*BOX_H;

    const gradRailId  = `grad-rail-${uid}`;
    defs.appendChild(makeStrokeGradient(gradRailId, LEFT_STOP, y1, RIGHT_END, y1, (RIGHT_END - LEFT_STOP), (C.FLOW_SPEED_S || 6.5)));

    // gradient for shapes (each built with its own width to ensure full traversal)
    function gradForShape(xStart, xEnd, idSuffix){
      const id = `grad-shape-${idSuffix}-${uid}`;
      defs.appendChild(makeStrokeGradient(id, xStart, y1, xEnd, y1, (xEnd - xStart), (C.FLOW_SPEED_S || 6.5)));
      return id;
    }

    // ---- group
    const g = document.createElementNS(ns,"g");
    g.setAttribute("filter", `drop-shadow(0 0 ${GLOW}px rgba(99,211,255,.40)) drop-shadow(0 0 ${GLOW*0.6}px rgba(242,220,160,.30))`);
    svg.appendChild(g);

    // ---- title (optional)
    if (C.TITLE_SHOW){
      const tx = stackCX + (C.TITLE_OFFSET_X || 0);
      const ty = (stackTop - BOX_H*0.8) + (C.TITLE_OFFSET_Y || 0);
      const title = document.createElementNS(ns,"text");
      title.setAttribute("x", tx);
      title.setAttribute("y", ty);
      title.setAttribute("text-anchor","middle");
      title.setAttribute("fill","#cfe3f3");
      title.setAttribute("font-size", (C.TITLE_PT||14));
      title.setAttribute("font-weight", (C.TITLE_WEIGHT||700));
      title.setAttribute("font-family", C.TITLE_FAMILY || 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif');
      if (C.TITLE_LETTER_SPACING!=null) title.style.letterSpacing = C.TITLE_LETTER_SPACING+"px";
      title.textContent = C.TITLE_TEXT || "Intent Score";
      g.appendChild(title);
    }

    // ---- boxes layout
    const items = [
      { kind:"rect",   label:C.LABEL_RECT_1   || "Number of Searches / TimeBlock",  r:R_PILL },
      { kind:"rect",   label:C.LABEL_RECT_2   || "Technologies used at the location", r:R_PILL },
      { kind:"rect",   label:C.LABEL_ROUND_3  || "Number of customers based on LTV/CAC", r:R_RECT },
      { kind:"oval",   label:C.LABEL_OVAL_4   || "Tools interacted" },
      { kind:"diamond",label:C.LABEL_DIAMOND_5|| "Company Size" }
    ];

    const centers = []; // keep for connectors
    let cy = stackTop + BOX_H/2;

    items.forEach((it, i)=>{
      const cx = stackCX;
      centers.push({cx, cy});

      // gradient along this shape width so flow completes the entire outline
      const gradId = gradForShape(cx-BOX_W/2, cx+BOX_W/2, "box"+i);

      if (it.kind==="oval"){
        const ellipse = document.createElementNS(ns,"ellipse");
        ellipse.setAttribute("cx", cx);
        ellipse.setAttribute("cy", cy);
        ellipse.setAttribute("rx", BOX_W/2);
        ellipse.setAttribute("ry", BOX_H/2);
        ellipse.setAttribute("fill","none");
        ellipse.setAttribute("stroke", `url(#${gradId})`);
        ellipse.setAttribute("stroke-width", STROKE_PX);
        g.appendChild(ellipse);
      } else if (it.kind==="diamond"){
        const p = document.createElementNS(ns,"path");
        p.setAttribute("d", diamondPath(cx, cy, BOX_W, BOX_H, (DIA_SCALE || 1)));
        p.setAttribute("fill","none");
        p.setAttribute("stroke", `url(#${gradId})`);
        p.setAttribute("stroke-width", STROKE_PX);
        g.appendChild(p);
      } else {
        const p = document.createElementNS(ns,"path");
        p.setAttribute("d", rrPath(cx, cy, BOX_W, BOX_H, it.r || R_RECT));
        p.setAttribute("fill","none");
        p.setAttribute("stroke", `url(#${gradId})`);
        p.setAttribute("stroke-linejoin","round");
        p.setAttribute("stroke-width", STROKE_PX);
        g.appendChild(p);
      }

      // label via foreignObject for wrapping + padding
      const fo = document.createElementNS(ns,"foreignObject");
      const padX = (C.PADDING_X ?? 4), padY = (C.PADDING_Y ?? 4);
      fo.setAttribute("x", (cx - BOX_W/2 + padX));
      fo.setAttribute("y", (cy - BOX_H/2 + padY));
      fo.setAttribute("width",  Math.max(1, BOX_W - padX*2));
      fo.setAttribute("height", Math.max(1, BOX_H - padY*2));
      const div = document.createElement("div");
      div.setAttribute("xmlns","http://www.w3.org/1999/xhtml");
      div.style.width = "100%";
      div.style.height= "100%";
      div.style.display="grid";
      div.style.placeItems="center";
      div.style.textAlign="center";
      div.style.color = "#eaf6ff";
      div.style.fontFamily = C.FONT_FAMILY_BOX || 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      div.style.fontWeight = (C.FONT_WEIGHT_BOX ?? 525);
      div.style.letterSpacing = (C.FONT_LETTER_SPACING ?? 0.3) + "px";
      div.style.lineHeight = (C.LINE_HEIGHT_EM ?? 1.15);
      const size =
        (it.kind==="diamond") ? (C.FONT_PT_DIAMOND ?? 7) :
        (it.kind==="oval")    ? (C.FONT_PT_OVAL    ?? 8) :
        (C.FONT_PT_PILL ?? C.FONT_PT_ROUND ?? 8);
      div.style.fontSize = size + "pt";
      div.textContent = C.UPPERCASE ? (it.label || "").toUpperCase() : (it.label || "");
      fo.appendChild(div);
      g.appendChild(fo);

      cy += BOX_H + GAP;
    });

    // ---- horizontal rails (left & right), connected to first box
    if (C.SHOW_LEFT_LINE || C.SHOW_RIGHT_LINE){
      const first = centers[0];
      const yRail = first.cy + (C.H_LINE_Y_BIAS ?? -0.06)*BOX_H;
      const leftAttach  = first.cx - BOX_W/2 - CONNECT_X_PAD;
      const rightAttach = first.cx + BOX_W/2 + CONNECT_X_PAD;

      // long gradient already sized LEFT_STOP -> RIGHT_END so it traverses the full journey
      const makeLine = (x1, x2)=>{
        const line = document.createElementNS(ns,"line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", yRail);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", yRail);
        line.setAttribute("stroke", `url(#${gradRailId})`);
        line.setAttribute("stroke-width", LINE_STROKE);
        line.setAttribute("stroke-linecap","round");
        g.appendChild(line);
      };

      if (C.SHOW_LEFT_LINE && xFinite(LEFT_STOP) && xFinite(leftAttach) && LEFT_STOP < leftAttach){
        makeLine(LEFT_STOP, leftAttach);
      }
      if (C.SHOW_RIGHT_LINE && xFinite(rightAttach) && xFinite(RIGHT_END) && rightAttach < RIGHT_END){
        makeLine(rightAttach, RIGHT_END);
      }
    }

    // ---- vertical connectors between shapes (the “rails” you asked for)
    for (let i=0;i<centers.length-1;i++){
      const a = centers[i], b2 = centers[i+1];
      const x = a.cx;
      const y1c = a.cy + BOX_H/2 + 4;
      const y2c = b2.cy - BOX_H/2 - 4;
      const gradId = gradForShape(x-1, x+1, "v"+i);
      const line = document.createElementNS(ns,"line");
      line.setAttribute("x1", x); line.setAttribute("y1", y1c);
      line.setAttribute("x2", x); line.setAttribute("y2", y2c);
      line.setAttribute("stroke", `url(#${gradId})`);
      line.setAttribute("stroke-width", LINE_STROKE);
      g.appendChild(line);
    }

    // ---- the three dots (same cyan family)
    const dotsGroup = document.createElementNS(ns,"g");
    const dotCount = (C.DOTS_COUNT ?? 3);
    const size = (C.DOTS_SIZE_PX ?? 2.2);
    let dy = (C.DOTS_Y_OFFSET ?? 26);
    const gap = (C.DOTS_GAP_PX ?? 26);
    const last = centers[centers.length-1];
    for (let i=0;i<dotCount;i++){
      const c = document.createElementNS(ns,"circle");
      c.setAttribute("cx", last.cx);
      c.setAttribute("cy", last.cy + BOX_H/2 + dy);
      c.setAttribute("r", size);
      c.setAttribute("fill", C.COLOR_CYAN || "rgba(99,211,255,0.95)");
      dotsGroup.appendChild(c);
      dy += gap;
    }
    g.appendChild(dotsGroup);

    // mount svg
    ctx.canvas.appendChild(svg);

    // ---- helpers ----
    function xFinite(v){ return Number.isFinite(v) && !Number.isNaN(v); }
  };
})();