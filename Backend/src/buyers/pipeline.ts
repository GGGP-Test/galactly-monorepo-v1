import { discoverBuyers } from './discovery';

export const processLeads = async (supplier) => {
  const leads = await discoverBuyers(supplier);
  // Add filtering and enrichment here based on AUTONOMY.md criteria
  return leads.filter(lead => lead.name && lead.source && lead.url);
};