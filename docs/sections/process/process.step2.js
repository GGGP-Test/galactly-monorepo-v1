// docs/sections/process/process.step2.js
(() => {
  if (!window.PROCESS_SCENES) return;

  // Tunable knobs for Step 2 (safe to edit without touching code below)
  window.PROCESS_CONFIG = Object.assign(
    {
      step2: {
        NUDGE_X: 90,          // move the Step 2 pill horizontally
        NUDGE_Y: 24,          // move the Step 2 pill vertically (copy won't follow)
        COPY_GAP: 48,         // space between pill and copy block
        LABEL: "persona + metrics",
        LEAD_IN: true,        // draw a flowing line coming IN from the left
        LEAD_OUT: true        // draw a flowing line going OUT to the right edge
      }
    },
    window.PROCESS_CONFIG || {}
  );

  // Register this scene with the controller
  window.PROCESS_SCENES[2] = function sceneStep2(ctx){
    const { ns, canvas, bounds: b, config, makeFlowGradients, mountCopy } = ctx;
    const C = config.step2;

    // SVG staging box inside the lamp
    const nodeW = b.width, nodeH = Math.min(560, b.sH - 40);
    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width",  nodeW);
    svg.setAttribute("height", nodeH);
    svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);
    canvas.appendChild(svg);

    // Geometry for the pill (stroke-only rounded rectangle)
    const pillW = Math.min(460, nodeW * 0.50);
    const pillH = 80;
    const lampCenter = nodeW / 2;
    const leftBias   = Math.min(78, nodeW * 0.08);

    const basePillY  = Math.max(12, nodeH * 0.22); // copy uses this (not affected by NUDGE_Y)
    const pillX      = Math.max(18, lampCenter - leftBias - pillW / 2 + C.NUDGE_X);
    const pillY      = basePillY + C.NUDGE_Y;
    const r          = 16;
    const yMid       = pillY + pillH / 2;

    // Screen edges (for continuous cable)
    const xTrailEnd  = (b.sW - 10) - b.left; // right edge in this svg's coords
    const xTrailStart= 8;                    // a little inset from the left edge

    // Liquid gradients (outgoing cable + pill outline)
    svg.appendChild(makeFlowGradients({ pillX, pillY, pillW, yMid, xTrailEnd }));

    // Extra gradient for the incoming cable (left → pill)
    const defsIn = document.createElementNS(ns, "defs");
    const gIn = document.createElementNS(ns, "linearGradient");
    gIn.id = "gradTrailFlowIn";
    gIn.setAttribute("gradientUnits", "userSpaceOnUse");
    gIn.setAttribute("x1", xTrailStart); gIn.setAttribute("y1", yMid);
    gIn.setAttribute("x2", pillX);       gIn.setAttribute("y2", yMid);
    [
      ["0%",  "rgba(99,211,255,.75)"],
      ["55%", "rgba(255,255,255,.90)"],
      ["100%","rgba(230,195,107,.92)"]
    ].forEach(([o,c])=>{
      const stop = document.createElementNS(ns,"stop");
      stop.setAttribute("offset", o); stop.setAttribute("stop-color", c);
      gIn.appendChild(stop);
    });
    const aIn = document.createElementNS(ns, "animateTransform");
    aIn.setAttribute("attributeName","gradientTransform");
    aIn.setAttribute("type","translate");
    aIn.setAttribute("from","0 0");
    aIn.setAttribute("to", `${(pillX - xTrailStart)} 0`);
    aIn.setAttribute("dur","6s");
    aIn.setAttribute("repeatCount","indefinite");
    gIn.appendChild(aIn);
    defsIn.appendChild(gIn);
    svg.appendChild(defsIn);

    // Pill outline (stroke only, alive)
    const d = `M ${pillX+r} ${pillY} H ${pillX+pillW-r} Q ${pillX+pillW} ${pillY} ${pillX+pillW} ${pillY+r}
               V ${pillY+pillH-r} Q ${pillX+pillW} ${pillY+pillH} ${pillX+pillW-r} ${pillY+pillH}
               H ${pillX+r} Q ${pillX} ${pillY+pillH} ${pillX} ${pillY+pillH-r}
               V ${pillY+r} Q ${pillX} ${pillY} ${pillX+r} ${pillY} Z`;
    const outline = document.createElementNS(ns,"path");
    outline.setAttribute("d", d);
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "url(#gradFlow)");
    outline.setAttribute("stroke-width", "2.5");
    outline.setAttribute("stroke-linejoin", "round");
    outline.setAttribute("class", "glow");
    svg.appendChild(outline);

    // Draw-in animation for the outline
    const len = outline.getTotalLength();
    outline.style.strokeDasharray  = String(len);
    outline.style.strokeDashoffset = String(len);
    outline.getBoundingClientRect();
    outline.style.transition = "stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
    requestAnimationFrame(()=> outline.style.strokeDashoffset = "0");

    // Label
    const label = document.createElementNS(ns,"text");
    label.setAttribute("x", pillX + 18);
    label.setAttribute("y", pillY + pillH/2 + 6);
    label.setAttribute("fill","#ddeaef");
    label.setAttribute("font-weight","800");
    label.setAttribute("font-size","18");
    label.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
    label.textContent = C.LABEL;
    svg.appendChild(label);

    // Incoming cable (left → pill) to imply continuity from Step 1
    if (C.LEAD_IN){
      const trailIn = document.createElementNS(ns,"line");
      trailIn.setAttribute("x1", xTrailStart); trailIn.setAttribute("y1", yMid);
      trailIn.setAttribute("x2", pillX);       trailIn.setAttribute("y2", yMid);
      trailIn.setAttribute("stroke","url(#gradTrailFlowIn)");
      trailIn.setAttribute("stroke-width","2.5");
      trailIn.setAttribute("stroke-linecap","round");
      trailIn.setAttribute("class","glow");
      svg.appendChild(trailIn);
    }

    // Outgoing cable (pill → right edge) keeps the end-to-end flow
    if (C.LEAD_OUT){
      const trailOut = document.createElementNS(ns,"line");
      trailOut.setAttribute("x1", pillX + pillW); trailOut.setAttribute("y1", yMid);
      trailOut.setAttribute("x2", xTrailEnd);     trailOut.setAttribute("y2", yMid);
      trailOut.setAttribute("stroke","url(#gradTrailFlow)");
      trailOut.setAttribute("stroke-width","2.5");
      trailOut.setAttribute("stroke-linecap","round");
      trailOut.setAttribute("class","glow");
      svg.appendChild(trailOut);
    }

    // Copy block — stays inside lamp; Y anchored to basePillY (not NUDGE_Y)
    const minInsideLamp = b.left + 24;
    const fromRail      = Math.max(b.railRight + 32, minInsideLamp);
    const copyTop       = (b.top + basePillY - 2);
    const copy = mountCopy({
      top:  copyTop,
      left: fromRail,
      html: `
        <h3>Persona & metrics.</h3>
        <p>We lock in your buyer persona and convert your priorities into simple metrics and signals
        (intent, weight, character, platform) so the engine can rank who’s most likely to buy next.</p>
      `
    });

    // Keep a clean gap between pill and copy, and ensure copy stays inside the lamp
    requestAnimationFrame(() => {
      const boxLeftAbs = b.left + pillX;
      const copyBox    = copy.getBoundingClientRect();
      let idealLeft    = Math.min(copyBox.left, boxLeftAbs - C.COPY_GAP - copyBox.width);
      idealLeft        = Math.max(idealLeft, minInsideLamp);
      copy.style.left  = idealLeft + "px";
    });
  };
})();