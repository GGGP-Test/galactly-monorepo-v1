// File: scripts/update-weights.ts (NEW, Node script run in GH Action)
// -------------------------------------------------
/**
* Lightweight daily weights updater.
* Reads recent events/leads, computes platform success rates, and updates model_state.global.
* Run with: node scripts/update-weights.js (after tsc) or tsx scripts/update-weights.ts
*/
import { pool, q } from '../backend/src/db.ts';


function norm(x: number, min: number, max: number, fallback=0.5){
if (!Number.isFinite(x)) return fallback;
if (max<=min) return fallback;
const v=(x-min)/(max-min); return Math.max(0, Math.min(1, v));
}


async function main(){
// success = lead owned within last 7d; compute per-platform success rate
const rows = (await q<any>(
`WITH recent AS (
SELECT l.id, l.platform, l.created_at
FROM lead_pool l
WHERE l.created_at > now() - interval '7 days')
, outcome AS (
SELECT lead_id, 1 AS owned FROM event_log WHERE event_type='own' AND created_at > now() - interval '7 days'
)
SELECT r.platform, COUNT(*) AS n, COALESCE(SUM(o.owned),0) AS wins
FROM recent r LEFT JOIN outcome o ON o.lead_id=r.id
GROUP BY r.platform`
)).rows;


// build platform weights 0..1 based on success rate
let minR = Infinity, maxR = -Infinity; const rates: Record<string, number> = {};
for (const r of rows){
const rate = (Number(r.wins)||0) / Math.max(1, Number(r.n)||0);
rates[(r.platform||'').toLowerCase()] = rate;
if (rate<minR) minR=rate; if (rate>maxR) maxR=rate;
}
const platforms: Record<string, number> = {};
for (const [k,v] of Object.entries(rates)) platforms[k] = norm(v, minR, maxR, 0.5);


// modest coeffs, keep recency/userFit strong; platform/intent moderate
const weights = {
coeffs: { recency: 0.5, platform: 0.8, domain: 0.4, intent: 0.6, histCtr: 0.3, userFit: 1.0 },
platforms,
badDomains: []
};


await q('UPDATE model_state SET weights=$1, updated_at=now() WHERE segment=\'global\'', [weights]);
console.log('Updated weights:', JSON.stringify(weights));
}


main().then(()=> pool.end()).catch(e=>{ console.error(e); pool.end(1 as any); });
