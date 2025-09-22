// src/middleware/fomo.ts
// Live “watching” + lifetime “seen” counters per lead fingerprint, TTL-based.
// Cheap, in-memory; later swap to Redis with the exact same API.

type Bucket = { watching:Set<string>; seen:number; updated:number };
const ttlMs = (Number(process.env.FOMO_TTL_SEC || "600"))*1000; // default 10m
const buckets = new Map<string, Bucket>();

function now(){ return Date.now(); }
function clean(){
  const t = now();
  for (const [k,b] of buckets){
    if (t - b.updated > ttlMs) buckets.delete(k);
  }
}

export function noteView(leadKey:string, viewerKey:string){
  clean();
  const b = buckets.get(leadKey) || { watching:new Set<string>(), seen:0, updated: now() };
  b.updated = now();
  if (!b.watching.has(viewerKey)){ b.seen += 1; b.watching.add(viewerKey); }
  buckets.set(leadKey, b);
}

export function snapshot(leadKey:string){
  clean();
  const b = buckets.get(leadKey);
  return {
    watching: b ? b.watching.size : 0,
    seenTotal: b ? b.seen : 0
  };
}