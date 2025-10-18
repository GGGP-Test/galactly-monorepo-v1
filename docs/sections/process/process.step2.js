// docs/sections/process/steps/process.step2.js
// Renders Step 2 without modifying process.js
(() => {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  const stage    = mount.querySelector(".proc");
  const railWrap = mount.querySelector("#railWrap");
  const canvas   = mount.querySelector(".canvas");
  const dot2     = mount.querySelector('.p-step[data-i="2"]');

  if (!stage || !railWrap || !canvas || !dot2) return;

  // tweak these later if you need to fine-tune Step 2 box placement
  const CFG = (window.STEP2_CFG = Object.assign({ nudgeX: 90, nudgeY: 28 }, window.STEP2_CFG || {}));

  // compute the same bounds used by your core so placements match
  function bounds(){
    const s = stage.getBoundingClientRect();
    const w = railWrap.getBoundingClientRect();
    const gap = 56;
    const left = Math.max(0, w.right + gap - s.left);
    const width = Math.max(380, s.right - s.left - left - 16);
    return { sLeft:s.left, sTop:s.top, sW:s.width, sH:s.height, left, width, top:18, railRight:w.right - s.left };
  }

  // clear only Step 2’s layer
  function clearLayer(){
    const old = canvas.querySelector('[data-s2-layer]');
    if (old) old.remove();
  }

  function draw(){
    // render only if step 2 is the active dot
    if (!dot2.classList.contains("is-current")) return;

    clearLayer();
    const b = bounds();
    const ns = "http://www.w3.org/2000/svg";

    // make a private layer so core clears won't affect our bookkeeping
    const layer = document.createElement("div");
    layer.setAttribute("data-s2-layer", "1");
    layer.style.position = "absolute";
    layer.style.inset = "0";
    canvas.appendChild(layer);

    // svg
    const svg = document.createElementNS(ns,"svg");
    const nodeW = b.width, nodeH = Math.min(560, b.sH-40);
    svg.style.position = "absolute";
    svg.style.left = b.left + "px"; svg.style.top = b.top + "px";
    svg.setAttribute("width", nodeW); svg.setAttribute("height", nodeH);
    svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);

    // dims + placement
    const pillW = Math.min(460, nodeW*0.54), pillH = 80, r = 16;
    const lampCenter = nodeW/2;
    const leftBias   = Math.min(70, nodeW*0.07);
    const pillX = Math.max(18, lampCenter - leftBias - pillW/2 + CFG.nudgeX);
    const pillY = Math.max(12, nodeH*0.22 + CFG.nudgeY);
    const yMid  = pillY + pillH/2;

    const xScreenEnd = b.sW - 10;
    const xTrailEnd  = xScreenEnd - b.left;

    // gradients (unique ids)
    const defs = document.createElementNS(ns,"defs");

    const gFlow = document.createElementNS(ns,"linearGradient");
    gFlow.id = "s2_gradFlow";
    gFlow.setAttribute("gradientUnits","userSpaceOnUse");
    gFlow.setAttribute("x1", pillX); gFlow.setAttribute("y1", pillY);
    gFlow.setAttribute("x2", pillX + pillW); gFlow.setAttribute("y2", pillY);
    [["0%","rgba(230,195,107,.95)"],
     ["35%","rgba(255,255,255,.95)"],
     ["75%","rgba(127,178,255,.95)"],
     ["100%","rgba(127,178,255,.60)"]]
      .forEach(([o,c])=>{ const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gFlow.appendChild(s); });
    const anim1 = document.createElementNS(ns,"animateTransform");
    anim1.setAttribute("attributeName","gradientTransform");
    anim1.setAttribute("type","translate");
    anim1.setAttribute("from","0 0"); anim1.setAttribute("to", `${pillW} 0`);
    anim1.setAttribute("dur","6s"); anim1.setAttribute("repeatCount","indefinite");
    gFlow.appendChild(anim1);

    const gTrail = document.createElementNS(ns,"linearGradient");
    gTrail.id = "s2_gradTrailFlow";
    gTrail.setAttribute("gradientUnits","userSpaceOnUse");
    gTrail.setAttribute("x1", pillX + pillW); gTrail.setAttribute("y1", yMid);
    gTrail.setAttribute("x2", xTrailEnd);      gTrail.setAttribute("y2", yMid);
    [["0%","rgba(230,195,107,.92)"],
     ["45%","rgba(127,178,255,.90)"],
     ["100%","rgba(127,178,255,.18)"]]
      .forEach(([o,c])=>{ const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); gTrail.appendChild(s); });
    const anim2 = document.createElementNS(ns,"animateTransform");
    anim2.setAttribute("attributeName","gradientTransform");
    anim2.setAttribute("type","translate");
    anim2.setAttribute("from","0 0"); anim2.setAttribute("to", `${(xTrailEnd - (pillX + pillW))} 0`);
    anim2.setAttribute("dur","6s"); anim2.setAttribute("repeatCount","indefinite");
    gTrail.appendChild(anim2);

    defs.appendChild(gFlow); defs.appendChild(gTrail);
    svg.appendChild(defs);

    // rounded pill
    const d = `M ${pillX+r} ${pillY} H ${pillX+pillW-r} Q ${pillX+pillW} ${pillY} ${pillX+pillW} ${pillY+r}
               V ${pillY+pillH-r} Q ${pillX+pillW} ${pillY+pillH} ${pillX+pillW-r} ${pillY+pillH}
               H ${pillX+r} Q ${pillX} ${pillY+pillH} ${pillX} ${pillY+pillH-r}
               V ${pillY+r} Q ${pillX} ${pillY} ${pillX+r} ${pillY} Z`;
    const outline = document.createElementNS(ns,"path");
    outline.setAttribute("d", d);
    outline.setAttribute("fill","none");
    outline.setAttribute("stroke","url(#s2_gradFlow)");
    outline.setAttribute("stroke-width","2.5");
    outline.setAttribute("stroke-linejoin","round");
    outline.setAttribute("class","glow");
    svg.appendChild(outline);

    // label
    const label = document.createElementNS(ns,"text");
    label.setAttribute("x", pillX + 18); label.setAttribute("y", pillY + pillH/2 + 6);
    label.setAttribute("fill","#ddeaef"); label.setAttribute("font-weight","800");
    label.setAttribute("font-size","18"); label.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
    label.textContent = "Intent score";
    svg.appendChild(label);

    // continuous trail to right edge
    const trail = document.createElementNS(ns,"line");
    trail.setAttribute("x1", pillX + pillW); trail.setAttribute("y1", yMid);
    trail.setAttribute("x2", xTrailEnd);     trail.setAttribute("y2", yMid);
    trail.setAttribute("stroke","url(#s2_gradTrailFlow)");
    trail.setAttribute("stroke-width","2.5");
    trail.setAttribute("stroke-linecap","round");
    trail.setAttribute("class","glow");
    svg.appendChild(trail);

    layer.appendChild(svg);

    // copy inside lamp, aligned like step 1
    const copy = document.createElement("div");
    copy.className = "copy";
    copy.style.top  = (b.top + pillY - 2) + "px";
    const minInsideLamp = b.left + 24;
    const fromRail      = Math.max(b.railRight + 32, minInsideLamp);
    copy.style.left     = fromRail + "px";
    copy.innerHTML = `
      <h3>Intent score</h3>
      <p>Signals like searches, tools touched, and company size feed the score. The strongest flows light up first.</p>
    `;
    layer.appendChild(copy);
    requestAnimationFrame(()=> copy.classList.add("show"));
  }

  // react to step changes (class toggles) + layout changes
  const obs = new MutationObserver(() => {
    // draw on the next frame so core has finished clearing the canvas
    requestAnimationFrame(() => { clearLayer(); draw(); });
  });
  obs.observe(dot2, { attributes:true, attributeFilter:["class"] });

  addEventListener("resize", () => {
    if (dot2.classList.contains("is-current")) { clearLayer(); draw(); }
  }, { passive:true });

  railWrap.addEventListener("transitionend", (e)=>{
    if ((e.propertyName==="left" || e.propertyName==="transform") && dot2.classList.contains("is-current")){
      clearLayer(); draw();
    }
  });

  // if the page loads already on step 2, render once
  requestAnimationFrame(() => { if (dot2.classList.contains("is-current")) draw(); });
})();