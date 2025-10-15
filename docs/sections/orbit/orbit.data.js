/* Minimal data for Section 3 */
window.ORBIT = {
  title: "Where your buyers light up",
  subtitlePrefix: "Simple orbit map of the strongest intent signals for ",
  nodes: [
    { id:"competition", label:"Competition", ring:0.86, size:"l" },
    { id:"buyers",      label:"Buyers",      ring:0.86, size:"m" },
    { id:"rfp",         label:"RFPs & Docs", ring:0.70, size:"m" },
    { id:"buzz",        label:"Market Buzz", ring:0.56, size:"m" },
    { id:"hiring",      label:"Hiring",      ring:0.42, size:"s" },
    { id:"heat",        label:"Buyer Heat",  ring:0.30, size:"l" }
  ],
  cards: {
    competition: { title:"Competitors gaining ground", points:["Share-of-voice up 18%","Pricing pages trending","Feature parity claims rising"], heroMetric:"18% ↑ SOV (30d)" },
    buyers:      { title:"Companies ready to talk",     points:["Fit score ≥ 82","Recent website activity","Decision titles detected"],   heroMetric:"87 hot buyers" },
    rfp:         { title:"Active RFPs & docs",          points:["Procurement portals","PDF/RFP mentions","Submission windows open"],      heroMetric:"23 live docs" },
    buzz:        { title:"Market buzz",                  points:["News velocity +12%","Forum chatter ↑","Regulatory mentions"],           heroMetric:"+12% velocity" },
    hiring:      { title:"Buyer-side hiring",            points:["Ops & packaging roles","New plants announced","Capex notes"],           heroMetric:"41 openings" },
    heat:        { title:"Buyer heat",                   points:["High-intent clusters","Repeat sessions","C-level engagement"],          heroMetric:"85/100 peak" }
  }
};