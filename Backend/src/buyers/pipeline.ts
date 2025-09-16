import { discoverBuyers } from './discovery';

export async function processLeads(supplier: { name: string; website: string }) {
  const leads = await discoverBuyers(supplier);
  // Implement logic to filter and prioritize leads based on criteria in AUTONOMY.md
  // e.g., recency, location, relevance
  const filteredLeads = leads.filter(lead => lead.source !== 'DEMO_SOURCE' && lead.website);
  return filteredLeads;
}
