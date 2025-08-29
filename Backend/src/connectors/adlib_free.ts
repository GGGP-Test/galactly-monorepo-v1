// Lightweight "advertiser" finder that works without paid APIs.
// For now it just normalizes any seed domains we pass (buyers/examples)
// so the rest of the pipeline can run brandintake + PDP on them.

export type AdCandidate = {
  domain: string;
  source: 'seed';
  proofUrl?: string | null;
  adCount?: number | null;
  lastSeen?: string | null;
};

function normDomain(s?: string): string | null {
  if (!s) return null;
  try {
    let d = s.trim();
    d = d.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (!d || !d.includes('.')) return null;
    return d;
  } catch { return null; }
}

export async function findAdvertisersFree(opts: {
  seeds?: string[];
  industries?: string[];
  regions?: string[];
}): Promise<AdCandidate[]> {
  const out: AdCandidate[] = [];
  const uniq = new Set<string>();
  for (const raw of opts.seeds || []) {
    const d = normDomain(raw);
    if (!d || uniq.has(d)) continue;
    uniq.add(d);
    out.push({ domain: d, source: 'seed', proofUrl: null, adCount: null, lastSeen: null });
  }
  return out;
}
