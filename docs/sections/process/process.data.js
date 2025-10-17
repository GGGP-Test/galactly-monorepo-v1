// docs/sections/process/process.data.js
// Pure data for Section 3 (Process). No DOM work here.
// We export a function so process.js can do: const D = window.PROCESS_DATA();
(function () {
  const DATA = {
    title: "How the scoring engine works",
    sub:   "We score each lead across four lenses, then surface the fastest wins.",

    // Stepper order for desktop:
    // 0 = intro/overview → show everything at once
    // 1..4 = zoom each column
    // 5 = result
    steps: [
      { id: "intro",     title: "Overview",        body: "Tap Next to preview the whole flow." },
      { id: "intent",    title: "Intent score",    body: "How fast they’re likely to buy." },
      { id: "weight",    title: "Weight score",    body: "How commercially meaningful they are." },
      { id: "character", title: "Character score", body: "How they behave with suppliers & customers." },
      { id: "platform",  title: "Platform score",  body: "Where they’ll most likely reply first." },
      { id: "result",    title: "Result",          body: "Prioritised list with the reasoning attached." }
    ],

    // Four lenses (columns) + their nodes.
    columns: [
      { id:"intent",    label:"Intent Score",    emoji:"⚡",
        nodes:[
          {id:"search",   emoji:"🔎", label:"Search velocity"},
          {id:"ltv",      emoji:"📈", label:"Customer LTV/CAC"},
          {id:"size",     emoji:"🏢", label:"Company size"},
          {id:"tech",     emoji:"🛠️", label:"Warehouse tech"},
          {id:"tools",    emoji:"🧰", label:"Tools interacted"}
        ]},
      { id:"weight",    label:"Weight Score",    emoji:"⚖️",
        nodes:[
          {id:"posting",  emoji:"🗞️", label:"Posting behaviour"},
          {id:"offers",   emoji:"🎁", label:"Offers / lead magnets"},
          {id:"nature",   emoji:"🏭", label:"Nature of business"},
          {id:"freq",     emoji:"🔁", label:"Purchase frequency"}
        ]},
      { id:"character", label:"Character Score", emoji:"🧠",
        nodes:[
          {id:"reviews",  emoji:"⭐", label:"Past reviews"},
          {id:"switch",   emoji:"↔️", label:"Vendor switching"},
          {id:"values",   emoji:"💬", label:"Language → values"},
          {id:"culture",  emoji:"🌐", label:"Language → culture"}
        ]},
      { id:"platform",  label:"Platform Score",  emoji:"📡",
        nodes:[
          {id:"posts",    emoji:"🗂️", label:"# posts / platform"},
          {id:"comments", emoji:"💬", label:"# comments / platform"},
          {id:"reply",    emoji:"✉️", label:"Intent to respond"}
        ]}
    ],

    // Final “result” card copy
    result: {
      title: "Result",
      bullets: [
        "Fastest-to-buy window",
        "Likely retention horizon",
        "Advocacy potential",
        "Best first contact channel"
      ]
    }
  };

  // Export as a function (avoids “is not a function” runtime if process.js calls it).
  window.PROCESS_DATA = function () { return DATA; };
})();