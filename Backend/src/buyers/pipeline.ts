import { discoverBuyers } from './discovery';

export const processLeads = async (supplier) => {
  const leads = await discoverBuyers(supplier);
  // Filter out demo leads
  const filteredLeads = leads.filter(lead => lead.source !== 'DEMO_SOURCE');
  // Add geo-filtering and freshness checks here
  // ...
  return filteredLeads;
};