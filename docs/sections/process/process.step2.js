// docs/sections/process/process.step2.js
(() => {
  // make sure the registry exists
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_CONFIG = window.PROCESS_CONFIG || {};
  // defaults you can tweak later from the console:
  window.PROCESS_CONFIG.step2 = Object.assign(
    {
      LABEL: "Intent score",
      COPY_HTML: `
        <h3>Intent score.</h3>
        <p>Signals that tell us how fast they’re likely to buy: searches, tools touched,
        customer volume, and tech in the stack.</p>
      `,
      NUDGE_X: 0,   // move the Step-2 box horizontally
      NUDGE_Y: 0,   // move the Step-2 box vertically (copy won’t follow)
      COPY_GAP: 44  // space between the box and the copy
    },
    window.PROCESS_CONFIG.step2 || {}
  );

  // register scene for step 2
  window.PROCESS_SCENES[2] = ({ ns, canvas, bounds: b, config, makeFlowGradients, mountCopy }) => {
    const C = config.step2;

    // stage SVG (same size as the lamp area)
    const nodeW = b.width, nodeH = Math.min(560, b.sH - 40);
    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top  = b.top  + "px";
    svg.setAttribute("width", nodeW);
    svg.setAttribute("height", nodeH);
    svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);
    canvas.appendChild(svg);

    // pill geometry (centerish), with independent nudges
    const pillW = Math.min(420, nodeW * 0.50), pillH = 76, r = 16;
    const centerX   = nodeW / 2;
    const pillX     = Math.max(18, centerX - pillW / 2 + C.NUDGE_X);
    const basePillY = Math.max(12, nodeH * 0.22); // base Y that copy aligns to (does NOT include NUDGE_Y)
    const pillY     = basePillY + C.NUDGE_Y;
    const yMid      = pillY + pillH / 2;

    // right edge of the screen, in this SVG’s coordinates
    const xTrailEnd = (b.sW - 10) - b.left;

    // animated gradients for the outline + the outgoing trail
    svg.appendChild(makeFlowGradients({ pillX, pillY, pillW, yMid, xTrailEnd }));

    // rounded-rect path (stroke-only, liquid gradient)
    const d = `M ${pillX+r} ${pillY} H ${pillX+pillW-r} Q ${pillX+pillW} ${pillY} ${pillX+pillW} ${pillY+r}
               V ${pillY+pillH-r} Q ${pillX+pillW} ${pillY+pillH} ${pillX+pillW-r} ${pillY+pillH}
               H ${pillX+r} Q ${pillX} ${pillY+pillH} ${pillX} ${pillY+pillH-r}
               V ${pillY+r} Q ${pillX} ${pillY} ${pillX+r} ${pillY} Z`;
    const outline = document.createElementNS(ns, "path");
    outline.setAttribute("d", d);
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "url(#gradFlow)");
    outline.setAttribute("stroke-width", "2.5");
    outline.setAttribute("stroke-linejoin", "round");
    outline.setAttribute("class", "glow");
    svg.appendChild(outline);

    // dash-in on first paint
    const len = outline.getTotalLength();
    outline.style.strokeDasharray  = String(len);
    outline.style.strokeDashoffset = String(len);
    outline.getBoundingClientRect();
    outline.style.transition = "stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
    requestAnimationFrame(() => (outline.style.strokeDashoffset = "0"));

    // label inside the pill
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", pillX + 18);
    label.setAttribute("y", pillY + pillH / 2 + 6);
    label.setAttribute("fill", "#ddeaef");
    label.setAttribute("font-weight", "800");
    label.setAttribute("font-size", "18");
    label.setAttribute("font-family", "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
    label.textContent = C.LABEL;
    svg.appendChild(label);

    // continuous cable from the pill to the right edge (same liquid gradient)
    const trail = document.createElementNS(ns, "line");
    trail.setAttribute("x1", pillX + pillW); trail.setAttribute("y1", yMid);
    trail.setAttribute("x2", xTrailEnd);     trail.setAttribute("y2", yMid);
    trail.setAttribute("stroke", "url(#gradTrailFlow)");
    trail.setAttribute("stroke-width", "2.5");
    trail.setAttribute("stroke-linecap", "round");
    trail.setAttribute("class", "glow");
    svg.appendChild(trail);

    // copy block sits inside the lamp, aligned to base Y (not moved by NUDGE_Y)
    const minInsideLamp = b.left + 24;
    const fromRail      = Math.max(b.railRight + 32, minInsideLamp);
    const copyTop       = b.top + basePillY - 2;
    const copy = mountCopy({ top: copyTop, left: fromRail, html: C.COPY_HTML });

    // after it renders, keep a nice gap from the box
    requestAnimationFrame(() => {
      const boxLeftAbs = b.left + pillX;
      const copyBox    = copy.getBoundingClientRect();
      let idealLeft    = Math.min(copyBox.left, boxLeftAbs - C.COPY_GAP - copyBox.width);
      idealLeft        = Math.max(idealLeft, minInsideLamp);
      copy.style.left  = idealLeft + "px";
    });
  };
})();