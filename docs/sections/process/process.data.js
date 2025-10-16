/* global window */
/* Lead Intelligence workflow (content + structure only)
   Used by sections/process/process.js to render the scrollytelling graph.
*/
window.PROCESS_DATA = {
  title: "Lead Intelligence — from signal to result",

  // Gate before columns
  gate: { id: "gate", label: "Score System", outcomeYes: "Lead ✓" },

  /* Columns appear left→right. Keep labels brief; details live in steps[]. */
  columns: [
    {
      id: "intent",
      label: "Intent Score",
      aim: "How fast will they buy?",
      nodes: [
        { id: "searches",  label: "Searches / time block", emoji: "🔎" },
        { id: "stack",     label: "Warehouse tech stack",  emoji: "🧱" },
        { id: "ltv_cac",   label: "Customer LTV/CAC",      emoji: "📈" },
        { id: "tools",     label: "Tools interacted",      emoji: "🛠️" },
        { id: "size",      label: "Company size",          emoji: "🏢" }
      ],
      wiring: "dense" // renderer will draw many-to-many to next column
    },
    {
      id: "weight",
      label: "Weight Score",
      aim: "How long will they stay?",
      nodes: [
        { id: "posting",   label: "Posting behavior",      emoji: "🗓️" },
        { id: "goodwill",  label: "Goodwill / free offers",emoji: "🎁" },
        { id: "nature",    label: "Nature of business",    emoji: "🏭" },
        { id: "frequency", label: "Purchase frequency",    emoji: "🔁" }
      ],
      wiring: "dense"
    },
    {
      id: "character",
      label: "Character Score",
      aim: "What kind of partner are they?",
      nodes: [
        { id: "reviews",   label: "Past review scores",    emoji: "⭐" },
        { id: "churn",     label: "Supplier switching",    emoji: "🔀" },
        { id: "value_lang",label: "Value & culture (lang)",emoji: "💬" },
        { id: "advocacy",  label: "Referral/advocacy bias",emoji: "📣" }
      ],
      wiring: "dense"
    },
    {
      id: "platform",
      label: "Platform Score",
      aim: "Where to reach first?",
      nodes: [
        { id: "posts",     label: "Posts per platform",    emoji: "🧵" },
        { id: "comments",  label: "Comments per firm",     emoji: "💬" },
        { id: "reply",     label: "Intent to respond",     emoji: "✅" }
      ],
      wiring: "dense"
    }
  ],

  // Final result card
  result: {
    id: "result",
    label: "Result",
    emoji: "🎯",
    bullets: [
      "Buy window: hot/warm/cool with days-to-contact",
      "Retention risk band + renewal cue",
      "Advocacy likelihood (review/referral)",
      "Primary outreach channel (email/SMS/DM) with fallback"
    ]
  },

  /* Scrollytelling copy (right rail). The renderer will pin the canvas and
     step through these with a progress spine. */
  steps: [
    {
      id: "gate",
      title: "Gate: Is this a lead?",
      body:
        "We run your persona gate first (Step 3 data + classifier v1). If it passes, it enters the scoring pipeline."
    },
    {
      id: "intent",
      title: "Intent Score — speed to buy",
      body:
        "Signals that correlate with immediacy: recent searches, stack changes, customer economics, touched tools, and size."
    },
    {
      id: "weight",
      title: "Weight Score — stay length",
      body:
        "Behavioral + structural anchors: posting rhythm, goodwill patterns, business nature, and purchase cadence."
    },
    {
      id: "character",
      title: "Character Score — partner quality",
      body:
        "History and language give away temperament: reviews, switching events, value framing, and advocacy bias."
    },
    {
      id: "platform",
      title: "Platform Score — first touch channel",
      body:
        "We pick the highest-yield channel based on activity and reply history, with a smart fallback."
    },
    {
      id: "result",
      title: "Result — a ranked, actionable lead",
      body:
        "One card per company with buy-window, retention band, advocacy odds, and the primary outreach channel."
    }
  ],

  /* Theme + renderer hints (the JS will read these and fall back to defaults) */
  theme: {
    ringRadiusPx: 280,          // base radius for the column rings (visual only)
    nodeDensity: "high",        // influences connector count
    bg: { aurora: true, faint: true } // keep the section muted but congruent
  }
};