export const processLeads = (leads) => {
  return leads.filter(lead => lead.url.includes('canada') || lead.url.includes('us'))
    .filter(lead => !lead.url.includes('sam.gov'))
    .filter(lead => !lead.url.includes('rfp'))
    .slice(0, 3); // Return top 3
};