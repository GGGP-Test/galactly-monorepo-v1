// sections/process/steps/process.step5.js
// STATIC • ZERO DEPENDENCIES • DESKTOP + MOBILE • NO ANIMATION
(() => {
  const STEP = 5;
  const NS = "http://www.w3.org/2000/svg";

  function C() {
    const root = (window.PROCESS_CONFIG = window.PROCESS_CONFIG || {});
    root.step5 = root.step5 || {};
    const dflt = {
      // canvas & layout (desktop)
      STACK_H_MAX: 560,
      STACK_TOP_RATIO: 0.18,
      STACK_XS: [0.10, 0.30, 0.50, 0.70, 0.88], // columns % of width
      COL_W_RATIO: 0.13,
      GAP_Y: 14,

      // shapes
      RADIUS_RECT: 14, RADIUS_PILL: 18, RADIUS_OVAL: 999, RADIUS_SQUARE: 10,
      STROKE_PX: 2.2, LINE_PX: 1.8,

      // styling (static)
      COLOR_SHAPE: "#4fb1ff",                 // blue boxes
      COLOR_LINKS: ["#E8C765","#DDBB5F","#D3AE59","#CAA253"], // per-column link tint
      COLOR_FADE: "rgba(79,177,255,0.55)",    // subtle fade on last box of a stack
      COLOR_DOT: "rgba(242,220,160,0.95)",
      COPY_COLOR_H: "#eaf0f6", COPY_COLOR_P: "#a7bacb",

      // title (desktop)
      TITLE_SHOW: true,
      TITLE_TEXT: "AI Orchestrator — Weight What Matters",
      TITLE_PT: 14, TITLE_WEIGHT: 700,
      TITLE_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      TITLE_OFFSET_Y: -28, TITLE_LETTER_SPACING: 0.2,

      // left copy block (desktop)
      COPY_LEFT_RATIO: 0.035, COPY_TOP_RATIO: 0.16,
      COPY_MAX_W_PX: 320, COPY_H_PT: 24, COPY_BODY_PT: 12,
      COPY_FAMILY: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
      COPY_HTML:
        '<h3>SPHERE-3: our AI Orchestrator</h3>\
         <p><b>SPHERE-3</b> combines our Olympiad-grade math with multi-LLM reasoning to set live weights across\
         Intent, Time, Weight, and Platform. It routes every company to <b>cool / warm / hot / hot+</b> and a\
         <b>right channel now score</b> — so packaging teams engage where conversion is most likely.</p>\
         <p class="kws">Packaging lead scoring • time-to-buy signal • intent scoring • platform fit • AI orchestrator •\
         SPHERE-3 • Artemis-B • B2B packaging buyers • hot plus leads</p>',

      // mobile
      MOBILE_BREAKPOINT: 640,
      M_SECTION_TOP: 40, M_SECTION_BOTTOM: 72, M_SIDE_PAD: 16, M_CANVAS_MAX_W: 520,

      // column blueprints (no text inside shapes)
      // (match Steps 0–4 visual language)
      COLS: [
        { shapes: ["circleS"], dots: true },                          // Step 0 input
        { shapes: ["rect","rect","pill","oval","diamond"], dots: true }, // Intent
        { shapes: ["rect","rect","oval","rect"], dots: true },        // Weight
        { shapes: ["oval","rect","rect","rect","rect"], dots: true }, // Character
        { shapes: ["diamond","rect","circle","arrow","square"], dots: false } // Platform -> arrow -> final
      ]
    };
    for (const k in dflt) if (!(k in root.step5)) root.step5[k] = dflt[k];
    return root.step5;
  }

  // -------------------- Helpers (pure SVG, no animation) --------------------
  const rr = (x, y, w, h, r) => {
    const R = Math.min(r, Math.min(w, h)/2);
    return `M ${x+R} ${y} H ${x+w-R} Q ${x+w} ${y} ${x+w} ${y+R} V ${y+h-R}\
            Q ${x+w} ${y+h} ${x+w-R} ${y+h} H ${x+R} Q ${x} ${y+h} ${x} ${y+h-R}\
            V ${y+R} Q ${x} ${y} ${x+R} ${y} Z`;
  };
  const diamond = (x,y,w,h) => `M ${x+w/2} ${y} L ${x+w} ${y+h/2} L ${x+w/2} ${y+h} L ${x} ${y+h/2} Z`;

  function addPath(svg, d, stroke, sw, op=1) {
    const p = document.createElementNS(NS,"path");
    p.setAttribute("d", d); p.setAttribute("fill","none"); p.setAttribute("stroke", stroke);
    p.setAttribute("stroke-width", sw); p.setAttribute("stroke-linejoin","round"); p.setAttribute("stroke-linecap","round");
    if (op !== 1) p.setAttribute("stroke-opacity", op);
    svg.appendChild(p); return p;
  }
  function addCircle(svg, cx, cy, r, stroke, sw, op=1) {
    const c = document.createElementNS(NS,"circle");
    c.setAttribute("cx",cx); c.setAttribute("cy",cy); c.setAttribute("r",r);
    c.setAttribute("fill","none"); c.setAttribute("stroke",stroke); c.setAttribute("stroke-width",sw);
    if (op !== 1) c.setAttribute("stroke-opacity", op);
    svg.appendChild(c); return c;
  }
  function addArrow(svg, x, y, w, h, stroke, sw){
    const mid = y + h/2, head = Math.min(h,w)*0.45;
    addPath(svg, `M ${x} ${mid} H ${x+w-head}`, stroke, sw);
    addPath(svg, `M ${x+w-head} ${y} L ${x+w} ${y+h/2} L ${x+w-head} ${y+h}`, stroke, sw);
  }

  function drawColumn(svg, xC, top, colW, shapes, color, fadedColor, cfg){
    const boxH = colW * 0.40, gap = cfg.GAP_Y, halfW = colW/2;
    let y = top;
    const anchors = [];
    function add(shape, faded=false){
      const stroke = faded ? fadedColor : color, sw = cfg.STROKE_PX; let a=null;
      if (shape==="rect") {
        addPath(svg, rr(xC-halfW,y,colW,boxH,cfg.RADIUS_RECT), stroke, sw, faded?0.7:1);
        a={xL:xC-halfW,xR:xC+halfW,y:y+boxH/2}; y+=boxH+gap;
      } else if (shape==="pill") {
        addPath(svg, rr(xC-halfW,y,colW,boxH,cfg.RADIUS_PILL), stroke, sw, faded?0.7:1);
        a={xL:xC-halfW,xR:xC+halfW,y:y+boxH/2}; y+=boxH+gap;
      } else if (shape==="oval") {
        addPath(svg, rr(xC-halfW,y,colW,boxH,cfg.RADIUS_OVAL), stroke, sw, faded?0.7:1);
        a={xL:xC-halfW,xR:xC+halfW,y:y+boxH/2}; y+=boxH+gap;
      } else if (shape==="diamond") {
        const h=boxH*0.9; addPath(svg, diamond(xC-halfW,y,colW,h), stroke, sw, faded?0.7:1);
        a={xL:xC-halfW,xR:xC+halfW,y:y+h/2}; y+=h+gap;
      } else if (shape==="circle") {
        const r=Math.min(colW,boxH)*0.5; addCircle(svg,xC,y+r,r,stroke,sw,faded?0.7:1);
        a={xL:xC-r,xR:xC+r,y:y+r}; y+=r*2+gap;
      } else if (shape==="circleS") {
        const r=Math.min(colW,boxH)*0.36; addCircle(svg,xC,y+r,r,stroke,sw,1);
        a={xL:xC-r,xR:xC+r,y:y+r}; y+=r*2+gap;
      } else if (shape==="square") {
        const h=boxH*0.95; addPath(svg, rr(xC-halfW,y,colW,h,cfg.RADIUS_SQUARE), stroke, sw, faded?0.7:1);
        a={xL:xC-halfW,xR:xC+halfW,y:y+h/2}; y+=h+gap;
      } else if (shape==="arrow") {
        const h=boxH*0.75, w=colW*0.85; addArrow(svg, xC-w/2, y, w, h, stroke, sw); a=null; y+=h+gap;
      }
      if (a) anchors.push(a);
    }
    shapes.forEach((t,i)=>add(t, i===shapes.length-1)); // fade last one slightly
    return anchors;
  }

  function drawDesktop(ctx){
    const cfg=C(), b=ctx.bounds, W=b.width, H=Math.min(cfg.STACK_H_MAX, b.sH-40);
    const svg=document.createElementNS(NS,"svg");
    Object.assign(svg.style,{position:"absolute",left:b.left+"px",top:b.top+"px"});
    svg.setAttribute("width",W); svg.setAttribute("height",H); svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
    ctx.canvas.appendChild(svg);

    // Title
    if (cfg.TITLE_SHOW){
      const t=document.createElementNS(NS,"text");
      t.setAttribute("x", W*0.5);
      t.setAttribute("y", (H*cfg.STACK_TOP_RATIO)+cfg.TITLE_OFFSET_Y);
      t.setAttribute("text-anchor","middle"); t.setAttribute("fill","#ddeaef");
      t.setAttribute("font-family",cfg.TITLE_FAMILY); t.setAttribute("font-weight",cfg.TITLE_WEIGHT);
      t.setAttribute("font-size",`${cfg.TITLE_PT}pt`); t.textContent=cfg.TITLE_TEXT;
      t.style.letterSpacing=`${cfg.TITLE_LETTER_SPACING}px`; svg.appendChild(t);
    }

    const colW=W*cfg.COL_W_RATIO, top=H*cfg.STACK_TOP_RATIO;
    const allAnchors=[];
    cfg.COLS.forEach((col,i)=>{
      const xC=W*cfg.STACK_XS[i];
      const anchors=drawColumn(svg, xC, top, colW, col.shapes, cfg.COLOR_SHAPE, cfg.COLOR_FADE, cfg);
      allAnchors.push(anchors);
      // dotted hint below
      if (col.dots){
        const yBase=(anchors.at(-1)?.y || top)+18;
        for (let d=0; d<3; d++){
          const dot=document.createElementNS(NS,"circle");
          dot.setAttribute("cx",xC); dot.setAttribute("cy",yBase+d*20);
          dot.setAttribute("r",2.2); dot.setAttribute("fill",cfg.COLOR_DOT); svg.appendChild(dot);
        }
      }
    });

    // connectors between adjacent columns (color per pair for subtle variety)
    for (let i=0;i<allAnchors.length-1;i++){
      const L=allAnchors[i], R=allAnchors[i+1], stroke=cfg.COLOR_LINKS[i % cfg.COLOR_LINKS.length];
      L.forEach(a=>R.forEach(b2=>{
        addPath(svg, `M ${a.xR} ${a.y} L ${b2.xL} ${b2.y}`, stroke, cfg.LINE_PX);
      }));
    }

    // left copy (desktop)
    const leftX=b.left+W*cfg.COPY_LEFT_RATIO, topY=b.top+H*cfg.COPY_TOP_RATIO;
    if (typeof ctx.mountCopy==="function"){
      const el=ctx.mountCopy({ top: topY, left: leftX, html: cfg.COPY_HTML });
      el.style.maxWidth=`${cfg.COPY_MAX_W_PX}px`; el.style.fontFamily=cfg.COPY_FAMILY;
      const h3=el.querySelector("h3"); if (h3){ h3.style.font=`600 ${cfg.COPY_H_PT}pt Newsreader, Georgia, serif`; h3.style.color=cfg.COPY_COLOR_H; }
      el.querySelectorAll("p").forEach(p=>p.style.cssText=`font:400 ${cfg.COPY_BODY_PT}pt ${cfg.COPY_FAMILY}; line-height:1.6; color:${cfg.COPY_COLOR_P}`);
    }
  }

  function ensureMobileCSS(){
    const id="p5m-style"; if (document.getElementById(id)) return;
    const s=document.createElement("style"); s.id=id;
    const bp=C().MOBILE_BREAKPOINT, pad=C().M_SIDE_PAD, cw=C().M_CANVAS_MAX_W;
    s.textContent =
      "@media (max-width:"+bp+"px){html,body,#section-process{overflow-x:hidden}"+
      "#section-process .p5-wrap{position:relative;margin:"+C().M_SECTION_TOP+"px auto "+C().M_SECTION_BOTTOM+"px !important;max-width:"+cw+"px;padding:0 "+pad+"px;z-index:0}"+
      ".p5-title{text-align:center;color:#ddeaef;font:"+C().TITLE_WEIGHT+" "+(C().TITLE_PT+2)+"pt "+C().TITLE_FAMILY+";letter-spacing:"+C().TITLE_LETTER_SPACING+"px;margin:6px 0 10px}"+
      ".p5-copy{margin:0 auto 14px;color:"+C().COPY_COLOR_P+"}"+
      ".p5-copy h3{margin:0 0 8px;color:"+C().COPY_COLOR_H+";font:600 "+C().COPY_H_PT+"px Newsreader, Georgia, serif}"+
      ".p5-copy p{margin:0;font:400 "+C().COPY_BODY_PT+"px/1.55 "+C().COPY_FAMILY+"}"+
      ".p5-svg{width:100%;height:auto;display:block}}";
    document.head.appendChild(s);
  }

  function drawMobile(ctx){
    ensureMobileCSS();
    const wrap=document.createElement("div"); wrap.className="p5-wrap";
    wrap.innerHTML=(C().TITLE_SHOW?'<div class="p5-title">'+C().TITLE_TEXT+'</div>':'')+'<div class="p5-copy">'+C().COPY_HTML+'</div>';
    const svg=document.createElementNS(NS,"svg"); svg.classList.add("p5-svg");
    const W=C().M_CANVAS_MAX_W, H=540; svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio","xMidYMid meet"); wrap.appendChild(svg);
    ctx.canvas.style.position="relative"; ctx.canvas.style.inset="auto"; ctx.canvas.appendChild(wrap);

    const colW=W*0.18, top=H*0.20, xs=[0.10,0.34,0.58,0.82,1.06].map(r=>W*r - (W*0.06));
    const cols=C().COLS, all=[];
    cols.forEach((col,i)=>{
      const a=drawColumn(svg, xs[i], top, colW, col.shapes, C().COLOR_SHAPE, C().COLOR_FADE, C()); all.push(a);
      if (col.dots){
        const yB=(a.at(-1)?.y || top)+16;
        for (let d=0; d<3; d++){ const dot=document.createElementNS(NS,"circle");
          dot.setAttribute("cx",xs[i]); dot.setAttribute("cy",yB+d*16); dot.setAttribute("r",2); dot.setAttribute("fill",C().COLOR_DOT); svg.appendChild(dot); }
      }
    });
    for (let i=0;i<all.length-1;i++){
      const stroke=C().COLOR_LINKS[i % C().COLOR_LINKS.length];
      all[i].forEach(a=>all[i+1].forEach(b2=>addPath(svg,`M ${a.xR} ${a.y} L ${b2.xL} ${b2.y}`, stroke, 1.4)));
    }
  }

  // mount
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_SCENES[STEP] = function draw(ctx){
    const isMobile = (window.PROCESS_FORCE_MOBILE === true) || (window.innerWidth <= C().MOBILE_BREAKPOINT);
    if (isMobile) { drawMobile(ctx); return; }
    drawDesktop(ctx);
  };
})();