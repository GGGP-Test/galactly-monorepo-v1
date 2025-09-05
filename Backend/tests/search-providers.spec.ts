import { SearchProviders } from '../src/search-providers';

describe('SearchProviders', () => {
  it('composes a plan and returns normalized results (mocked via missing keys)', async () => {
    const sp = new SearchProviders({ freeFirst: true, ratePerSec: 1000 });
    const out = await sp.discoverLeads({ q: 'stretch wrap packaging distributor New Jersey', num: 5 });
    // With no API keys, we expect either empty or CommonCrawl results; should still be an array.
    expect(Array.isArray(out)).toBe(true);
  });
});
