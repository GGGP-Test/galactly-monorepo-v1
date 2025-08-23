import type { Request } from 'express';
function platformWeight(w: Weights, platform?: string | null): number {
const p = (platform || '').toLowerCase();
if (!p) return 0.5; // neutral
return w.platforms[p] ?? 0.8; // default neutral-slight
}


function domainQuality(w: Weights, url: string): number {
const host = domainFromUrl(url);
if (!host) return 0;
if (w.badDomains?.some(b => host.endsWith(b))) return -1; // penalize bad domains hard
return 0.5; // neutral baseline, we can grow this later
}


function userFitScore(lead: LeadRow, prefs: UserPrefs | undefined): { score: number; muted: boolean } {
const p = prefs || {};
const host = domainFromUrl(lead.source_url);
if (p.muteDomains?.some(d => host.endsWith(d))) return { score: -999, muted: true };
let s = 0;
if (p.preferredCats && lead.cat && p.preferredCats.includes(lead.cat)) s += 1;
if (p.boostKeywords && lead.kw) {
for (const k of lead.kw) if (p.boostKeywords.includes(k)) { s += 1; break; }
}
return { score: s, muted: false };
}


export function computeScore(lead: LeadRow, w: Weights, prefs?: UserPrefs): number {
const r = recencyScore(lead.created_at);
const pf = platformWeight(w, lead.platform);
const dm = domainQuality(w, lead.source_url);
const inx = intentScore(lead.title, lead.snippet);
const hist = 0; // placeholder for future CTR-based boost
const uf = userFitScore(lead, prefs);
if (uf.muted) return -1e9; // effectively hide
const c = w?.coeffs || DEFAULT_WEIGHTS.coeffs;
return c.recency*r + c.platform*pf + c.domain*dm + c.intent*inx + c.histCtr*hist + c.userFit*uf.score;
}
