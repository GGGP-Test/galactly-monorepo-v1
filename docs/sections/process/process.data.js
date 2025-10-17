/* Section 3 – Process (Data only)
   This file defines:
   - The workflow columns exactly like your diagram (Intent → Weight → Character → Platform → Result)
   - A richer theme so Section 3 isn’t “one-color”; uses a triad (primary/secondary/tertiary) for contrast
   - A flow hint so the JS can draw animated “neon” lines between adjacent columns
   Do NOT wrap this in a function. It must assign an object to window.PROCESS_DATA.
*/
window.PROCESS_DATA = {
  // --------- copy ----------
  title: "How the scoring engine works",
  sub:   "We score each lead across four lenses, then surface the fastest wins.",

  // --------- theme (dark, triadic accents + glass tokens) ----------
  // These are Section-3-only tokens; process.css will read them.
  theme: {
    // base
    bg:         "#0b1119",
    text:       "#e9f1f7",
    muted:      "#97a9bc",
    stroke:     "rgba(255,255,255,.08)",

    // Material-ish triad to avoid “same gold everywhere”
    primary:    "#E6C36B", // warm gold
    secondary:  "#7FB2FF", // cool blue
    tertiary:   "#F471B5", // pink/magenta accent

    // neutrals for neon/glow cables
    cable:      "rgba(242,220,160,.55)",
    cableDim:   "rgba(242,220,160,.18)",

    // glassmorphism tokens for CTA (Next / Prev)
    glass: {
      fill:      "rgba(255,255,255,.06)",
      stroke:    "rgba(255,255,255,.12)",
      blurPx:    10,
      hoverFill: "rgba(255,255,255,.10)",
      activeFill:"rgba(255,255,255,.16)"
    }
  },

  // --------- workflow structure (your Figma layout) ----------
  // Guard / gate
  gate: {
    id: "guard",
    label: "Score System",
    question: "Lead?",
    pathIfYes: true  // simple hint for the UI to show “YES” pill before columns
  },

  // Columns (lanes). Keep ids stable; JS uses them.
  columns: [
    {
      id: "intent",
      label: "Intent Score",
      emoji: "⚡",
      nodes: [
        { id:"search",   emoji:"🔎", label:"Number of searches / timeblock" },
        { id:"tech",     emoji:"🛠️", label:"Technologies used at the warehouse" },
        { id:"ltv",      emoji:"📈", label:"Number of customers (LTV/CAC)" },
        { id:"tools",    emoji:"🧰", label:"Tools interacted" },
        { id:"size",     emoji:"🏢", label:"Company size" }
      ]
    },
    {
      id: "weight",
      label: "Weight Score",
      emoji: "⚖️",
      nodes: [
        { id:"posting",  emoji:"🗞️", label:"Posting behavior" },
        { id:"goodwill", emoji:"🎁", label:"Good-will offers / free lead magnets" },
        { id:"nature",   emoji:"🏭", label:"Nature of the business" },
        { id:"freq",     emoji:"🔁", label:"Frequency of purchases / partnerships" }
      ]
    },
    {
      id: "character",
      label: "Character Score",
      emoji: "🧠",
      nodes: [
        { id:"reviews",  emoji:"⭐", label:"Score of past reviews (cross-platform)" },
        { id:"jumps",    emoji:"↔️", label:"Number of vendor jumps (time window)" },
        { id:"values",   emoji:"💬", label:"Language → values" },
        { id:"culture",  emoji:"🌐", label:"Language → culture" }
      ]
    },
    {
      id: "platform",
      label: "Platform Score",
      emoji: "📡",
      nodes: [
        { id:"posts",    emoji:"🗂️", label:"Number of posts / platform" },
        { id:"comments", emoji:"💬", label:"Number of comments / platform" },
        { id:"reply",    emoji:"✉️", label:"Intent to respond" }
      ]
    }
  ],

  // “Result” panel at the end
  result: {
    title: "Result",
    bullets: [
      "Fastest-to-buy window",
      "Likely retention horizon",
      "Advocacy potential",
      "Best first contact channel"
    ]
  },

  // Right-hand copy (rail). Order matters.
  stepsRail: [
    { id:"guard",     title:"Score System",   body:"We only advance leads that match your persona." },
    { id:"intent",    title:"Intent score",   body:"How fast they’re likely to buy." },
    { id:"weight",    title:"Weight score",   body:"How commercially meaningful they are." },
    { id:"character", title:"Character score",body:"How they behave with suppliers & customers." },
    { id:"platform",  title:"Platform score", body:"Where they’ll most likely reply first." },
    { id:"result",    title:"Result",         body:"Prioritised list with the reasoning attached." }
  ],

  // --------- flow (for animated connectors) ----------
  // We want a dense, “signal flowing” mesh: connect each node to all nodes in the next column.
  flow: {
    strategy: "adjacent-all", // JS will connect every node i in col N to every node j in col N+1
    // Optional manual edges can be added later if you want emphasis lines only:
    // edges: [{from:"intent.search", to:"weight.posting"}]
    cableCurve: 0.18,     // bezier curvature
    cableJitter: 0.035,   // slight random offset so lines don’t perfectly overlap
    pulseMs: 2600         // glow pulse duration for “alive” feel
  },

  // --------- layout hints ----------
  layout: {
    // Section spacing and proportions; CSS will use these variables.
    maxWidth: 1140,
    laneGap: 22,         // px gap between lanes
    chipGap: 12,         // px gap between chips
    boardPadding: 18,    // inner padding for the board
    dockWidth: 320,      // width of the docked stepper on desktop
    mobileBreakpoint: 820
  }
};