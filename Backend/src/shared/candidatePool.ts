// src/shared/candidatePool.ts
// Curated seeds + mirrored hosts (from Actions) + denylist.

type Entry = { host: string; seenAt: number; source: string };

const deny = new Set<string>([
  'walmart.com','amazon.com','apple.com','microsoft.com','google.com','meta.com',
  'tesla.com','netflix.com','oracle.com','adobe.com','ibm.com','salesforce.com'
]);

const SEEDS_USCA = [
  'pepsico.com','coca-cola.com','nestle.com','unilever.com','kraftheinzcompany.com','pg.com',
  'kimberly-clark.com','colgatepalmolive.com','clorox.com','churchdwight.com',
  'generalmills.com','kellanova.com','conagra.com','mondelezinternational.com',
  'loreal.com','estee-lauder.com','jnj.com','abbott.com',
  'hanes.com','carhartt.com','patagonia.com','underarmour.com',
  'chewy.com','wayfair.com','staples.com','officedepot.com',
  'heb.com','albertsons.com','kroger.com','publix.com','aldi.us','meijer.com',
  'ulta.com','sephora.com',
  'dollargeneral.com','dollartree.com','fivebelow.com',
  'harborfreight.com','autozone.com','oreillyauto.com',
  'petco.com','petsmart.com',
  'kehe.com','unfi.com',
  'costco.com','target.com','lowes.com','homedepot.com','bestbuy.com'
].filter(h => !deny.has(h));

const mirrored = new Map<string, Entry>();

export function addMirroredHosts(hosts: string[], source: string) {
  const now = Date.now();
  for (const raw of hosts) {
    const h = (raw || '').toLowerCase()
      .replace(/^https?:\/\//,'').replace(/\/.*/,'').replace(/^www\./,'');
    if (!h || !h.includes('.') || deny.has(h)) continue;
    mirrored.set(h, { host: h, seenAt: now, source });
  }
}

export function listCandidates(region: string, max = 64): string[] {
  const fresh = Array.from(mirrored.values())
    .sort((a,b) => b.seenAt - a.seenAt)
    .map(e => e.host);
  const out: string[] = [];
  const push = (h: string) => { if (!out.includes(h) && !deny.has(h)) out.push(h); };
  for (const h of fresh) push(h);
  for (const h of SEEDS_USCA) push(h);
  return out.slice(0, max);
}