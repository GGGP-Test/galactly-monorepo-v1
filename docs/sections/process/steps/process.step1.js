// sections/process/steps/process.step2.js
// Step 2: left copy + boxes on the right. No edits to process.js required.
(() => {
  // --- wait for core markup (built by process.js) ---
  function whenReady(fn){
    const tryIt = () => {
      const mount = document.getElementById("section-process");
      const stage = mount?.querySelector(".proc");
      const railWrap = mount?.querySelector("#railWrap");
      const canvas = mount?.querySelector(".canvas");
      const dot2 = mount?.querySelector('.p-step[data-i="2"]');
      if (stage && railWrap && canvas && dot2) fn({ stage, railWrap, canvas, dot2 });
      else requestAnimationFrame(tryIt);
    };
    requestAnimationFrame(tryIt);
  }

  whenReady(({ stage, railWrap, canvas, dot2 }) => {
    // tweak later if you want to fine-tune Step 2 placement
    const CFG = (window.STEP2_CFG = Object.assign({ nudgeX: 40, nudgeY: 18 }, window.STEP2_CFG || {}));

    function bounds(){
      const s = stage.getBoundingClientRect();
      const w = railWrap.getBoundingClientRect();
      const gap = 56;
      const left = Math.max(0, w.right + gap - s.left);
      const width = Math.max(380, s.right - s.left - left - 16);
      return { sLeft:s.left, sTop:s.top, sW:s.width, sH:s.height, left, width, top:18, railRight:w.right - s.left };
    }

    function clearLayer(){
      const old = canvas.querySelector('[data-step="2"]');
      if (old) old.remove();
    }

    function draw(){
      // Only draw when Step 2 is active
      if (!dot2.classList.contains("is-current")) return;

      clearLayer();
      const b = bounds();
      const ns = "http://www.w3.org/2000/svg";

      // private layer so we can remove without touching core
      const layer = document.createElement("div");
      layer.setAttribute("data-step", "2");
      layer.style.position = "absolute";
      layer.style.inset = "0";
      canvas.appendChild(layer);

      // --- LEFT COPY (inside lamp) ---
      const copy = document.createElement("div");
      copy.className = "copy";
      const minInsideLamp = b.left + 24;
      const fromRail      = Math.max(b.railRight + 32, minInsideLamp);
      const nodeH = Math.min(560, b.sH - 40);
      const baseY = Math.max(12, nodeH * 0.18) + CFG.nudgeY;

      copy.style.left = fromRail + "px";
      copy.style.top  = (b.top + baseY) + "px";
      copy.innerHTML = `
        <h3>Signals light up.</h3>
        <p>We cluster your signals into themes so you can spot where intent is rising:
        market buzz, RFPs & docs, and buyer heat.</p>
      `;
      layer.appendChild(copy);
      requestAnimationFrame(() => copy.classList.add("show"));

      // --- RIGHT STACK OF BOXES ---
      const svg = document.createElementNS(ns, "svg");
      const nodeW = b.width, nodeH2 = nodeH;
      svg.style.position = "absolute";
      svg.style.left = b.left + "px"; svg.style.top = b.top + "px";
      svg.setAttribute("width", nodeW); svg.setAttribute("height", nodeH2);
      svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH2}`);

      const groupX = Math.max(18, nodeW * 0.52) + CFG.nudgeX;
      const boxW   = Math.min(360, nodeW - groupX - 24);
      const boxH   = 64;
      const gap    = 16;
      const r      = 14;

      const y0 = baseY;
      const centers = [
        { y: y0,                 label: "Market Buzz" },
        { y: y0 + boxH + gap,    label: "RFPs & Docs" },
        { y: y0 + (boxH + gap)*2,label: "Buyer Heat"  },
      ];

      // gradients with unique ids so we never collide
      const defs = document.createElementNS(ns,"defs");
      const mkGrad = (id,x1,y1,x2,y2,stops) => {
        const g = document.createElementNS(ns,"linearGradient");
        g.id=id; g.setAttribute("gradientUnits","userSpaceOnUse");
        g.setAttribute("x1",x1); g.setAttribute("y1",y1);
        g.setAttribute("x2",x2); g.setAttribute("y2",y2);
        stops.forEach(([o,c]) => {
          const s = document.createElementNS(ns,"stop");
          s.setAttribute("offset",o); s.setAttribute("stop-color",c); g.appendChild(s);
        });
        const anim = document.createElementNS(ns,"animateTransform");
        anim.setAttribute("attributeName","gradientTransform");
        anim.setAttribute("type","translate");
        anim.setAttribute("from","0 0"); anim.setAttribute("to", `${boxW} 0`);
        anim.setAttribute("dur","6s"); anim.setAttribute("repeatCount","indefinite");
        g.appendChild(anim);
        return g;
      };
      defs.appendChild(mkGrad("s2_boxGrad", groupX, y0, groupX+boxW, y0, [
        ["0%","rgba(230,195,107,.95)"],
        ["50%","rgba(255,255,255,.95)"],
        ["100%","rgba(99,211,255,.75)"],
      ]));

      const trailGrad = document.createElementNS(ns,"linearGradient");
      trailGrad.id="s2_trail";
      trailGrad.setAttribute("gradientUnits","userSpaceOnUse");
      trailGrad.setAttribute("x1", groupX + boxW); trailGrad.setAttribute("y1", y0 + boxH/2);
      const xTrailEnd = (b.sW - 10) - b.left;
      trailGrad.setAttribute("x2", xTrailEnd); trailGrad.setAttribute("y2", y0 + boxH/2);
      [["0%","rgba(230,195,107,.92)"],["60%","rgba(99,211,255,.90)"],["100%","rgba(99,211,255,.18)"]]
        .forEach(([o,c]) => { const s=document.createElementNS(ns,"stop"); s.setAttribute("offset",o); s.setAttribute("stop-color",c); trailGrad.appendChild(s); });
      const animT = document.createElementNS(ns,"animateTransform");
      animT.setAttribute("attributeName","gradientTransform");
      animT.setAttribute("type","translate");
      animT.setAttribute("from","0 0"); animT.setAttribute("to", `${xTrailEnd - (groupX + boxW)} 0`);
      animT.setAttribute("dur","6s"); animT.setAttribute("repeatCount","indefinite");
      trailGrad.appendChild(animT);
      defs.appendChild(trailGrad);

      svg.appendChild(defs);

      // helper: rounded-rect path
      function pillPath(x,y,w,h,rad){
        const r = Math.min(rad, h/2, w/2);
        return `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r}
                V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h}
                H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r}
                V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
      }

      centers.forEach((row, i) => {
        const y = row.y;
        const path = document.createElementNS(ns,"path");
        path.setAttribute("d", pillPath(groupX, y, boxW, boxH, r));
        path.setAttribute("fill","none");
        path.setAttribute("stroke","url(#s2_boxGrad)");
        path.setAttribute("stroke-width","2.4");
        path.setAttribute("class","glow");
        svg.appendChild(path);

        const txt = document.createElementNS(ns,"text");
        txt.setAttribute("x", groupX + 18);
        txt.setAttribute("y", y + boxH/2 + 6);
        txt.setAttribute("fill","#ddeaef");
        txt.setAttribute("font-weight","800");
        txt.setAttribute("font-size","16");
        txt.setAttribute("font-family","Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif");
        txt.textContent = row.label;
        svg.appendChild(txt);
      });

      // one continuous trail from the middle box to the right edge
      const mid = centers[1];
      const trail = document.createElementNS(ns,"line");
      trail.setAttribute("x1", groupX + boxW);
      trail.setAttribute("y1", mid.y + boxH/2);
      trail.setAttribute("x2", xTrailEnd);
      trail.setAttribute("y2", mid.y + boxH/2);
      trail.setAttribute("stroke","url(#s2_trail)");
      trail.setAttribute("stroke-width","2.5");
      trail.setAttribute("stroke-linecap","round");
      trail.setAttribute("class","glow");
      svg.appendChild(trail);

      layer.appendChild(svg);
    }

    // --- react to step switching & layout changes ---
    const reschedule = () => requestAnimationFrame(() => { clearLayer(); draw(); });

    const mo = new MutationObserver(reschedule);
    mo.observe(dot2, { attributes:true, attributeFilter:["class"] });

    addEventListener("resize", reschedule, { passive:true });
    railWrap.addEventListener("transitionend", (e)=>{
      if ((e.propertyName==="left" || e.propertyName==="transform")) reschedule();
    });

    // if already on step 2 when this loads
    reschedule();
  });
})();
