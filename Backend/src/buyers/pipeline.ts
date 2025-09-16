import { discoverBuyers } from './discovery';

export async function getLeads(supplier: { city: string; state: string; country: string }): Promise<Array<{ url: string; name: string; query: string }>> {
  const leads = await discoverBuyers(supplier);
  //Further pipeline processing if needed (e.g., deduplication, filtering)
  return leads.filter(lead => lead.url && lead.name && lead.query);
}
