import { discoverBuyers } from './discovery';

export async function processLeads(supplier: { name: string; website: string }) {
  const leads = await discoverBuyers(supplier);
  // Add any necessary pipeline processing steps here (e.g., deduplication, scoring)
  return leads;
}
