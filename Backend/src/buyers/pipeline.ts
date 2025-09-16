import { discoverBuyers } from './discovery';

export const processLeads = async (supplier) => {
  const leads = await discoverBuyers(supplier);
  // Basic filtering - replace with more robust logic
  return leads.filter(lead => lead.name.includes('Packaging') && (lead.url.includes('canada') || lead.url.includes('us')));
};