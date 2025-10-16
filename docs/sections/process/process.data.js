// docs/sections/process/process.data.js
// Export as a FUNCTION because process.js calls window.PROCESS_DATA()
window.PROCESS_DATA = function () {
  const data = {
    title: "How the scoring engine works",
    sub: "We score each lead across four lenses, then surface the fastest wins.",

    lenses: [
      {
        id: "intent",
        label: "Intent Score",
        emoji: "⚡",
        chips: [
          { id:"search",   emoji:"🔎", label:"Search velocity" },
          { id:"ltv",      emoji:"📈", label:"Customer LTV/CAC" },
          { id:"size",     emoji:"🏢", label:"Company size" },
          { id:"tech",     emoji:"🛠️", label:"Warehouse tech" },
          { id:"tools",    emoji:"🧰", label:"Tools interacted" }
        ]
      },
      {
        id: "weight",
        label: "Weight Score",
        emoji: "⚖️",
        chips: [
          { id:"posting",  emoji:"📰", label:"Posting behaviour" },
          { id:"goodwill", emoji:"🎁", label:"Offers / lead magnets" },
          { id:"nature",   emoji:"🏭", label:"Nature of business" },
          { id:"freq",     emoji:"🔁", label:"Purchase frequency" }
        ]
      },
      {
        id: "character",
        label: "Character Score",
        emoji: "🧠",
        chips: [
          { id:"reviews",  emoji:"⭐", label:"Past reviews" },
          { id:"jumps",    emoji:"↔️", label:"Vendor switching" },
          { id:"values",   emoji:"💬", label:"Language → values" },
          { id:"culture",  emoji:"🌐", label:"Language → culture" }
        ]
      },
      {
        id: "platform",
        label: "Platform Score",
        emoji: "📡",
        chips: [
          { id:"posts",    emoji:"🗂️", label:"# posts / platform" },
          { id:"comments", emoji:"💬", label:"# comments / platform" },
          { id:"reply",    emoji:"✉️", label:"Intent to respond" }
        ]
      },
      {
        id: "result",
        label: "Result",
        emoji: "🎯",
        bullets: [
          "Fastest-to-buy window",
          "Likely retention horizon",
          "Advocacy potential",
          "Best first contact channel"
        ]
      }
    ],

    steps: [
      { id:"system",    title:"Score System",    body:"We only advance leads that match your persona." },
      { id:"intent",    title:"Intent score",    body:"How fast they’re likely to buy." },
      { id:"weight",    title:"Weight score",    body:"How commercially meaningful they are." },
      { id:"character", title:"Character score", body:"How they behave with suppliers & customers." },
      { id:"platform",  title:"Platform score",  body:"Where they’ll most likely reply first." },
      { id:"result",    title:"Result",          body:"Prioritised list with the reasoning attached." }
    ]
  };

  // Back-compat for any code that still looks for `columns`
  data.columns = data.lenses;
  return data;
};