import { discoverBuyers } from './discovery';

export const processLeads = async (supplier) => {
  const leads = await discoverBuyers(supplier);
  return leads.map(lead => ({ ...lead, evidence: { url: lead.url, query: supplier.name } }));
};