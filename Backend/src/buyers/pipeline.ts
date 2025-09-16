import { discoverBuyers } from './discovery';

export async function getLeads(supplier: { location: string }): Promise<Array<{ name: string; url: string; location: string; evidence: string }>> {
  const leads = await discoverBuyers(supplier);
  return leads.filter(lead => lead.location.includes('US') || lead.location.includes('Canada'));
}
