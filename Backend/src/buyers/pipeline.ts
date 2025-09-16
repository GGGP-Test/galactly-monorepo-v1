export function processLeads(leads: any[]) {
  return leads.filter((lead) => lead.country === 'US' || lead.country === 'CA')
    .filter((lead) => lead.source !== 'DEMO_SOURCE')
    .map((lead) => ({ ...lead, score: calculateLeadScore(lead) }))
    .sort((a, b) => b.score - a.score);
}

function calculateLeadScore(lead: any) {
  // Implementation to calculate lead score based on various factors
  // ... (Implementation details)
  return 1; // Replace with actual score calculation
}
