// File: Backend/src/scoring.ts
// -------------------------------------------------
export type Weights = {
coeffs: { recency: number; platform: number; domain: number; intent: number; histCtr: number; userFit: number };
platforms: Record<string, number>;
badDomains: string[];
};


export type LeadRow = {
id: number; platform: string | null; source_url: string; title: string | null; snippet: string | null;
created_at?: string | null; cat?: string | null; kw?: string[] | null;
};


export type UserPrefs = { muteDomains?: string[]; boostKeywords?: string[]; preferredCats?: string[] };


export function domainFromUrl(u: string): string { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }


function recencyScore(createdAtIso?: string | null): number {
if (!createdAtIso) return 0; const ageMin = (Date.now()-new Date(createdAtIso).getTime())/60000;
if (ageMin <= 0) return 1; const s = Math.max(0, 1 - ageMin/240); return Number.isFinite(s)?s:0;
}


function intentScore(title?: string | null, snippet?: string | null, intents?: string[]): number {
const keys = intents && intents.length ? intents : (process.env.INTENT_KEYWORDS || 'need,looking for,rfp,rfq,quote,recommend,supplier,who can supply,sourcing').split(',').map(s=>s.trim().toLowerCase());
const text = `${title||''} ${snippet||''}`.toLowerCase();
return keys.reduce((acc, k) => acc + (text.includes(k)?1:0), 0);
}


function platformWeight(w: Weights, platform?: string | null): number { const p=(platform||'').toLowerCase(); return p? (w.platforms[p] ?? 0.8) : 0.5; }
function domainQuality(w: Weights, url: string): number { const host=domainFromUrl(url); if(!host) return 0; if (w.badDomains?.some(b=>host.endsWith(b))) return -1; return 0.5; }
function userFitScore(lead: LeadRow, prefs?: UserPrefs){ const p=prefs||{}; const host=domainFromUrl(lead.source_url); if (p.muteDomains?.some(d=>host.endsWith(d))) return {score:-999, muted:true}; let s=0; if(p.preferredCats&&lead.cat&&p.preferredCats.includes(lead.cat)) s+=1; if(p.boostKeywords&&lead.kw){ for(const k of lead.kw) if(p.boostKeywords.includes(k)){ s+=1; break; } } return {score:s, muted:false}; }


export function computeScore(lead: LeadRow, w: Weights, prefs?: UserPrefs): number {
const r=recencyScore(lead.created_at), pf=platformWeight(w, lead.platform), dm=domainQuality(w, lead.source_url), inx=intentScore(lead.title, lead.snippet), hist=0, uf=userFitScore(lead, prefs);
if (uf.muted) return -1e9; const c=w?.coeffs||{recency:0.4,platform:1.0,domain:0.5,intent:0.6,histCtr:0.3,userFit:1.0};
return c.recency*r + c.platform*pf + c.domain*dm + c.intent*inx + c.histCtr*hist + c.userFit*uf.score;
}
