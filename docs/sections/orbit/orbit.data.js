/* global window */
window.ORBIT_DATA = {
  // Edit the title that appears above the canvas (already wired in your markup)
  title: "Where your buyers light up",

  // === knobs you asked for ===
  // rotation speed in RADIANS PER SECOND (0.0…)
  // slower = smaller number, faster = larger number
  speed: 0.18,          // ← tweak here (e.g., 0.10 slow … 0.30 faster)

  // orbit radius as fraction of the shortest side of the section (0–0.5 is sensible)
  radiusPct: 0.34,      // ← tweak here to make the circle larger/smaller

  // even spacing is automatic based on order in this array
  nodes: [
    {
      id: "buyers",
      label: "Buyers",
      emoji: "👥",
      desc:
        "Known buyer accounts actively evaluating options in your sectors. Great for targeted outreach."
    },
    {
      id: "rfp",
      label: "RFPs & Docs",
      emoji: "📄",
      desc:
        "Open RFPs, public specs and procurement docs that match your capabilities."
    },
    {
      id: "buzz",
      label: "Market Buzz",
      emoji: "🔥",
      desc:
        "News spikes, product launches and funding events that correlate with fresh packaging demand."
    },
    {
      id: "heat",
      label: "Buyer Heat",
      emoji: "🧭",
      desc:
        "Real-time intent signals from your site + public sources. Scored and ranked."
    },
    {
      id: "competition",
      label: "Competition",
      emoji: "✖️",
      desc:
        "Signals that a competitor is engaging the same accounts. Use to prioritize and counter-position."
    }
  ]
};