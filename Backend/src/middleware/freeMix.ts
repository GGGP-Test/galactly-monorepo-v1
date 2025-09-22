// src/middleware/freeMix.ts
// Free daily allocation (mix) + simple counters (in-memory, per apiKey, per day).
// For your current plan: Free = warm only, 3/day. Pro can ignore this.

export type Temp = "hot" | "warm";
export type Mix = { hot: number; warm: number };

const DEFAULT_MIX: Mix = { hot: 0, warm: 3 }; // Free: warm only
const store = new Map<string, { hot: number; warm: number; day: string }>();

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function k(apiKey: string){ return `${apiKey||"anon"}|${today()}`; }

function get(apiKey: string){
  const id = k(apiKey);
  const v = store.get(id);
  if (v && v.day === today()) return v;
  const fresh = { hot:0, warm:0, day: today() };
  store.set(id, fresh);
  return fresh;
}

export function remaining(apiKey: string, mix: Mix=DEFAULT_MIX){
  const c = get(apiKey);
  const used = c.hot + c.warm;
  const limit = mix.hot + mix.warm;
  return {
    hot: Math.max(0, mix.hot - c.hot),
    warm: Math.max(0, mix.warm - c.warm),
    total: Math.max(0, limit - used),
    limit, used
  };
}

export function record(apiKey: string, temp: Temp){
  const c = get(apiKey);
  if (temp === "hot") c.hot += 1; else c.warm += 1;
}

export function decideNext(apiKey: string, availability:{hot:boolean; warm:boolean}, mix:Mix=DEFAULT_MIX): Temp|null{
  const c = get(apiKey);
  if (mix.hot > 0 && c.hot < mix.hot && availability.hot) return "hot";
  if (c.warm < mix.warm && availability.warm) return "warm";
  if (availability.warm && c.warm < mix.warm) return "warm";
  if (availability.hot && c.hot < mix.hot) return "hot";
  return null;
}

export function quotaView(apiKey: string, mix: Mix=DEFAULT_MIX){
  const r = remaining(apiKey, mix);
  const end = new Date(); end.setHours(23,59,59,999);
  return {
    used: r.used, limit: r.limit, windowEndsAt: end.toISOString(),
    mix: { hot:{used: get(apiKey).hot, limit: mix.hot}, warm:{used:get(apiKey).warm, limit: mix.warm} }
  };
}