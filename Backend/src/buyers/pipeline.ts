export function processLeads(leads: any[]) {
  return leads.filter(lead => lead.country === 'US' || lead.country === 'CA' && lead.industry === 'packaging');
}
