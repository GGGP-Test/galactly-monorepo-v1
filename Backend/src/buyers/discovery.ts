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
      const matches = response.data.match(/<a href="(.*?)">(.*?)</a>/g);
      if (matches) {
        matches.forEach(match => {
          const [fullMatch, url, title] = match.match(/<a href="(.*?)">(.*?)</a>/);
          leads.push({ source: source.name, url, title, query: source.url });
        });
      }
    } catch (error) {
      console.error(`Error fetching leads from ${source.name}:`, error);
    }
  }
  return leads;
};