// docs/sections/process/process.data.js
// Provides the data factory consumed by process.js (Pathrail v3)
(function () {
  window.PROCESS_DATA = function PROCESS_DATA() {
    return {
      title: "How the scoring engine works",
      sub: "We score each lead across four lenses, then surface the fastest wins.",
      columns: [
        {
          id: "intent",
          label: "Intent Score",
          emoji: "⚡",
          nodes: [
            { id: "search",   emoji: "🔎", label: "Search velocity" },
            { id: "tech",     emoji: "🛠️", label: "Warehouse tech" },
            { id: "ltv",      emoji: "📈", label: "Customer LTV/CAC" },
            { id: "tools",    emoji: "🧰", label: "Tools interacted" },
            { id: "size",     emoji: "🏢", label: "Company size" }
          ]
        },
        {
          id: "weight",
          label: "Weight Score",
          emoji: "⚖️",
          nodes: [
            { id: "posting",  emoji: "🗞️", label: "Posting behaviour" },
            { id: "goodwill", emoji: "🎁", label: "Offers / lead magnets" },
            { id: "nature",   emoji: "🏭", label: "Nature of business" },
            { id: "freq",     emoji: "🔁", label: "Purchase frequency" }
          ]
        },
        {
          id: "character",
          label: "Character Score",
          emoji: "🧠",
          nodes: [
            { id: "reviews",  emoji: "⭐", label: "Past reviews" },
            { id: "jumps",    emoji: "↔️", label: "Vendor switching" },
            { id: "values",   emoji: "💬", label: "Language → values" },
            { id: "culture",  emoji: "🌐", label: "Language → culture" }
          ]
        },
        {
          id: "platform",
          label: "Platform Score",
          emoji: "📡",
          nodes: [
            { id: "posts",    emoji: "🗂️", label: "# posts / platform" },
            { id: "comments", emoji: "💬", label: "# comments / platform" },
            { id: "reply",    emoji: "✉️", label: "Intent to respond" }
          ]
        }
      ],
      result: {
        title: "Result",
        bullets: [
          "Fastest-to-buy window",
          "Likely retention horizon",
          "Advocacy potential",
          "Best first contact channel"
        ]
      },
      steps: [
        { id: "intro",     title: "Score System",    body: "We only advance leads that match your persona." },
        { id: "intent",    title: "Intent score",    body: "How fast they’re likely to buy." },
        { id: "weight",    title: "Weight score",    body: "How commercially meaningful they are." },
        { id: "character", title: "Character score", body: "How they behave with suppliers & customers." },
        { id: "platform",  title: "Platform score",  body: "Where they’ll most likely reply first." },
        { id: "result",    title: "Result",          body: "Prioritised list with the reasoning attached." }
      ]
    };
  };
})();