export function intentScore(title?: string|null, snippet?: string|null){
const keys = (process.env.INTENT_KEYWORDS||'need,looking for,rfq,rfp,quote').split(',').map(s=>s.trim().toLowerCase());
const t = `${title||''} ${snippet||''}`.toLowerCase();
return keys.reduce((n,k)=>n + (t.includes(k)?1:0), 0);
}
