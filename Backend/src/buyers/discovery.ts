import axios from 'axios';

export const discoverBuyers = async (supplier) => {
  const sources = [
    { name: "Google", url: `https://www.google.com/search?q=${encodeURIComponent(supplier.name)} packaging distributor canada` },
    { name: "Kompass", url: `https://www.kompass.com/us/c/packaging/` },
    { name: "Thomasnet", url: `https://www.thomasnet.com/products/packaging/` },
  ];

  const leads = [];
  for (const source of sources) {
    try {
      const response = await axios.get(source.url);
      // Basic parsing - replace with more robust logic
      const matches = response.data.match(/\b(\w+\s?\w+\s?\w+)\b/g);
      if (matches) {
        matches.forEach(match => {
          leads.push({ source: source.name, name: match, url: source.url });
        });
      }
    } catch (error) {
      console.error(`Error fetching leads from ${source.name}:`, error);
    }
  }
  return leads.filter((lead, index) => index < 3 && lead.name !== 'DEMO_SOURCE');
};