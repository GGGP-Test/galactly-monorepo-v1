import axios from 'axios';

export async function discoverBuyers(supplier: { location: string }): Promise<Array<{ url: string; name: string; location: string; evidence: string }>> {
  const location = supplier.location;
  const sources = [
    {
      name: "Google",
      url: `https://www.google.com/search?q=packaging+suppliers+${location}`,
    },
    {
      name: "Kompass",
      url: `https://www.kompass.com/us/c/packaging/`,
    },
    {
      name: "Thomasnet",
      url: `https://www.thomasnet.com/products/packaging/`,
    },
  ];

  const results = [];
  for (const source of sources) {
    try {
      const response = await axios.get(source.url);
      // Basic parsing - replace with more robust logic
      const matches = response.data.match(/<a href="(.*?)">(.*?)</a>/g);
      if (matches) {
        for (const match of matches) {
          const [fullMatch, url, name] = match.match(/<a href="(.*?)">(.*?)</a>/);
          results.push({ url, name, location, evidence: `${source.name}: ${url}` });
        }
      }
    } catch (error) {
      console.error(`Error fetching from ${source.name}:`, error);
    }
  }
  return results;
}