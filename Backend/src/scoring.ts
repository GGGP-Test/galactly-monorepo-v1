export type Weights = {
  coeffs: { recency: number; platform: number; domain: number; intent: number; histCtr: number; userFit: number };
  platforms: Record<string, number>;
  badDomains: string[];
};

export type LeadRow = {
  id: number; platform: string | null; source_url: string; title: string | null; snippet: string | null;
  created_at?: string | null; cat?: string | null; kw?: string[] | null; fit_user?: number | null;
};

export type UserPrefs = { muteDomains?: string[]; boostKeywords?: string[]; preferredCats?: string[]; confirmedProofs?: { host: string; platform?: string; ts?: string }[] };

export function domainFromUrl(u: string): string { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }

function recencyScore(createdAtIso?: string | null): number {
  if (!createdAtIso) return 0; const ageMin = (Date.now() - new Date(createdAtIso).getTime()) / 60000;
  if (ageMin <= 0) return 1; const s = Math.max(0, 1 - ageMin / 240); return Number.isFinite(s) ? s : 0;
}

function intentScore(title?: string | null, snippet?: string | null, intents?: string[]): number {
  const keys = intents && intents.length ? intents : (process.env.INTENT_KEYWORDS || 'need,looking for,rfp,rfq,quote,recommend,supplier,who can supply,sourcing,packaging,carton,label,shrink,film,void fill,pallet').split(',').map(s => s.trim().toLowerCase());
  const text = `${title || ''} ${snippet || ''}`.toLowerCase();
  return keys.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);
}

function platformWeight(w: Weights, platform?: string | null): number { const p = (platform || '').toLowerCase(); return p ? (w.platforms[p] ?? 0.8) : 0.5; }
function domainQuality(w: Weights, url: string): number { const host = domainFromUrl(url); if (!host) return 0; if (w.badDomains?.some(b => host.endsWith(b))) return -1; return 0.5; }
function userFitScore(lead: LeadRow, prefs?: UserPrefs) {
  const p = prefs || {}; const host = domainFromUrl(lead.source_url);
  if (p.muteDomains?.some(d => host.endsWith(d))) return { score: -999, muted: true };
  let s = 0; if (p.preferredCats && lead.cat && p.preferredCats.includes(lead.cat)) s += 1;
  if (p.boostKeywords && lead.kw) { for (const k of lead.kw) if (p.boostKeywords.includes(k)) { s += 1; break; } }
  if (typeof lead.fit_user === 'number') s += lead.fit_user / 100;  // small nudge from per-user feedback
  return { score: s, muted: false };
}

export function confirmBoostFor(url: string, prefs?: UserPrefs): number {
  if (!prefs?.confirmedProofs?.length) return 0;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const has = prefs.confirmedProofs.some(r => typeof r?.host === 'string' && host.endsWith(r.host.toLowerCase()));
    return has ? 0.25 : 0; // tune: +0.25 to overall score
  } catch { return 0; }
}

export function computeScore(lead: LeadRow, w: Weights, prefs?: UserPrefs): number {
  const r = recencyScore(lead.created_at), pf = platformWeight(w, lead.platform), dm = domainQuality(w, lead.source_url), inx = intentScore(lead.title, lead.snippet), hist = 0, uf = userFitScore(lead, prefs);
  if (uf.muted) return -1e9; const c = w?.coeffs || { recency: 0.4, platform: 1.0, domain: 0.5, intent: 0.6, histCtr: 0.3, userFit: 1.0 };
  return c.recency * r + c.platform * pf + c.domain * dm + c.intent * inx + c.histCtr * hist + c.userFit * uf.score + confirmBoostFor(lead.source_url, prefs);
}

export function interleaveByPlatform(leads: LeadRow[]): LeadRow[] {
  // avoid long runs of the same platform in UI
  const buckets = new Map<string, LeadRow[]>();
  for (const L of leads) {
    const key = (L.platform || 'other').toLowerCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(L);
  }
  // round‑robin
  const keys = Array.from(buckets.keys());
  const out: LeadRow[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const k of keys) {
      const b = buckets.get(k)!;
      if (b.length) { out.push(b.shift()!); added = true; }
    }
  }
  return out;
}
