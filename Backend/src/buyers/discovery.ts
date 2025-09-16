import axios from 'axios';

export const discoverBuyers = async (supplier) => {
  const sources = [
    { name: "Google", url: `https://www.google.com/search?q=${encodeURIComponent(supplier.name)} packaging distributor canada` },
    { name: "Kompass", url: `https://us.kompass.com/search?q=${encodeURIComponent(supplier.name)}` },
    { name: "Thomasnet", url: `https://www.thomasnet.com/company/${encodeURIComponent(supplier.name)}` }
  ];

  const results = await Promise.all(sources.map(async (source) => {
    try {
      const response = await axios.get(source.url);
      return { source: source.name, data: response.data };
    } catch (error) {
      console.error(`Error fetching from ${source.name}:`, error);
      return { source: source.name, data: null };
    }
  }));

  return results.filter(result => result.data !== null);
};