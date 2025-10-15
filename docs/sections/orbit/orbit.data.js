/* sections/orbit/orbit.data.js
   Centralizes content/metrics for the orbit nodes.
   Load this BEFORE orbit.js. orbit.js reads window.ORBIT_DATA. */
(function () {
  const LS = window.localStorage;
  let host = "yourcompany.com";
  try { host = JSON.parse(LS.getItem("onb.seed") || "{}")?.host || host; } catch {}

  // tiny helper to format ints
  const n = (x) => x.toLocaleString();

  window.ORBIT_DATA = {
    host,
    nodes: {
      heat: {
        tag: "Signal",
        title: "Buyer Heat",
        hero: "Top 12 active buyers this week",
        items: [
          `High-intent visits to ${host}`,
          `Repeat visits from target accounts`,
          `Time-on-page > 90s on product pages`,
          "3+ pricing page views per account",
        ],
        fine: "Based on web + partner signals, deduped by company."
      },
      buyers: {
        tag: "Companies",
        title: "Buyers",
        hero: `${n(87)} ranked this week`,
        items: [
          "Company, location, industry, size",
          "Decision-maker discovery",
          "Email/phone enrichment (opt-in)",
          "Fit score + intent score"
        ],
        fine: "Sorted by blended fit × intent."
      },
      rfp: {
        tag: "Docs",
        title: "RFPs & Documents",
        hero: `${n(26)} fresh RFPs`,
        items: [
          "Packaging RFPs and bid portals",
          "Specs scraped & summarized",
          "Deadlines + required certifications",
          "Auto-watch keywords"
        ],
        fine: "Sources include public portals + curated feeds."
      },
      buzz: {
        tag: "Market",
        title: "Market Buzz",
        hero: `${n(1_240)} mentions scanned`,
        items: [
          "News, PR, funding + expansion",
          "Sustainability & regulatory triggers",
          "New product launches",
          "Social & forum chatter (noise filtered)"
        ],
        fine: "Only high-confidence mentions are counted."
      },
      hiring: {
        tag: "Ops",
        title: "Hiring",
        hero: `${n(53)} roles flagged`,
        items: [
          "Ops/packaging/engineering roles",
          "Lines, materials, machinery named",
          "Urgency & seniority signals",
          "Region + plant locations"
        ],
        fine: "Great for timing capacity or outreach."
      },
      competition: {
        tag: "Landscape",
        title: "Competition",
        hero: `${n(14)} overlapping deals`,
        items: [
          "Competitor site changes",
          "Head-to-head wins/losses",
          "Ad spend spikes & keywords",
          "Pricing page deltas"
        ],
        fine: "Competitive set tuned to your sector."
      }
    }
  };
})();