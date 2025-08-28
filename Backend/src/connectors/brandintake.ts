// very light, safe fetch using Node 20 global fetch
const CANDIDATE_PATHS = [
  'supplier','suppliers','vendors','vendor','procurement','sourcing','partner','partners',
  'become-a-supplier','vendor-registration','supplier-registration','rfq','rfi','request-for-quote'
];

const TOKENS_ANY = [
  'become a supplier','vendor registration','supplier registration','procurement','sourcing','rfq','rfi'
];
const TOKENS_PACKAGING = [
  'packaging','corrugated','carton','cartons','labels','pouch','mailers','rsc','case pack'
];

type Brand = { id: number; domain: string };

async function tryFetch(url: string): Promise<string|null> {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'GalactlyBot/0.1 (+https://galactly.dev)' } });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type')||'').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    return html.slice(0, 250_000); // cap
  } catch { return null; }
}

function hasAny(hay: string, needles: string[]) {
  const h = hay.toLowerCase();
  return needles.some(t => h.includes(t));
}

export type IntakeHit = { url: string; title?: string; snippet?: string };

export async function scanBrandIntake(domain: string): Promise<IntakeHit[]> {
  const hits: IntakeHit[] = [];
  const base = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  for (const p of CANDIDATE_PATHS) {
    const u = `https://${base}/${p}`;
    const html = await tryFetch(u);
    if (!html) continue;
    if (hasAny(html, TOKENS_ANY) && hasAny(html, TOKENS_PACKAGING)) {
      // crude title/snippet
      const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = m?.[1]?.trim();
      const snippet = html.replace(/\s+/g,' ').slice(0, 260);
      hits.push({ url: u, title, snippet });
    }
  }
  return hits;
}
