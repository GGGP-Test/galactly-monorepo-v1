import { discoverBuyers } from './discovery';

export async function processLeads(supplier: { location: string }): Promise<Array<{ url: string; name: string; location: string; evidence: string }>> {
  const leads = await discoverBuyers(supplier);
  // Filter for US/Canada leads and remove duplicates
  const filteredLeads = [...new Set(leads.filter(lead => lead.location.includes('US') || lead.location.includes('Canada')))];
  return filteredLeads.slice(0, 3); // Return top 3
}