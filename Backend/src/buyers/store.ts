/* Simple in-memory store for leads with sensible region filtering & de-dupe. */

export type Temp = 'hot' | 'warm';
export type Region = 'us' | 'ca' | string;

export interface LeadItem {
  id?: number;
  host: string;
  title?: string;
  platform?: string;
  temperature?: Temp;
  whyText?: string;
  why?: any;
  created?: string;
  region?: Region;
}

interface ListOpts {
  temp?: Temp | 'warm';         // 'hot' | 'warm'
  region?: 'us' | 'ca' | 'usca' | string; // 'usca' means US or CA
  limit?: number;
}

class LeadStore {
  private items: LeadItem[] = [];
  private nextId = 1;

  /** Adds many, de-duping by host+title (case-insensitive). */
  addMany(list: LeadItem[]) {
    const existing = new Set(
      this.items.map((x) => `${x.host}::${(x.title || '').toLowerCase()}`)
    );
    for (const raw of list) {
      const key = `${raw.host}::${(raw.title || '').toLowerCase()}`;
      if (existing.has(key)) continue;

      const item: LeadItem = {
        ...raw,
        id: this.nextId++,
        created: raw.created || new Date().toISOString(),
      };
      this.items.unshift(item);
      existing.add(key);
    }
    return { created: list.length };
  }

  /** Lists leads with temperature + region filtering. */
  list(opts: ListOpts) {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
    let out = this.items.slice();

    if (opts.temp === 'hot') {
      out = out.filter((x) => x.temperature === 'hot');
    } else if (opts.temp === 'warm') {
      out = out.filter((x) => x.temperature !== 'hot'); // everything not hot
    }

    if (opts.region) {
      const reg = String(opts.region).toLowerCase();
      if (reg === 'usca') {
        // Include US or CA (and DO NOT drop unknown — they often come from global feeds)
        out = out.filter((x) => !x.region || x.region === 'us' || x.region === 'ca');
      } else if (reg === 'us' || reg === 'ca') {
        out = out.filter((x) => !x.region || x.region === reg);
      }
      // any other region string -> treat like "all"
    }

    return { items: out.slice(0, limit) };
  }

  clear() {
    this.items = [];
    this.nextId = 1;
  }
}

const store = new LeadStore();
export default store;
