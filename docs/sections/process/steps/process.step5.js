// sections/process/steps/process.step5.js
(() => {
  const STEP = 5;
  const NS = "http://www.w3.org/2000/svg";

  // ---------------- CONFIG / KNOBS (your edits in window.PROCESS_CONFIG.step5 take priority) --------
  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step5 = root.step5 || {};
    const dflt = {
      // Place the network in the RIGHT rail (fits inside the lamp)
      STACK_X_RATIO: 0.555,   // keep your right-rail placement
      STACK_TOP_RATIO: 0.18,
      WIDTH_RATIO:    0.54,
      HEIGHT_MAX_PX:  560,
      NUDGE_X: -230,  NUDGE_Y: -12,

      // Column geometry
      COL_GAP_RATIO: 0.06,
      COL_W_RATIO:   0.13,
      ITEM_H_RATIO:  0.12,
      ITEM_GAP_RATIO:0.04,
      RADIUS_RECT: 14,
      RADIUS_PILL: 22,
      RADIUS_OVAL: 999,

      // Stroke colors (static; no animation)
      SHAPE_COLOR: "#63d3ff",
      SHAPE_WIDTH: 2.2,
      LINE_COLOR:  "rgba(242,220,160,0.95)",
      LINE_WIDTH:  2,
      CONNECT_GAP: 3,      // <-- pushes line endpoints OFF the shape border so lines don’t enter boxes

      // Headline above the diagram
      TITLE_SHOW: true,
      TITLE_TEXT: "AI Orchestrator — Weight What Matters",
      TITLE_PT: 14, TITLE_WEIGHT: 700,
      TITLE_COLOR: "#ddeaef",
      TITLE_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_LETTER_SPACING: 0.2,
      TITLE_OFFSET_X: 0, TITLE_OFFSET_Y: -28,

      // Column Titles (visible, resizable, wrap-able)
      HEADINGS_SHOW: true,
      HEADINGS: ["yourcompany.com", "Intent Score", "Weight Score", "Character Score", "Platform Score"],
      HEAD_PT: 11, HEAD_WEIGHT: 650,
      HEAD_COLOR: "#ddeaef",
      HEAD_LETTER_SPACING: 0.2,
      HEAD_LINE_HEIGHT: 1.2,
      HEAD_ALIGN: "center",              // "left" | "center" | "right"
      HEAD_MAX_LINES: 2,                 // wrap to N lines
      HEAD_WIDTH_RATIO: 0.95,            // fraction of column width to wrap within
      HEAD_OFFSET_Y: -2,                 // fine vertical nudge for titles

      // Left copy (SEO)
      COPY_LEFT_RATIO: 0.035, COPY_TOP_RATIO: 0.16,
      COPY_NUDGE_X: 0, COPY_NUDGE_Y: 0, COPY_MAX_W_PX: 320,
      COPY_H_PT: 24, COPY_H_WEIGHT: 600, COPY_BODY_PT: 12, COPY_BODY_WEIGHT: 400,
      COPY_COLOR_HEAD: "#eaf0f6", COPY_COLOR_BODY: "#a7bacb",
      COPY_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_LINE_HEIGHT: 1.6,

      // Mobile
      MOBILE_BREAKPOINT: 640,
      M_MAX_W: 520, M_SIDE_PAD: 16,
      M_SECTION_TOP: 40, M_SECTION_BOTTOM: 72,
      M_TITLE_PT: 16, M_HEAD_PT: 12,
      M_COPY_H_PT: 22, M_COPY_BODY_PT: 14,

      // Column recipes (exactly as you requested; no text inside shapes)
      // Types: "rect" (rounded 14), "pill" (rounded 22), "oval" (fully round), "circle", "diamond"
      COLS: [
        // Step 0
        { key: "step0", items: ["pill"] }, // yourcompany.com (rounded rectangle)
        // Step 1
        { key: "step1", items: ["rect","rect","pill","circle","diamond"] },
        // Step 2
        { key: "step2", items: ["pill","pill","circle","rect"], dots: 3 },
        // Step 3
        { key: "step3", items: ["circle","pill","pill","rect"], dots: 3 },
        // Step 4
        { key: "step4", items: ["diamond","pill","circle","pill"] }
      ],

      // —— Visibility/Dimming on last box per column (for step2–step4)
      LAST_DIM: { step0: {opacity:1, blur:0},
                  step1: {opacity:1, blur:0},
                  step2: {opacity:0.35, blur:1.5},
                  step3: {opacity:0.35, blur:1.5},
                  step4: {opacity:0.35, blur:1.5} },

      // —— Fine-grained coordinate knobs (do not change your coords; use these to tweak)
      // Per-column horizontal nudges (px)
      COL_X_OFFSETS: { step0:0, step1:0, step2:0, step3:0, step4:0 },
      // Per-column per-item y-nudges (px). Example: { step1: [0,4,-6,0,0] }
      ITEM_Y_OFFSETS: { step0:[], step1:[], step2:[], step3:[], step4:[] },
      // Per-column per-item height multipliers. Example: { step2:[1,1,0.9,1.1] }
      ITEM_H_MULTS: { step0:[], step1:[], step2:[], step3:[], step4:[] },

      // Dots under a column (cheap)
      DOT_SIZE: 2.4, DOT_GAP: 22, DOT_COLOR: "rgba(242,220,160,0.95)"
    };
    for (const k in dflt) if (!(k in root.step5)) root.step5[k] = dflt[k];
    return root.step5;
  }

  // ---------------- helpers ----------------
  const rr = (x,y,w,h,r) => {
    const R = Math.min(r, Math.min(w,h)/2);
    return `M ${x+R} ${y} H ${x+w-R} Q ${x+w} ${y} ${x+w} ${y+R}
            V ${y+h-R} Q ${x+w} ${y+h} ${x+w-R} ${y+h}
            H ${x+R} Q ${x} ${y+h} ${x} ${y+h-R}
            V ${y+R} Q ${x} ${y} ${x+R} ${y} Z`;
  };
  const diamondPath = (cx,cy,w,h)=>`M ${cx} ${cy-h/2} L ${cx+w/2} ${cy} L ${cx} ${cy+h/2} L ${cx-w/2} ${cy} Z`;
  const addPath=(svg,d,stroke,sw,opacity=1,filterId=null)=>{
    const p=document.createElementNS(NS,"path");
    p.setAttribute("d",d); p.setAttribute("fill","none");
    p.setAttribute("stroke",stroke); p.setAttribute("stroke-width",sw);
    p.setAttribute("stroke-linejoin","round"); p.setAttribute("stroke-linecap","round");
    p.style.opacity=opacity; if(filterId)p.setAttribute("filter",`url(#${filterId})`);
    svg.appendChild(p); return p;
  };
  const addCircle=(svg,cx,cy,r,stroke,sw,opacity=1,filterId=null)=>{
    const c=document.createElementNS(NS,"circle");
    c.setAttribute("cx",cx); c.setAttribute("cy",cy); c.setAttribute("r",r);
    c.setAttribute("fill","none"); c.setAttribute("stroke",stroke); c.setAttribute("stroke-width",sw);
    c.style.opacity=opacity; if(filterId)c.setAttribute("filter",`url(#${filterId})`);
    svg.appendChild(c); return c;
  };
  const addFO=(svg,x,y,w,h,html,styles={})=>{
    const fo=document.createElementNS(NS,"foreignObject");
    fo.setAttribute("x",x); fo.setAttribute("y",y); fo.setAttribute("width",w); fo.setAttribute("height",h);
    const d=document.createElement("div"); d.setAttribute("xmlns","http://www.w3.org/1999/xhtml");
    Object.assign(d.style,{
      width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
      textAlign:C().HEAD_ALIGN, color:C().HEAD_COLOR, whiteSpace:"normal", wordBreak:"break-word",
      pointerEvents:"none", lineHeight:String(C().HEAD_LINE_HEIGHT)
    },styles);
    d.innerHTML=html; fo.appendChild(d); svg.appendChild(fo); return fo;
  };

  function seoCopyHTML(){
    return '<h3>SPHERE-3: our AI Orchestrator</h3>\
<p><b>SPHERE-3</b> blends Olympiad-grade math with multi-LLM reasoning to set live weights across <b>Intent</b>, <b>Weight</b>, <b>Character</b>, and <b>Platform</b>. It routes every company to <b>cool / warm / hot / hot+</b> and a <b>right-channel-now score</b> so packaging teams engage where conversion is most likely.</p>\
<p>Keywords: packaging lead scoring • time-to-buy signal • intent scoring • platform fit • AI orchestrator • SPHERE-3 • Artemis-B • B2B packaging buyers • hot plus leads.</p>';
  }

  // --------------- MOBILE CSS (single SVG scales; zero CPU) ---------------
  function ensureMobileCSS(){
    const id="p5m-style"; if(document.getElementById(id))return;
    const s=document.createElement("style"); s.id=id;
    const bp=C().MOBILE_BREAKPOINT;
    s.textContent=`@media (max-width:${bp}px){
      html,body,#section-process{overflow-x:hidden}
      #section-process .p5m-wrap{position:relative;margin:${C().M_SECTION_TOP}px auto ${C().M_SECTION_BOTTOM}px !important;max-width:${C().M_MAX_W}px;padding:0 ${C().M_SIDE_PAD}px 12px;z-index:0}
      .p5m-title{text-align:center;color:${C().TITLE_COLOR};font:${C().TITLE_WEIGHT} ${C().M_TITLE_PT}pt ${C().TITLE_FAMILY};letter-spacing:${C().TITLE_LETTER_SPACING}px;margin:6px 0 10px}
      .p5m-copy{margin:0 auto 12px;color:#a7bacb}
      .p5m-copy h3{margin:0 0 6px;color:#eaf0f6;font:600 ${C().M_COPY_H_PT}px Newsreader, Georgia, serif}
      .p5m-copy p{margin:0;font:400 ${C().M_COPY_BODY_PT}px/1.55 Inter, system-ui}
      .p5m-svg{width:100%;height:auto;display:block}
    }`;
    document.head.appendChild(s);
  }
  function drawMobile(ctx, dims){
    ensureMobileCSS();
    ctx.canvas.style.position="relative"; ctx.canvas.style.inset="auto"; ctx.canvas.style.pointerEvents="auto";
    const wrap=document.createElement("div"); wrap.className="p5m-wrap";
    wrap.innerHTML=(C().TITLE_SHOW?`<div class="p5m-title">${C().TITLE_TEXT}</div>`:"")+`<div class="p5m-copy">${seoCopyHTML()}</div>`;
    const svg=document.createElementNS(NS,"svg"); svg.classList.add("p5m-svg");
    svg.setAttribute("viewBox",`0 0 ${dims.W} ${dims.H}`); svg.setAttribute("width","100%"); svg.setAttribute("height","auto");
    wrap.appendChild(svg); ctx.canvas.appendChild(wrap); return svg;
  }

  // ---------------- MAIN DRAW ----------------
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx){
    const isMobile=(window.PROCESS_FORCE_MOBILE===true)||(window.innerWidth<=C().MOBILE_BREAKPOINT);
    const railW = ctx.bounds.width * C().WIDTH_RATIO;
    const W = Math.max(300, railW);
    const H = Math.min(C().HEIGHT_MAX_PX, ctx.bounds.sH - 40);
    const x0 = ctx.bounds.width * C().STACK_X_RATIO + C().NUDGE_X;
    const y0 = H * C().STACK_TOP_RATIO + C().NUDGE_Y;

    let svg;
    if(isMobile){ svg=drawMobile(ctx,{W,H}); }
    else{
      svg=document.createElementNS(NS,"svg");
      svg.style.position="absolute"; svg.style.left=ctx.bounds.left+"px"; svg.style.top=ctx.bounds.top+"px";
      svg.setAttribute("width",ctx.bounds.width); svg.setAttribute("height",H);
      svg.setAttribute("viewBox",`0 0 ${ctx.bounds.width} ${H}`);
      ctx.canvas.appendChild(svg);
    }

    // lightweight blur filters for dimming (optional)
    const defs=document.createElementNS(NS,"defs");
    const f=document.createElementNS(NS,"filter"); f.setAttribute("id","p5blur");
    const g=document.createElementNS(NS,"feGaussianBlur"); g.setAttribute("stdDeviation","1.5"); f.appendChild(g);
    defs.appendChild(f); svg.appendChild(defs);

    // Title (desktop)
    if(!isMobile && C().TITLE_SHOW){
      const t=document.createElementNS(NS,"text");
      t.setAttribute("x",(x0 + (W/2)) + C().TITLE_OFFSET_X);
      t.setAttribute("y",(y0) + C().TITLE_OFFSET_Y);
      t.setAttribute("text-anchor","middle");
      t.setAttribute("fill",C().TITLE_COLOR);
      t.setAttribute("font-family",C().TITLE_FAMILY);
      t.setAttribute("font-weight",C().TITLE_WEIGHT);
      t.setAttribute("font-size",`${C().TITLE_PT}pt`);
      t.style.letterSpacing=`${C().TITLE_LETTER_SPACING}px`;
      t.textContent=C().TITLE_TEXT;
      svg.appendChild(t);
    }

    // Column box
    const colGap=W*C().COL_GAP_RATIO, colW=W*C().COL_W_RATIO;
    const innerW=(C().COLS.length*colW)+((C().COLS.length-1)*colGap);
    const left=x0 + (W-innerW)/2;
    const top=y0+8;
    const baseH=H*C().ITEM_H_RATIO, gap=H*C().ITEM_GAP_RATIO;

    // Draw columns & shapes; record LEFT/RIGHT anchor points (edge — not center!)
    const anchorsByCol=[]; // [{left:[{x,y}], right:[{x,y}]}...]
    const colTops=[];

    C().COLS.forEach((col,ci)=>{
      const cxNudge=C().COL_X_OFFSETS[col.key]||0;
      const colX=left + ci*(colW+colGap) + cxNudge;
      colTops.push(colX);

      // column title (append AFTER lines too, to ensure on top)
      const headW=colW*C().HEAD_WIDTH_RATIO;
      const headX=colX + (colW-headW)/2;
      const headY=top + C().HEAD_OFFSET_Y;
      const headHTML = `<div style="
          font:${C().HEAD_WEIGHT} ${ (isMobile?C().M_HEAD_PT:C().HEAD_PT) }pt ${C().COPY_FAMILY};
          letter-spacing:${C().HEAD_LETTER_SPACING}px;
          color:${C().HEAD_COLOR};
          display:-webkit-box; -webkit-line-clamp:${C().HEAD_MAX_LINES}; -webkit-box-orient:vertical; overflow:hidden;">
          ${ (C().HEADINGS[ci]||"") }
        </div>`;

      let y=top+24; // space for heading
      const leftAnchors=[], rightAnchors=[];
      const yOffsets=C().ITEM_Y_OFFSETS[col.key]||[];
      const hMults= C().ITEM_H_MULTS[col.key]||[];

      col.items.forEach((type,i)=>{
        const hm=(hMults[i] ?? 1);
        const h=(type==="circle"||type==="diamond") ? baseH*0.9*hm : baseH*hm;
        const yAdj=y + (yOffsets[i]||0);
        let d, cx, cy, r, filterId=null, opacity=1;

        const isLast = (i===col.items.length-1);
        const dimSpec = C().LAST_DIM[col.key];
        if(isLast && dimSpec){
          opacity = dimSpec.opacity ?? 1;
          if((dimSpec.blur||0)>0){ filterId="p5blur"; }
          svg.querySelector("#p5blur feGaussianBlur")?.setAttribute("stdDeviation", String(dimSpec.blur||1.5));
        }

        if(type==="rect"){ d=rr(colX,yAdj,colW,h,C().RADIUS_RECT); addPath(svg,d,C().SHAPE_COLOR,C().SHAPE_WIDTH,opacity,filterId);
          cx=colX+colW/2; cy=yAdj+h/2; }
        else if(type==="pill"){ d=rr(colX,yAdj,colW,h,C().RADIUS_PILL); addPath(svg,d,C().SHAPE_COLOR,C().SHAPE_WIDTH,opacity,filterId);
          cx=colX+colW/2; cy=yAdj+h/2; }
        else if(type==="oval"){ d=rr(colX,yAdj,colW,h,C().RADIUS_OVAL); addPath(svg,d,C().SHAPE_COLOR,C().SHAPE_WIDTH,opacity,filterId);
          cx=colX+colW/2; cy=yAdj+h/2; }
        else if(type==="circle"){ r=Math.min(colW,h)/2; cx=colX+colW/2; cy=yAdj+h/2;
          addCircle(svg,cx,cy,r,C().SHAPE_COLOR,C().SHAPE_WIDTH,opacity,filterId); }
        else if(type==="diamond"){ cx=colX+colW/2; cy=yAdj+h/2;
          d=diamondPath(cx,cy,colW*0.9,h*0.9); addPath(svg,d,C().SHAPE_COLOR,C().SHAPE_WIDTH,opacity,filterId); }

        // edge anchors (no lines inside shapes)
        let leftX, rightX;
        if(type==="circle"){ leftX=cx-(r); rightX=cx+(r); }
        else if(type==="diamond"){ leftX=cx-(colW*0.9)/2; rightX=cx+(colW*0.9)/2; }
        else { leftX=colX; rightX=colX+colW; } // rectangles/ovals/pills share edges at x and x+colW

        leftAnchors.push({x:leftX - C().CONNECT_GAP, y:cy});   // stop just OUTSIDE border
        rightAnchors.push({x:rightX + C().CONNECT_GAP, y:cy}); // start just OUTSIDE border

        y = yAdj + h + gap;
      });

      anchorsByCol.push({left:leftAnchors, right:rightAnchors, head:{x:headX,y:headY,w:headW,h:18}});
      if(C().HEADINGS_SHOW){ /* headings are appended AFTER lines to guarantee on-top z-order */ }
      // dots under column (if requested)
      if(col.dots>0){
        const dotsY = y + 6;
        for(let k=0;k<col.dots;k++){
          const dot=document.createElementNS(NS,"circle");
          dot.setAttribute("cx", colX+colW/2);
          dot.setAttribute("cy", dotsY + k*C().DOT_GAP);
          dot.setAttribute("r", C().DOT_SIZE);
          dot.setAttribute("fill", C().DOT_COLOR);
          svg.appendChild(dot);
        }
      }
    });

    // Mesh: connect right edge of col i to left edge of col i+1 (edges, not centers)
    for(let i=0;i<anchorsByCol.length-1;i++){
      const A=anchorsByCol[i].right, B=anchorsByCol[i+1].left;
      for(const p of A){ for(const q of B){
        const seg=`M ${p.x} ${p.y} L ${q.x} ${q.y}`;
        addPath(svg,seg,C().LINE_COLOR,C().LINE_WIDTH,1,null);
      }}
    }

    // Append headings LAST so they never sit “under” anything
    if(C().HEADINGS_SHOW){
      anchorsByCol.forEach((col,ci)=>{
        const h=col.head;
        addFO(svg,h.x,h.y,h.w,20,
          `<div>${C().HEADINGS[ci]||""}</div>`,
          {font:`${C().HEAD_WEIGHT} ${(isMobile?C().M_HEAD_PT:C().HEAD_PT)}pt ${C().COPY_FAMILY}`,
           letterSpacing:`${C().HEAD_LETTER_SPACING}px`});
      });
    }

    // Left SEO copy (desktop)
    if(!isMobile && typeof ctx.mountCopy==="function"){
      const l=ctx.bounds.left + ctx.bounds.width*C().COPY_LEFT_RATIO + C().COPY_NUDGE_X;
      const t=ctx.bounds.top  + H*C().COPY_TOP_RATIO  + C().COPY_NUDGE_Y;
      const el=ctx.mountCopy({top:t,left:l,html:seoCopyHTML()});
      el.style.maxWidth=`${C().COPY_MAX_W_PX}px`; el.style.fontFamily=C().COPY_FAMILY;
      const h3=el.querySelector("h3"); if(h3){ h3.style.cssText=`margin:0 0 8px;color:${C().COPY_COLOR_HEAD};font:${C().COPY_H_WEIGHT} ${C().COPY_H_PT}pt Newsreader, Georgia, serif`; }
      el.querySelectorAll("p").forEach(p=>p.style.cssText=
        `margin:0 0 8px;color:${C().COPY_COLOR_BODY};font:${C().COPY_BODY_WEIGHT} ${C().COPY_BODY_PT}pt ${C().COPY_FAMILY};line-height:${C().COPY_LINE_HEIGHT}`);
    }
  };
})();