// sections/process/process.js
(() => {
  const section = document.getElementById("section-process");
  if (!section) return;
  const mount =
    section.querySelector("#process-root") ||
    section.appendChild(
      Object.assign(document.createElement("div"), { id: "process-root" })
    );
  if (!mount) return;

  /* ----------------- GLOBALS (desktop unchanged) ----------------- */
  window.PROCESS_SCENES = window.PROCESS_SCENES || {};
  window.PROCESS_CONFIG = Object.assign(
    {
      // Desktop Step 0 (unchanged — used on desktop only)
      step0: {
        NUDGE_X: 150,
        NUDGE_Y: 50,
        COPY_GAP: 44,
        LABEL: "YourCompany.com"
      },

      // Per-step buckets (steps 1..5 live in their own files) — DESKTOP
      step1: {},
      step2: {},
      step3: {},
      step4: {},
      step5: {},

      // >>> Phones: all mobile-only tuning lives here (desktop untouched)
      mobile: {
        BP: 640, // <= px uses mobile path (set 640 for phones only)
        MODE: "dom", // "dom" = render mobile here; "scenes" = call per-step files

        /* ========= UNIVERSAL PHONE THEME (applies to all steps) ========= */
        theme: {
          stepTop: 60, // default margin-top for each step
          stepBottom: 100, // default margin-bottom for each step
          maxW: 320, // content width column
          sidePad: 70, // padding from screen edge
          stackGap: 18, // gap between boxes in a stack

          box: {
            // default box sizing for all phone steps
            widthPct: 70,
            minH: 64,
            padX: 68,
            padY: 14,
            border: 2,
            radius: 16,
            fontPt: 10,
            fontWeight: 525,
            letter: 0.3,
            lineEm: 1.25,
            align: "center"
          },

          diamond: {
            // default phone diamond
            widthPct: 24,
            border: 2,
            labelPt: 11,
            pad: 10
          },

          dots: {
            // default dots row
            show: true,
            count: 3,
            size: 6,
            gap: 10,
            padTop: 10
          }
        },

        // ===== Step 0 (Pill) : Mobile-only knobs =====
        step0: {
          // Layout wrapper
          top: 18, // margin-top for Step 0 block
          bottom: 20, // margin-bottom for Step 0 block
          sidePad: 16, // left/right padding inside the block
          maxW: 560, // max block width
          nudgeX: 0, // translate the whole Step 0 block
          nudgeY: 0,

          // Copy block
          copyHTML: null, // optional override HTML for the copy block
          copyHpt: 22, // h3 size (px)
          copyHWeight: 600,
          copyHColor: "#eaf0f6",
          copyBodyPt: 15, // paragraph size (px)
          copyLine: 1.65,
          copyColor: "#a7bacb",
          copyGapBottom: 14, // space between copy and pill

          // Pill visuals
          pill: {
            widthPct: 68, // pill width as % of inner width
            height: 64, // pill height (px)
            radius: 16, // corner radius (px)
            stroke: 2.5, // outline width (px)
            nudgeX: 38, // translate just the pill (not the text above)
            nudgeY: 15,
            showTrail: false // the glowing trail to the right (usually off on mobile)
          },

          // Label inside pill
          labelText: null, // defaults to window.PROCESS_CONFIG.step0.LABEL
          labelPadX: 16, // left padding for label text (px)
          labelPt: 16, // font size (px)
          labelWeight: 800,
          labelColor: "#ddeaef",

          // Extra spacing before Step 1
          gapAfterPill: 28
        },

        // Which steps to show after Step 0
        SHOW_STEPS: { 1: true, 2: true, 3: true, 4: true, 5: true }, // turn on all slots

        // If a step doesn't render (no file yet or disabled), still show a blank space
        SHOW_EMPTY: true,

        // Placeholder sizing for empty steps (mobile only)
        PLACEHOLDER: {
          top: 40, // margin-top for each placeholder block
          bottom: 72, // margin-bottom
          height: 380 // reserved height (tweak to taste)
        },

        // ===== Step 1: Time-to-Buy Intent (MOBILE knobs) =====
        step1: {
          useTheme: true,

          // whole-section placement
          top: 50, // space above this step
          bottom: 80, // space below this step
          maxW: 520,
          sidePad: 20,
          nudgeX: 0,
          nudgeY: 0,

          // small title: "Time-to-Buy Intent"
          titleShow: true,
          titlePt: 11,
          titleWeight: 700,
          titleLetter: 0.2,
          titleAlign: "center",
          titleMarginTop: 10,
          titleMarginBottom: 12,

          // move the title alone
          titleNudgeX: 42, // + = right, - = left
          titleNudgeY: 10, // + = down,  - = up

          // h3 + body: "Who’s ready now?"
          copyHpt: 22,
          copyBodyPt: 14,
          copyLine: 1.6,
          copyColor: "#a7bacb",
          copyHColor: "#eaf0f6",
          copyGapBottom: 20, // gap from paragraph → first box

          // gap between the boxes themselves
          stackGap: 10,

          // ALL rectangular / pill boxes in this step
          box: {
            widthPct: 50,
            minH: 15, // change this to make them shorter/taller
            padX: 12,
            padY: 10,
            border: 2,
            radius: 18,
            fontPt: 8,
            fontWeight: 525,
            letter: 0.3,
            lineEm: 1.2,
            align: "center",
            nudgeX: 42, // positive = push boxes to the right
            nudgeY: 10 // positive = push boxes down
          },

          // diamond at the bottom
          diamond: {
            size: 50, // overall diamond size
            border: 2,
            pad: 12,
            labelPt: 7,
            nudgeY: 16 // pull it closer to the last pill (more negative = higher)
          },

          // three dots under the diamond
          dots: {
            show: false,
            count: 3,
            size: 6,
            gap: 8,
            padTop: 4
          },

          // per-shape overrides (all REAL keys now)
          overrides: {
            rect1: {}, // Back-to-Back Search
            rect2: {}, // RFQ/RFP Keywords
            round3: {}, // Pricing & Sample Page Hits
            oval4: { radius: 9999 }, // Rising # of Ad Creatives → pill
            diamond5: {} // Import/Export End of Cycle
          },

          // draw order top → bottom, then diamond
          order: ["rect1", "rect2", "round3", "oval4", "diamond5"]
        }
      },

      // ===== TABLET GLOBAL KNOBS (shared across all steps) =====
      // These only apply between mobile.BP and tablet.BP_MAX.
      tablet: {
        BP_MAX: 900, // <= px is treated as "tablet" for these knobs

        // copy column width on tablet (Section 3 subtitle + body)
        COPY_MAX_PX: 200,

        // rail wrap when docked (left side step buttons)
        RAIL_DOCK_LEFT_PX: 12,
        RAIL_DOCK_SCALE: 0.84,

        // lamp adjustments (extra offset on top of desktop math)
        LAMP_EXTRA_X: -40, // + = move lamp right, - = left
        LAMP_EXTRA_W: 0, // + = widen lamp, - = shrink
        LAMP_OPACITY: 0.32, // default intensity on tablet

        // ===== STEP 0: TABLET-ONLY OVERRIDES =====
        step0: {
          // pill box sizing (tablet)
          PILL_W_MAX: 400,    // max width in px
          PILL_W_RATIO: 0.48, // fraction of canvas width
          PILL_H: 60,         // height in px
          PILL_RADIUS: 16,    // corner radius
        
          // extra pill translation (tablet-only, on top of desktop NUDGE_X/Y)
          PILL_NUDGE_X: 0,   // + = right, - = left
          PILL_NUDGE_Y: 0,   // + = down,  - = up
        
          // label inside pill (tablet)
          LABEL_PT: 16,       // font-size
          LABEL_NUDGE_X: 18,  // + = move right, - = left
          LABEL_NUDGE_Y: 6,   // + = move down, - = up
        
          // title+copy block (h3 + paragraph) position (tablet)
          COPY_NUDGE_X: -30,  // + = right, - = left
          COPY_NUDGE_Y: 0,    // + = down,  - = up
        
          // >>> TABLET-ONLY TYPOGRAPHY FOR STEP 0 COPY <<<
          COPY_TITLE_PT: 22,     // h3 font-size on tablet (px)
          COPY_TITLE_WEIGHT: 600,
          COPY_BODY_PT: 12,      // paragraph font-size on tablet (px)
          COPY_BODY_LINE: 1.6    // paragraph line-height on tablet
        },

        // ===== STEP 1: TABLET-ONLY LAYOUT (boxes + diamond) =====
        step1: {
          useTheme: true,

          // whole-step placement on tablet
          top: 50,          // space above this step
          bottom: 90,       // space below this step
          maxW: 480,        // column width on tablet
          sidePad: 24,      // padding inside the column
          nudgeX: 0,        // translate the whole block
          nudgeY: 0,

          // small title: "Intent Score"
          titleShow: true,
          titlePt: 13,
          titleWeight: 700,
          titleLetter: 0.3,
          titleAlign: "left",
          titleMarginTop: 10,
          titleMarginBottom: 16,
          titleNudgeX: 0,
          titleNudgeY: 0,

          // h3 + body copy
          copyHpt: 22,
          copyBodyPt: 14,
          copyLine: 1.6,
          copyColor: "#a7bacb",
          copyHColor: "#eaf0f6",
          copyHGap: 10,
          copyGapBottom: 18, // gap from paragraph → first box

          // gap between the boxes themselves
          stackGap: 14,

          // base box knobs (all 4 boxes)
          box: {
            widthPct: 72,
            minH: 46,
            padX: 18,
            padY: 12,
            border: 2,
            radius: 18,
            fontPt: 9,
            fontWeight: 525,
            letter: 0.3,
            lineEm: 1.25,
            align: "left",
            nudgeX: 0,  // + = push boxes to the right
            nudgeY: 0   // + = push boxes down
          },

          // diamond at the bottom
          diamond: {
            widthPct: 34,  // width as % of column
            size: null,    // if set, wins over widthPct (px)
            border: 2,
            pad: 14,
            labelPt: 9,
            nudgeY: 18     // positive = further from last box
          },

          // three dots under the diamond
          dots: {
            show: true,
            count: 3,
            size: 6,
            gap: 10,
            padTop: 8
          },

          // per-shape overrides (tablet-only tuning)
          overrides: {
            rect1: {
              // Back-to-Back Search
              // nudgeX: 0, nudgeY: 0
            },
            rect2: {
              // RFQ/RFP Keywords
            },
            round3: {
              // Pricing & Sample Page Hits
            },
            oval4: {
              // Rising # of Ad Creatives → pill
              radius: 9999
            },
            diamond5: {
              // Import/Export End of Cycle (diamond)
              // you can add nudgeX / nudgeY here too
            }
          },

          // draw order top → bottom, then diamond
          order: ["rect1", "rect2", "round3", "oval4", "diamond5"]
        },

        // ===== MAIN TITLE (Our AI Packaging Sales Intelligence: 6 Pillars) =====
        mainTitle: {
          NUDGE_X: 0,
          NUDGE_Y: -50
        }
      }
    },
    window.PROCESS_CONFIG || {}
  );

  /* ----------------- STYLES (desktop + tablet + phone) ----------------- */

  const MOBILE_BP = window.PROCESS_CONFIG?.mobile?.BP || 640;
  const TCFG_INIT = window.PROCESS_CONFIG?.tablet || {};
  const TABLET_BP_MAX = TCFG_INIT.BP_MAX || 900;
  const TABLET_COPY_MAX = TCFG_INIT.COPY_MAX_PX || 260;
  const TABLET_RAIL_LEFT =
    TCFG_INIT.RAIL_DOCK_LEFT_PX !== undefined
      ? TCFG_INIT.RAIL_DOCK_LEFT_PX
      : 12;
  const TABLET_RAIL_SCALE =
    TCFG_INIT.RAIL_DOCK_SCALE !== undefined ? TCFG_INIT.RAIL_DOCK_SCALE : 0.84;

  const style = document.createElement("style");
  style.textContent = `
  :root{ --ink:#0b1117; --copyMax:300px; --accent:#63D3FF; --accent2:#F2DCA0; }
  #section-process{ position:relative; isolation:isolate; }
  #section-process .proc{ position:relative; min-height:560px; padding:44px 0 40px; overflow:visible; }

  .railWrap{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) scale(.88);
    z-index:5; transition:left .45s cubic-bezier(.22,.61,.36,1), transform .45s cubic-bezier(.22,.61,.36,1); }
  .railWrap.is-docked{ left:clamp(12px,5vw,70px); transform:translate(0,-50%) scale(.86); }
  .rail{ position:relative; display:flex; flex-direction:column; align-items:center; gap:16px; }
  .rail svg{ position:absolute; inset:0; overflow:visible; pointer-events:none; }

  .p-step{ width:50px;height:50px;border-radius:50%;
    display:flex;align-items:center;justify-content:center; user-select:none; cursor:pointer;
    font:700 17px/1 Inter, system-ui; color:#eaf0f6;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
    backdrop-filter:blur(6px); box-shadow:0 6px 16px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.05);
    transition:transform .14s ease, background .15s ease, box-shadow .18s ease; }
  .p-step:hover{ transform:translateY(-1px) }
  .p-step.is-current{
    color:#07212a;
    background:radial-gradient(circle at 50% 45%, rgba(255,255,255,.34), rgba(255,255,255,0) 60%), linear-gradient(180deg, var(--accent), #26b9ff);
    border-color:rgba(255,255,255,.22);
    box-shadow:0 14px 34px rgba(38,185,255,.30), 0 0 0 2px rgba(255,255,255,.20) inset, 0 0 18px rgba(99,211,255,.45); }

  .ctas{ display:flex; gap:10px; margin-top:10px; }
  .btn-glass{ padding:10px 14px; border-radius:999px; border:1px solid rgba(255,255,255,.14);
    background:linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.04));
    color:#eaf0f6; font-weight:700; cursor:pointer; backdrop-filter:blur(8px);
    box-shadow:0 8px 24px rgba(0,0,0,.30), inset 0 0 0 1px rgba(255,255,255,.06);
    transition:transform .08s ease, filter .15s ease; }
  .btn-glass:hover{ filter:brightness(1.06) } .btn-glass:active{ transform:translateY(1px) }
  .btn-glass[disabled]{ opacity:.45; cursor:not-allowed }

  .lamp{ position:absolute; top:50%; transform:translateY(-50%); left:0; width:0;
    height:min(72vh,560px); border-radius:16px; opacity:0; pointer-events:none; z-index:1;
    background:
      radial-gradient(120% 92% at 0% 50%, rgba(99,211,255,.20) 0, rgba(99,211,255,.08) 34%, rgba(99,211,255,0) 70%),
      radial-gradient(80% 60% at 0% 50%, rgba(242,220,160,.08) 0, rgba(242,220,160,0) 56%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 6px);
    filter:saturate(110%) blur(.35px);
    transition:opacity .45s ease, left .45s cubic-bezier(.22,.61,.36,1), width .45s cubic-bezier(.22,.61,.36,1); }
  .lamp::before{ content:""; position:absolute; inset:0 auto 0 -1px; width:2px; border-radius:2px;
    background:linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.03));
    box-shadow:0 0 10px rgba(99,211,255,.28), 0 0 22px rgba(240,210,120,.12); }

  .canvas{ position:absolute; inset:0; z-index:2; pointer-events:none; }
  .copy{ position:absolute; max-width:var(--copyMax); pointer-events:auto;
    opacity:0; transform:translateY(6px); transition:opacity .35s ease, transform .35s ease; }
  .copy.show{ opacity:1; transform:translateY(0) }
  .copy h3{ margin:0 0 .45rem; color:#eaf0f6; font:600 clamp(20px,2.4vw,26px) "Newsreader", Georgia, serif; }
  .copy p{ margin:.35rem 0 0; font:400 15px/1.6 Inter, system-ui; color:#a7bacb }
  .glow{ filter: drop-shadow(0 0 6px rgba(242,220,160,.35)) drop-shadow(0 0 14px rgba(99,211,255,.30)) drop-shadow(0 0 24px rgba(99,211,255,.18)); }

  /* ===== TABLET TUNING (shared,  >mobile.BP and <=tablet.BP_MAX ) ===== */
  @media (max-width:${TABLET_BP_MAX}px){
    :root{ --copyMax:${TABLET_COPY_MAX}px }
    .railWrap.is-docked{ left:${TABLET_RAIL_LEFT}px; transform:translate(0,-50%) scale(${TABLET_RAIL_SCALE}); }
  }

  /* ===== MOBILE-ONLY BASE (desktop + tablet untouched) ===== */
  @media (max-width:${MOBILE_BP}px){
    html, body { overflow-x:hidden; }
    #section-process { overflow-x:hidden; }
    .proc{ min-height:auto; padding:22px 14px 28px; }
    .railWrap, .ctas, .lamp{ display:none !important; }
    .canvas{ position:relative; inset:auto; }
    :root{ --copyMax:92vw }
    .glow{ filter: drop-shadow(0 0 4px rgba(242,220,160,.28)) drop-shadow(0 0 10px rgba(99,211,255,.24)); }
  }

  /* ===== MOBILE DOM MODE base classes ===== */
  /* Keep the fixed header from covering Section 3 on mobile-sized screens */
  @media (max-width: ${MOBILE_BP}px){
    html { scroll-padding-top: 64px; }   /* anchor/hash links land below header */
    #section-process { position: relative; z-index: 1; overflow: visible !important; }
    #section-process .mstep { scroll-margin-top: 64px; }
    #section-process .mstep-title{ color:#ddeaef; }
    #section-process .mstep-title-intent{ color:var(--accent2); }
    #section-process .mstep-copy{ color:#a7bacb; }
    #section-process .mstack{ display:flex; flex-direction:column; align-items:center; }
    #section-process .mbox{ color:#ddeaef; background:rgba(255,255,255,.02); border-style:solid; display:flex; align-items:center; justify-content:center; text-align:center; }
    #section-process .mbox.oval{ border-radius:9999px }
    #section-process .mdiamond{ aspect-ratio:1/1; transform:rotate(45deg); background:rgba(255,255,255,.02); display:flex; align-items:center; justify-content:center; }
    #section-process .mdiamond > span{ transform:rotate(-45deg); display:flex; align-items:center; justify-content:center; text-align:center; color:#ddeaef; }
    #section-process .mdots{ display:flex; justify-content:center; }
    #section-process .mdots i{ border-radius:50%; background:rgba(99,211,255,.95); display:inline-block; }
  }
  `;
  document.head.appendChild(style);

  /* ----------------- MARKUP (unchanged) ----------------- */
  const steps = [0, 1, 2, 3, 4, 5];
  mount.innerHTML = `
    <section class="proc" aria-label="Process">
      <div class="lamp" id="lamp"></div>
      <div class="canvas" id="canvas"></div>
      <div class="railWrap" id="railWrap">
        <div class="rail" id="rail">
          <svg id="railSvg" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>
          ${steps
            .map((i) => `<button class="p-step" data-i="${i}">${i}</button>`)
            .join("")}
          <div class="ctas">
            <button class="btn-glass" id="prevBtn" type="button">Prev step</button>
            <button class="btn-glass" id="nextBtn" type="button">Next step</button>
          </div>
        </div>
      </div>
    </section>
  `;

  /* ----------------- ELEMENTS ----------------- */
  const stage = mount.querySelector(".proc");
  const railWrap = mount.querySelector("#railWrap");
  const rail = mount.querySelector("#rail");
  const railSvg = mount.querySelector("#railSvg");
  const lamp = mount.querySelector("#lamp");
  const canvas = mount.querySelector("#canvas");
  const dots = Array.from(mount.querySelectorAll(".p-step"));
  const prevBtn = mount.querySelector("#prevBtn");
  const nextBtn = mount.querySelector("#nextBtn");
  const mainTitle = section.querySelector(".proc-title");

  /* ----------------- STATE ----------------- */
  let step = 0; // 0..5
  let phase = 0; // 0 = empty (only for step 0), 1 = content

  /* ----------------- HELPERS ----------------- */
  const ns = "http://www.w3.org/2000/svg";
  const MCFG = () => window.PROCESS_CONFIG?.mobile || {};
  const TCFG = () => window.PROCESS_CONFIG?.tablet || {};

  const isMobile = () => {
    const BP = MCFG().BP ?? 640;
    return (
      window.PROCESS_FORCE_MOBILE === true ||
      (window.matchMedia &&
        window.matchMedia(`(max-width:${BP}px)`).matches)
    );
  };

  // Tablet = between phone BP and tablet.BP_MAX
  const isTablet = () => {
    const bpMin = MCFG().BP ?? 640;
    const bpMax = TCFG().BP_MAX ?? 900;
    const w =
      window.innerWidth ||
      document.documentElement.clientWidth ||
      stage.getBoundingClientRect().width ||
      0;
    return w > bpMin && w <= bpMax;
  };

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o || {}));
  }

  function makeFlowGradients({ pillX, pillY, pillW, yMid, xTrailEnd }) {
    const defs = document.createElementNS(ns, "defs");

    const gFlow = document.createElementNS(ns, "linearGradient");
    gFlow.id = "gradFlow";
    gFlow.setAttribute("gradientUnits", "userSpaceOnUse");
    gFlow.setAttribute("x1", pillX);
    gFlow.setAttribute("y1", pillY);
    gFlow.setAttribute("x2", pillX + pillW);
    gFlow.setAttribute("y2", pillY);
    [
      ["0%", "rgba(230,195,107,.95)"],
      ["35%", "rgba(255,255,255,.95)"],
      ["75%", "rgba(99,211,255,.95)"],
      ["100%", "rgba(99,211,255,.60)"]
    ].forEach(([o, c]) => {
      const s = document.createElementNS(ns, "stop");
      s.setAttribute("offset", o);
      s.setAttribute("stop-color", c);
      gFlow.appendChild(s);
    });
    const a1 = document.createElementNS(ns, "animateTransform");
    a1.setAttribute("attributeName", "gradientTransform");
    a1.setAttribute("type", "translate");
    a1.setAttribute("from", "0 0");
    a1.setAttribute("to", `${pillW} 0`);
    a1.setAttribute("dur", "6s");
    a1.setAttribute("repeatCount", "indefinite");
    gFlow.appendChild(a1);
    defs.appendChild(gFlow);

    const gTrail = document.createElementNS(ns, "linearGradient");
    gTrail.id = "gradTrailFlow";
    gTrail.setAttribute("gradientUnits", "userSpaceOnUse");
    gTrail.setAttribute("x1", pillX + pillW);
    gTrail.setAttribute("y1", yMid);
    gTrail.setAttribute("x2", xTrailEnd);
    gTrail.setAttribute("y2", yMid);
    [
      ["0%", "rgba(230,195,107,.92)"],
      ["45%", "rgba(99,211,255,.90)"],
      ["100%", "rgba(99,211,255,.18)"]
    ].forEach(([o, c]) => {
      const s = document.createElementNS(ns, "stop");
      s.setAttribute("offset", o);
      s.setAttribute("stop-color", c);
      gTrail.appendChild(s);
    });
    const a2 = document.createElementNS(ns, "animateTransform");
    a2.setAttribute("attributeName", "gradientTransform");
    a2.setAttribute("type", "translate");
    a2.setAttribute("from", "0 0");
    a2.setAttribute("to", `${xTrailEnd - (pillX + pillW)} 0`);
    a2.setAttribute("dur", "6s");
    a2.setAttribute("repeatCount", "indefinite");
    gTrail.appendChild(a2);
    defs.appendChild(gTrail);

    return defs;
  }
  window.PROCESS_UTILS = Object.assign({}, window.PROCESS_UTILS, {
    makeFlowGradients
  });

  function mountCopy({ top, left, html }) {
    const el = document.createElement("div");
    el.className = "copy";
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.innerHTML = html;
    canvas.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    return el;
  }

  // Desktop bounds (original behavior, used for desktop + tablet)
  function boundsDesktop() {
    const s = stage.getBoundingClientRect();
    const w = railWrap.getBoundingClientRect();
    const gap = 56;
    const left = Math.max(0, w.right + gap - s.left);
    const width = Math.max(380, s.right - s.left - left - 16);
    return {
      sLeft: s.left,
      sTop: s.top,
      sW: s.width,
      sH: s.height,
      left,
      width,
      top: 18,
      railRight: w.right - s.left
    };
  }

  // Mobile bounds (full width, no rail/lamp)
  function boundsMobile(top = 0, sH = 640) {
    const s = stage.getBoundingClientRect();
    const left = 14;
    const width = Math.max(300, s.width - left - 14);
    return {
      sLeft: s.left,
      sTop: s.top,
      sW: s.width,
      sH,
      left,
      width,
      top,
      railRight: left
    };
  }
  function bounds() {
    return isMobile() ? boundsMobile(18, 640) : boundsDesktop();
  }

  function placeLamp() {
    if (isMobile()) {
      lamp.style.opacity = "0";
      lamp.style.width = "0px";
      return;
    }
    const b = boundsDesktop();
    const tCfg = TCFG();
    const onTablet = isTablet();

    const extraX = onTablet ? tCfg.LAMP_EXTRA_X || 0 : 0;
    const extraW = onTablet ? tCfg.LAMP_EXTRA_W || 0 : 0;
    const baseOpacity = onTablet
      ? tCfg.LAMP_OPACITY !== undefined
        ? tCfg.LAMP_OPACITY
        : 0.32
      : 0.32;

    if (step > 0 || (step === 0 && phase === 1)) {
      lamp.style.left = b.left + extraX + "px";
      lamp.style.width = b.width + extraW + "px";
      lamp.style.opacity = String(baseOpacity);
    } else {
      lamp.style.opacity = "0";
      lamp.style.width = "0px";
    }
  }
  function clearCanvas() {
    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);
  }
  
    // Tablet-only: nudge the main process title (Our AI Packaging Sales Intelligence: 6 Pillars)
  function applyTabletMainTitleNudge() {
    if (!mainTitle) return;

    const tCfg = TCFG();
    const MT = tCfg.mainTitle || {};

    if (isTablet()) {
      const nx = MT.NUDGE_X || 0;
      const ny = MT.NUDGE_Y || 0;
      mainTitle.style.transform = `translate(${nx}px, ${ny}px)`;
    } else {
      // reset on desktop + phones
      mainTitle.style.transform = "";
    }
  }

  /* ----------------- STEP 0: Desktop SVG (desktop + tablet) ----------------- */
  function scenePill(bOverride) {
    const C = window.PROCESS_CONFIG.step0;
    const b =
      bOverride || (isMobile() ? boundsMobile(18, 600) : boundsDesktop());

    const onTablet = isTablet();
    const T0 = (onTablet && TCFG().step0) ? TCFG().step0 : {};

    const nodeW = b.width;
    const nodeH = Math.min(560, b.sH - 40);

    const svg = document.createElementNS(ns, "svg");
    svg.style.position = "absolute";
    svg.style.left = b.left + "px";
    svg.style.top = b.top + "px";
    svg.setAttribute("width", nodeW);
    svg.setAttribute("height", nodeH);
    svg.setAttribute("viewBox", `0 0 ${nodeW} ${nodeH}`);
    canvas.appendChild(svg);

    // ---- pill sizing: desktop defaults + tablet overrides ----
    const pillWMax   = onTablet && T0.PILL_W_MAX   != null ? T0.PILL_W_MAX   : 440;
    const pillWRatio = onTablet && T0.PILL_W_RATIO != null ? T0.PILL_W_RATIO : 0.48;
    const pillH      = onTablet && T0.PILL_H       != null ? T0.PILL_H       : 80;
    const r          = onTablet && T0.PILL_RADIUS  != null ? T0.PILL_RADIUS  : 16;

    // extra tablet-only translation for the pill
    const pillNX = onTablet && T0.PILL_NUDGE_X != null ? T0.PILL_NUDGE_X : 0;
    const pillNY = onTablet && T0.PILL_NUDGE_Y != null ? T0.PILL_NUDGE_Y : 0;

    const pillW = Math.min(pillWMax, nodeW * pillWRatio);
    const lampCenter = nodeW / 2;
    const leftBias = Math.min(80, nodeW * 0.08);

    const pillX = Math.max(
      18,
      lampCenter - leftBias - pillW / 2 + C.NUDGE_X + pillNX
    );
    const pillY = Math.max(12, nodeH * 0.2 + C.NUDGE_Y + pillNY);
    const yMid = pillY + pillH / 2;
    const xTrailEnd = nodeW - 10;

    svg.appendChild(
      makeFlowGradients({ pillX, pillY, pillW, yMid, xTrailEnd })
    );

    const d = `M ${pillX + r} ${pillY} H ${pillX + pillW - r} Q ${
      pillX + pillW
    } ${pillY} ${pillX + pillW} ${pillY + r}
               V ${pillY + pillH - r} Q ${pillX + pillW} ${
      pillY + pillH
    } ${pillX + pillW - r} ${pillY + pillH}
               H ${pillX + r} Q ${pillX} ${pillY + pillH} ${pillX} ${
      pillY + pillH - r
    }
               V ${pillY + r} Q ${pillX} ${pillY} ${pillX + r} ${pillY} Z`;
    const outline = document.createElementNS(ns, "path");
    outline.setAttribute("d", d);
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "url(#gradFlow)");
    outline.setAttribute("stroke-width", "2.5");
    outline.setAttribute("stroke-linejoin", "round");
    outline.setAttribute("class", "glow");
    svg.appendChild(outline);

    const len = outline.getTotalLength();
    outline.style.strokeDasharray = String(len);
    outline.style.strokeDashoffset = String(len);
    outline.getBoundingClientRect();
    outline.style.transition =
      "stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
    requestAnimationFrame(() => (outline.style.strokeDashoffset = "0"));

    // ---- label: size + nudges (tablet-only knobs) ----
    const labelPx = onTablet && T0.LABEL_PT       != null ? T0.LABEL_PT       : 18;
    const labelNx = onTablet && T0.LABEL_NUDGE_X  != null ? T0.LABEL_NUDGE_X  : 18;
    const labelNy = onTablet && T0.LABEL_NUDGE_Y  != null ? T0.LABEL_NUDGE_Y  : 6;

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", pillX + labelNx);
    label.setAttribute("y", pillY + pillH / 2 + labelNy);
    label.setAttribute("fill", "#ddeaef");
    label.setAttribute("font-weight", "800");
    label.setAttribute("font-size", String(labelPx));
    label.setAttribute(
      "font-family",
      "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    );
    label.textContent = C.LABEL;
    svg.appendChild(label);

    // trail line
    const trail = document.createElementNS(ns, "line");
    trail.setAttribute("x1", pillX + pillW);
    trail.setAttribute("y1", yMid);
    trail.setAttribute("x2", nodeW - 10);
    trail.setAttribute("y2", yMid);
    trail.setAttribute("stroke", "url(#gradTrailFlow)");
    trail.setAttribute("stroke-width", "2.5");
    trail.setAttribute("stroke-linecap", "round");
    trail.setAttribute("class", "glow");
    svg.appendChild(trail);

    // ---- copy block (h3 + paragraph) with tablet nudges ----
    const copyNX = onTablet && T0.COPY_NUDGE_X != null ? T0.COPY_NUDGE_X : 0;
    const copyNY = onTablet && T0.COPY_NUDGE_Y != null ? T0.COPY_NUDGE_Y : 0;
  
    const basePillY = Math.max(12, nodeH * 0.2);
    const minInside = b.left + 12;
    const fromRail = Math.max(minInside, b.left + 24);
    const copyTop = b.top + basePillY - 2 + copyNY;
  
    // Tablet-only font knobs (fall back to desktop defaults when not tablet)
    const titlePt = onTablet && T0.COPY_TITLE_PT != null ? T0.COPY_TITLE_PT : 26;
    const titleWeight =
      onTablet && T0.COPY_TITLE_WEIGHT != null ? T0.COPY_TITLE_WEIGHT : 600;
    const bodyPt = onTablet && T0.COPY_BODY_PT != null ? T0.COPY_BODY_PT : 15;
    const bodyLine =
      onTablet && T0.COPY_BODY_LINE != null ? T0.COPY_BODY_LINE : 1.6;
  
    const copyHTML = `
      <h3 style="
        margin:0 0 .45rem;
        color:#eaf0f6;
        font:${titleWeight} ${titlePt}px 'Newsreader', Georgia, serif;
      ">
        We start with your company.
      </h3>
      <p style="
        margin:.35rem 0 0;
        color:#a7bacb;
        font:400 ${bodyPt}px/${bodyLine} Inter, system-ui;
      ">
        We'll start with your company to learn what matters. Then our system builds strong metrics around your strengths.
        With that map in hand, we move forward to find real buyers who match your situation.
      </p>
    `;
  
    const copy = mountCopy({
      top: copyTop,
      left: fromRail,
      html: copyHTML
    });

    requestAnimationFrame(() => {
      const boxLeftAbs = b.left + pillX;
      const copyBox = copy.getBoundingClientRect();
      let idealLeft =
        boxLeftAbs - window.PROCESS_CONFIG.step0.COPY_GAP - copyBox.width;
      idealLeft = Math.min(copyBox.left, idealLeft);
      idealLeft = Math.max(idealLeft, minInside);
      idealLeft += copyNX; // tablet extra shove
      copy.style.left = idealLeft + "px";
    });

    return nodeH;
  }

  // STEP 0: Mobile DOM renderer (copy ABOVE, pill BELOW)
  function renderStep0_DOM() {
    const M0 = window.PROCESS_CONFIG.mobile?.step0 || {};
    const LABEL =
      M0.labelText ||
      window.PROCESS_CONFIG.step0?.LABEL ||
      "YourCompany.com";

    // Wrapper
    const wrap = document.createElement("div");
    wrap.className = "mstep mstep0";
    wrap.style.marginTop = `${M0.top ?? 18}px`;
    wrap.style.marginBottom = `${M0.bottom ?? 20}px`;
    wrap.style.maxWidth = `${M0.maxW ?? 560}px`;
    wrap.style.padding = `0 ${M0.sidePad ?? 16}px`;
    wrap.style.transform = `translate(${M0.nudgeX ?? 0}px, ${
      M0.nudgeY ?? 0
    }px)`;
    canvas.appendChild(wrap);

    // Copy block
    const copy = document.createElement("div");
    copy.className = "mstep-copy";
    copy.style.marginBottom = `${M0.copyGapBottom ?? 14}px`;
    if (M0.copyHTML) {
      copy.innerHTML = M0.copyHTML;
    } else {
      copy.innerHTML = `
        <h3 style="margin:0 0 8px; color:${M0.copyHColor ?? "#eaf0f6"};
                   font:${M0.copyHWeight ?? 600} ${(M0.copyHpt ?? 22)}px 'Newsreader', Georgia, serif;">
          We start with your company.
        </h3>
        <p style="margin:0; color:${M0.copyColor ?? "#a7bacb"};
                  font:400 ${(M0.copyBodyPt ?? 15)}px/${(M0.copyLine ?? 1.65)} Inter, system-ui;">
          We'll start with your company to learn what matters. Then our system builds strong metrics around your strengths.
          With that map in hand, we move forward to find real buyers who match your situation.
        </p>`;
    }
    wrap.appendChild(copy);

    // Pill container (block flow; auto-grows so nudges never clip)
    const pillWrap = document.createElement("div");
    pillWrap.style.position = "relative";
    pillWrap.style.width = "100%";
    pillWrap.style.pointerEvents = "none";
    wrap.appendChild(pillWrap);

    // Draw pill after layout so we know widths
    requestAnimationFrame(() => {
      const innerW = pillWrap.getBoundingClientRect().width;
      const P = M0.pill || {};
      const pillH = P.height ?? 64;
      const PAD = 10; // breathing room
      const baseHeight = pillH + PAD * 2;
      const nudgeY = +P.nudgeY || 0;

      // Compute extra space so nudging never gets clipped by the SVG viewport
      const idealTop = PAD + nudgeY; // where we'd like the pill to start
      const extraTop = Math.max(0, -idealTop); // grow above if nudged up too far
      const extraBottom = Math.max(
        0,
        idealTop + pillH - baseHeight
      ); // grow below if nudged down
      const finalH = baseHeight + extraTop + extraBottom;

      pillWrap.style.height = `${finalH}px`;

      const pillW = Math.round(innerW * ((P.widthPct ?? 92) / 100));
      const pillX = Math.round((innerW - pillW) / 2 + (P.nudgeX ?? 0));
      const pillY = idealTop + extraTop; // corrected Y inside the grown viewport
      const yMid = pillY + pillH / 2;

      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", innerW);
      svg.setAttribute("height", finalH);
      svg.setAttribute("viewBox", `0 0 ${innerW} ${finalH}`);
      svg.style.display = "block";
      pillWrap.appendChild(svg);

      svg.appendChild(
        makeFlowGradients({
          pillX,
          pillY,
          pillW,
          yMid,
          xTrailEnd: innerW - 10
        })
      );

      // Outline
      const r = P.radius ?? 16;
      const strokeW = String(P.stroke ?? 2.5);
      const d = `M ${pillX + r} ${pillY} H ${pillX + pillW - r} Q ${
        pillX + pillW
      } ${pillY} ${pillX + pillW} ${pillY + r}
                 V ${pillY + pillH - r} Q ${pillX + pillW} ${
        pillY + pillH
      } ${pillX + pillW - r} ${pillY + pillH}
                 H ${pillX + r} Q ${pillX} ${pillY + pillH} ${pillX} ${
        pillY + pillH - r
      }
                 V ${pillY + r} Q ${pillX} ${pillY} ${pillX + r} ${pillY} Z`;
      const outline = document.createElementNS(ns, "path");
      outline.setAttribute("d", d);
      outline.setAttribute("fill", "none");
      outline.setAttribute("stroke", "url(#gradFlow)");
      outline.setAttribute("stroke-width", strokeW);
      outline.setAttribute("stroke-linejoin", "round");
      outline.setAttribute("class", "glow");
      svg.appendChild(outline);

      // Optional trail (off by default on mobile)
      if (P.showTrail) {
        const trail = document.createElementNS(ns, "line");
        trail.setAttribute("x1", pillX + pillW);
        trail.setAttribute("y1", yMid);
        trail.setAttribute("x2", innerW - 10);
        trail.setAttribute("y2", yMid);
        trail.setAttribute("stroke", "url(#gradTrailFlow)");
        trail.setAttribute("stroke-width", strokeW);
        trail.setAttribute("stroke-linecap", "round");
        trail.setAttribute("class", "glow");
        svg.appendChild(trail);
      }

      // Label
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", pillX + (M0.labelPadX ?? 16));
      label.setAttribute("y", pillY + pillH / 2 + 6);
      label.setAttribute("fill", M0.labelColor ?? "#ddeaef");
      label.setAttribute("font-weight", String(M0.labelWeight ?? 800));
      label.setAttribute("font-size", String(M0.labelPt ?? 16));
      label.setAttribute(
        "font-family",
        "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
      );
      label.textContent = LABEL;
      svg.appendChild(label);
    });

    // Return height so callers can add spacing if desired (kept for parity)
    return (M0.pill?.height ?? 64) + (M0.copyGapBottom ?? 14);
  }

  /* ----------------- RAIL (desktop + tablet only) ----------------- */
  function drawRail() {
    if (isMobile()) {
      while (railSvg.firstChild) railSvg.removeChild(railSvg.firstChild);
      return;
    }
    const r = rail.getBoundingClientRect();
    railSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    while (railSvg.firstChild) railSvg.removeChild(railSvg.firstChild);
    const pts = dots.map((el) => {
      const b = el.getBoundingClientRect();
      return {
        x: (b.left + b.right) / 2 - r.left,
        y: (b.top + b.bottom) / 2 - r.top
      };
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x);
      line.setAttribute("y2", b.y);
      line.setAttribute(
        "stroke",
        i < step ? "rgba(99,211,255,.70)" : "rgba(255,255,255,.12)"
      );
      line.setAttribute("stroke-width", 2);
      line.setAttribute("stroke-linecap", "round");
      railSvg.appendChild(line);
    }
  }
  function renderDots() {
    if (isMobile()) return;
    dots.forEach((el, i) => {
      el.classList.toggle("is-current", i === step);
      el.classList.toggle("is-done", i < step);
      el.textContent = i < step ? "✓" : String(i);
    });
  }

  /* ----------------- MOBILE: Step 1 DOM (existing) ----------------- */
  function mStepContainer({
    top = 40,
    bottom = 72,
    maxW = 520,
    sidePad = 16,
    nudgeX = 0,
    nudgeY = 0
  }) {
    const el = document.createElement("div");
    el.className = "mstep";
    el.style.marginTop = `${top}px`;
    el.style.marginBottom = `${bottom}px`;
    el.style.maxWidth = `${maxW}px`;
    el.style.padding = `0 ${sidePad}px`;
    el.style.transform = `translate(${nudgeX}px, ${nudgeY}px)`;
    return el;
  }
  function applyBoxStyles(node, base, ov) {
    const b = Object.assign({}, base, ov || {});
    node.style.width = `${b.widthPct ?? 100}%`;
    node.style.minHeight = `${b.minH ?? 56}px`;
    node.style.padding = `${b.padY ?? 10}px ${b.padX ?? 12}px`;
    node.style.borderWidth = `${b.border ?? 2}px`;
    node.style.borderColor = "rgba(99,211,255,.95)";
    node.style.borderRadius = `${b.radius ?? 14}px`;
    node.style.font = `${
      b.fontWeight ?? 525
    } ${b.fontPt ?? 11}pt Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
    node.style.letterSpacing = `${b.letter ?? 0.3}px`;
    node.style.lineHeight = `${b.lineEm ?? 1.15}em`;
    node.style.textAlign = b.align || "center";

    // allow base or override nudgeX/nudgeY
    const nx = b.nudgeX || 0;
    const ny = b.nudgeY || 0;
    if (nx || ny) {
      node.style.transform = `translate(${nx}px, ${ny}px)`;
    }
  }
  function renderStep1_DOM() {
    const cfg = window.PROCESS_CONFIG.step1 || {};
    const M = window.PROCESS_CONFIG.mobile?.step1 || {};

    // Outer container for the whole step
    const wrap = mStepContainer({
      top: M.top ?? 40,
      bottom: M.bottom ?? 72,
      maxW: M.maxW ?? 520,
      sidePad: M.sidePad ?? 16,
      nudgeX: M.nudgeX ?? 0,
      nudgeY: M.nudgeY ?? 0
    });

    // 1) COPY BLOCK FIRST
    const copy = document.createElement("div");
    copy.className = "mstep-copy";
    copy.style.marginBottom = `${M.copyGapBottom ?? 14}px`;
    copy.innerHTML = `
      <h3 style="margin:0 0 ${M.copyHGap ?? 8}px; color:${
      M.copyHColor ?? "#eaf0f6"
    };
                 font:600 ${(M.copyHpt ?? 22)}px 'Newsreader', Georgia, serif;">
        Who buys your stuff?
      </h3>
      <p style="margin:0; color:${M.copyColor ?? "#a7bacb"};
                font:400 ${(M.copyBodyPt ?? 14)}px/${(M.copyLine ?? 1.55)} Inter, system-ui;">
        Our <b>Intent Score</b> finds accounts most likely to purchase in the next cycle.
        We weight <b>recent</b> signals like search bursts, RFQ/RFP language, visits to pricing & sample pages,
        and events/trade shows, new product launches, and 38+ more metrics, then surface the prospects your team should contact today.
      </p>`;
    wrap.appendChild(copy);

    // 2) STEP TITLE AFTER COPY
    if (M.titleShow !== false) {
      const t = document.createElement("div");
      t.className = "mstep-title";
      t.innerHTML = '<span class="mstep-title-intent">Intent</span> Score';
      t.style.textAlign = M.titleAlign || "center";
      t.style.fontWeight = String(M.titleWeight ?? 700);
      t.style.fontSize = `${M.titlePt ?? 16}pt`;
      t.style.letterSpacing = `${M.titleLetter ?? 0.2}px`;
      t.style.marginTop = `${M.titleMarginTop ?? 6}px`;
      t.style.marginBottom = `${M.titleMarginBottom ?? 18}px`;

      const tNx = M.titleNudgeX ?? 0;
      const tNy = M.titleNudgeY ?? 0;
      if (tNx || tNy) {
        t.style.transform = `translate(${tNx}px, ${tNy}px)`;
      }

      wrap.appendChild(t);
    }

    // 3) BOX STACK
    const stack = document.createElement("div");
    stack.className = "mstack";
    stack.style.gap = `${M.stackGap ?? 24}px`;

    const labels = {
      rect1:
        cfg.LABEL_RECT_1 ?? "Back-To-Back Search (last 14d)",
      rect2:
        cfg.LABEL_RECT_2 ?? "RFQ/RFP Keywords Detected",
      round3:
        cfg.LABEL_ROUND_3 ?? "Pricing & Sample Page Hits",
      oval4:
        cfg.LABEL_OVAL_4 ??
        "Rising # of Ad Creatives (last 14d)",
      diamond5: cfg.LABEL_DIAMOND_5 ?? "Imp/Exp Cycle"
    };

    const order = Array.isArray(M.order)
      ? M.order
      : ["rect1", "rect2", "round3", "oval4", "diamond5"];
    const baseBox = M.box || {};
    const OVR = M.overrides || {};

    for (const key of order) {
      const ov = OVR[key] || {};
      if (key === "diamond5") {
        const dWrap = document.createElement("div");
        dWrap.className = "mdiamond";

        const dCfg = M.diamond || {};
        if (typeof dCfg.widthPct === "number") {
          dWrap.style.width = `${dCfg.widthPct}%`;
        } else if (typeof dCfg.size === "number") {
          dWrap.style.width = `${dCfg.size}px`;
        } else {
          dWrap.style.width = "45%";
        }

        dWrap.style.border = `${dCfg.border ?? 2}px solid rgba(99,211,255,.95)`;

        const dNx = ov.nudgeX ?? baseBox.nudgeX ?? 0;
        const dNy =
          ov.nudgeY ?? baseBox.nudgeY ?? (dCfg.nudgeY ?? 0);
        if (dNx || dNy) {
          dWrap.style.transform = `translate(${dNx}px, ${dNy}px) rotate(45deg)`;
        }

        const s = document.createElement("span");
        s.textContent = labels[key];
        s.style.width = "70%";
        s.style.height = "70%";
        s.style.font = `${
          baseBox.fontWeight ?? 525
        } ${(dCfg.labelPt ?? baseBox.fontPt ?? 11)}pt Inter, system-ui`;
        s.style.letterSpacing = `${baseBox.letter ?? 0.3}px`;
        s.style.lineHeight = `${baseBox.lineEm ?? 1.15}em`;
        s.style.padding = `${dCfg.pad ?? 10}px`;
        dWrap.appendChild(s);
        stack.appendChild(dWrap);
      } else {
        const box = document.createElement("div");
        box.className =
          "mbox" + (key === "oval4" ? " oval" : "");
        box.textContent = labels[key];
        applyBoxStyles(
          box,
          baseBox,
          Object.assign(
            {},
            key === "oval4" ? { radius: 9999 } : {},
            ov
          )
        );
        stack.appendChild(box);
      }
    }

    const dotsCfg = M.dots || {};
    if (dotsCfg.show !== false) {
      const row = document.createElement("div");
      row.className = "mdots";
      row.style.gap = `${dotsCfg.gap ?? 14}px`;
      row.style.paddingTop = `${dotsCfg.padTop ?? 6}px`;
      const n = Math.max(0, dotsCfg.count ?? 3);
      for (let i = 0; i < n; i++) {
        const dot = document.createElement("i");
        const size = `${dotsCfg.size ?? 6}px`;
        dot.style.width = size;
        dot.style.height = size;
        row.appendChild(dot);
      }
      stack.appendChild(row);
    }

    wrap.appendChild(stack);
    canvas.appendChild(wrap);
  }
  
  
  

  /* ----------------- ROUTERS ----------------- */
  // Desktop route (used for desktop + tablet)
  function drawDesktop() {
    clearCanvas();

    // Step 0 pill scene (already tablet-aware via TCFG().step0)
    if (step === 0 && phase === 1) {
      scenePill();
      return;
    }

    // Steps 1–5: use the SVG scenes from sections/process/steps/*.js
    const scene = window.PROCESS_SCENES[step];
    if (typeof scene === "function") {
      try {
        const cfg = deepClone(window.PROCESS_CONFIG["step" + step]);
        scene({
          ns,
          canvas,
          bounds: boundsDesktop(), // desktop + tablet share this
          config: cfg,
          makeFlowGradients,
          mountCopy
        });
      } catch (err) {
        console.error("process scene error (step " + step + "):", err);
      }
    }
  }

  // Spacer utility
  function push(yPx) {
    if (yPx <= 0) return;
    const spacer = document.createElement("div");
    spacer.style.height = `${yPx}px`;
    spacer.style.width = "1px";
    spacer.style.pointerEvents = "none";
    canvas.appendChild(spacer);
  }

  // Simple mobile placeholder (used when a step isn’t rendered yet)
  function renderPlaceholder(stepNo) {
    const PH = Object.assign(
      { top: 40, bottom: 72, height: 380 },
      MCFG().PLACEHOLDER || {}
    );
    const el = document.createElement("div");
    el.className = `mstep mstep-ph s${stepNo}`;
    el.style.marginTop = `${PH.top}px`;
    el.style.marginBottom = `${PH.bottom}px`;
    el.style.maxWidth = `${MCFG().step1?.maxW ?? 520}px`;
    el.style.padding = `0 ${MCFG().step1?.sidePad ?? 16}px`;
    el.style.height = `${PH.height}px`;
    el.style.pointerEvents = "none";
    canvas.appendChild(el);
  }

  // Mobile route (DOM mode only; desktop + tablet untouched)
  function drawMobile() {
    clearCanvas();
    canvas.style.position = "relative";
    canvas.style.inset = "auto";
    canvas.style.pointerEvents = "auto";

    const MODE = (MCFG().MODE || "dom").toLowerCase();

    // Step 0
    renderStep0_DOM();
    push(window.PROCESS_CONFIG.mobile?.step0?.gapAfterPill ?? 28);

    // Steps 1..5
    const seq = [1, 2, 3, 4, 5];

    for (const i of seq) {
      let rendered = false;

      if (i === 1) {
        if (MCFG().SHOW_STEPS?.[1]) {
          renderStep1_DOM();
          rendered = true;
        }
      } else {
        const scene = window.PROCESS_SCENES?.[i];
        if (MCFG().SHOW_STEPS?.[i] && typeof scene === "function") {
          try {
            scene({
              ns,
              canvas,
              bounds: boundsMobile(0, 700),
              config: deepClone(
                window.PROCESS_CONFIG["step" + i] || {}
              ),
              makeFlowGradients,
              mountCopy
            });
            rendered = true;
          } catch (err) {
            console.error("process scene " + i + " (mobile):", err);
          }
        }
      }

      if (!rendered && MCFG().SHOW_EMPTY !== false)
        renderPlaceholder(i);
    }

    canvas.style.minHeight = "auto";
  }

  function drawScene() {
    isMobile() ? drawMobile() : drawDesktop();
    applyTabletMainTitleNudge();
  }

  function setStep(n, opts = {}) {
    step = Math.max(0, Math.min(5, n | 0));
    if (typeof opts.phase === "number") phase = opts.phase;
    else if (step === 0 && phase === 0 && opts.fromInit) phase = 0;
    else if (step === 0) phase = 1;
    else phase = 1;

    if (!isMobile()) {
      railWrap.classList.toggle(
        "is-docked",
        step > 0 || (step === 0 && phase === 1)
      );
      prevBtn.disabled = step === 0 && phase === 0;
      nextBtn.disabled = step >= 5;
    }

    drawRail();
    placeLamp();
    renderDots();
    drawScene();
  }

  /* ----------------- EVENTS ----------------- */
  dots.forEach((d) =>
    d.addEventListener("click", () => {
      if (isMobile()) return;
      const i = +d.dataset.i;
      if (i === 0) {
        setStep(0, { phase: 1 });
      } else {
        setStep(i, { phase: 1 });
      }
    })
  );
  prevBtn?.addEventListener("click", () => {
    if (isMobile()) return;
    if (step === 0 && phase === 1) {
      setStep(0, { phase: 0 });
      return;
    }
    setStep(step - 1, { phase: 1 });
  });
  nextBtn?.addEventListener("click", () => {
    if (isMobile()) return;
    if (step === 0 && phase === 0) {
      setStep(0, { phase: 1 });
      return;
    }
    setStep(step + 1, { phase: 1 });
  });

  addEventListener(
    "resize",
    () => {
      drawRail();
      placeLamp();
      drawScene();
    },
    { passive: true }
  );
  railWrap.addEventListener("transitionend", (e) => {
    if (e.propertyName === "left" || e.propertyName === "transform") {
      drawRail();
      placeLamp();
      drawScene();
    }
  });

  /* ----------------- PUBLIC UTILS ----------------- */
  window.PROCESS_REPAINT = () => {
    drawRail();
    placeLamp();
    drawScene();
  };

  /* ----------------- INIT ----------------- */
  function init() {
    phase = 0;
    setStep(0, { fromInit: true });
    requestAnimationFrame(() => {
      drawRail();
      placeLamp();
    });
  }
  if (document.readyState === "complete") init();
  else addEventListener("load", init, { once: true });
})();