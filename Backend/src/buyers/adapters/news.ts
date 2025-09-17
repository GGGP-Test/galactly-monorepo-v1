/* News adapter — turns Google News RSS into real, region-stamped leads.
   - Extracts publisher URL from Google News links (?url=… or final redirect)
   - Chooses temperature (hot|warm) from title keywords
   - Stamps region: "us" / "ca" (for "usca" we default to "us")
   - Returns candidates; the route will persist them via the store.
*/

type Region = 'us' | 'ca' | 'usca' | string;

export interface Persona {
  offer?: string;
  solves?: string;
  titles?: string;
}

export interface DiscoveryInput {
  supplier: string;        // e.g., stretchandshrink.com
  region?: Region;         // "us" | "ca" | "usca"
  radiusMi?: number;
  persona?: Persona;
}

export interface Lead {
  host: string;
  title: string;
  temperature: 'hot' | 'warm';
  whyText: string;
  why: any;
  created?: string;
  region?: 'us' | 'ca';
}

export interface DiscoveryResult {
  ok: boolean;
  created: number;
  candidates: Lead[];
}

const HOT_RE = /\b(open|opens|opening|launched?|launches|debut|unveil(ed|s)?|grand opening)\b/i;
const WAREHOUSE_TERMS =
  '(warehouse|distribution center|fulfillment center|cold storage|logistics|3pl)';

// quick & tiny XML helpers (we don’t pull an XML lib to keep image small)
function unescapeHtml(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function between(haystack: string, a: string, b: string) {
  const i = haystack.indexOf(a);
  if (i === -1) return '';
  const j = haystack.indexOf(b, i + a.length);
  if (j === -1) return '';
  return haystack.slice(i + a.length, j);
}

// Try to extract publisher URL from Google News link.
//  - If link has ?url=… use that.
//  - Otherwise, follow redirects once to get final URL (Node 20 has global fetch).
async function extractOutlink(googleLink: string): Promise<string> {
  try {
    const m = googleLink.match(/[?&]url=([^&]+)/i);
    if (m) return decodeURIComponent(m[1]);

    // One lightweight follow (HEAD first to avoid body; fallback to GET).
    try {
      const r = await fetch(googleLink, { method: 'HEAD', redirect: 'follow' });
      if (r.ok && r.url) return r.url;
    } catch {
      /* ignore and try GET */
    }
    const r2 = await fetch(googleLink, { method: 'GET', redirect: 'follow' });
    if (r2.ok && r2.url) return r2.url;
  } catch {
    /* fall through */
  }
  return googleLink;
}

function normalizeHost(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.replace(/^www\./, '');
  } catch {
    return 'news.google.com';
  }
}

function normalizeRegion(r?: Region): 'us' | 'ca' {
  if (r === 'ca') return 'ca';
  return 'us'; // default for "us" or "usca" or anything else
}

function mkWhy(title: string, pub: string) {
  return {
    signal: {
      label: HOT_RE.test(title) ? 'Opening/launch signal' : 'Expansion signal',
      score: HOT_RE.test(title) ? 1 : 0.33,
      detail: title,
    },
    context: {
      label: 'News (RSS)',
      detail: 'news.google.com',
    },
    meta: {
      publisher: pub,
    },
  };
}

function buildQuery(supplier: string, persona?: Persona) {
  // Focus search on warehouse/logistics growth signals near the supplier intent
  const intentBits: string[] = [];
  if (persona?.offer) intentBits.push(persona.offer);
  if (persona?.solves) intentBits.push(persona.solves);
  const intent = intentBits.filter(Boolean).join(' ');

  // Require warehouse-ish terms and opening/expansion language
  const must = `${WAREHOUSE_TERMS} (open|opening|opens|launch|launched|expand|expands)`;
  const siteHint = '-site:' + supplier.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  // Keep it compact — Google News likes clear queries.
  return [must, intent, siteHint].filter(Boolean).join(' ');
}

export default async function discoverFromNews(
  input: DiscoveryInput
): Promise<DiscoveryResult> {
  const region = normalizeRegion(input.region);
  const q = buildQuery(input.supplier, input.persona);

  // US-focused feed (cleanest); we stamp the region ourselves.
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
    q
  )}&hl=en-US&gl=US&ceid=US:en`;

  let xml = '';
  try {
    const r = await fetch(feedUrl);
    xml = await r.text();
  } catch (e) {
    return { ok: false, created: 0, candidates: [] };
  }

  const items: Lead[] = [];
  const chunks = xml.split('<item>').slice(1); // skip header
  for (const chunk of chunks) {
    const titleRaw = between(chunk, '<title>', '</title>');
    const linkRaw = between(chunk, '<link>', '</link>');
    const pubDateRaw = between(chunk, '<pubDate>', '</pubDate>');
    const sourceTitle = between(chunk, '<source', '</source>'); // publisher name tag

    const title = unescapeHtml(titleRaw.trim());
    const googleLink = unescapeHtml(linkRaw.trim());

    if (!title || !googleLink) continue;

    const outlink = await extractOutlink(googleLink);
    const host = normalizeHost(outlink);

    const temperature: 'hot' | 'warm' = HOT_RE.test(title) ? 'hot' : 'warm';

    const why = mkWhy(title, unescapeHtml(sourceTitle.replace(/^.*>/, '').trim()));
    const whyText = `${title}${
      pubDateRaw ? ` (${new Date(unescapeHtml(pubDateRaw)).toDateString()})` : ''
    }`;

    items.push({
      host,
      title,
      temperature,
      whyText,
      why,
      created: new Date().toISOString(),
      region,
    });
  }

  // Lightweight de-duplication by host+title to keep store clean.
  const seen = new Set<string>();
  const candidates = items.filter((it) => {
    const key = `${it.host}::${it.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: true, created: candidates.length, candidates };
}
