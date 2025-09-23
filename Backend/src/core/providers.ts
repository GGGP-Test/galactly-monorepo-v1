// src/core/providers.ts
// Minimal "provider engine" that buyers.ts uses.
// No external APIs. Deterministic, fast, and safe for demos.
//
// Exports:
//   - listProviders(): string[]
//   - findBuyerLead(host, region, radius): Promise<LeadItem>
//   - runProviders({host, region, radius}, topK): Promise<LeadItem[]>

export type Temp = "hot" | "warm" | "cold";

export type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;     // ISO
  temp?: Temp | string;
  whyText?: string;
  score?: number;       // 0..1 demo score
};

/* ------------------------------- utils ------------------------------- */

function nowISO() {
  return new Date().toISOString();
}

function normalizeHost(raw: string): string {
  const h = String(raw || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return h.replace(/^www\./, "");
}

// Tiny deterministic PRNG so the same host yields stable output.
function seedFrom(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}
function rand01(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    // scale to 0..1
    return (s >>> 0) / 0xffffffff;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/* -------------------------- demo scoring ----------------------------- */

function scoreFor(host: string, region: string, radius: string): { score: number; temp: Temp; whyText: string; title: string } {
  const base = host.includes("pack") || host.includes("wrap") || host.includes("film") ? 0.25 : 0.05;
  const s = seedFrom(host + "::" + region + "::" + radius);
  const r = rand01(s);
  // add a few keyword bumps
  const bumps = ["warehouse","fulfill","logistic","distrib","supply","pallet","ship"];
  let bump = 0;
  for (const b of bumps) if (host.includes(b)) bump += 0.05;

  // deterministic jitter
  const jitter = (r() * 0.4);
  const score = Math.max(0, Math.min(1, base + bump + jitter));

  let temp: Temp = "warm";
  if (score >= 0.7) temp = "hot";
  else if (score < 0.4) temp = "cold";

  const titles = [
    "Purchasing Manager",
    "Warehouse Operations",
    "Supply Chain Lead",
    "Plant Manager",
    "Materials Manager",
    "Logistics Coordinator"
  ];
  const title = `${pick(r, titles)} @ ${host}`;

  const whyText =
    temp === "hot"
      ? "Strong buying signals in your region (time-sensitive)."
      : temp === "warm"
        ? "Operational fit detected; likely periodic packaging needs."
        : "Weak signals; might still be relevant for outreach.";

  return { score, temp, whyText, title };
}

/* --------------------------- providers ------------------------------- */

type ProviderCtx = { host: string; region: string; radius: string };

type Provider = (ctx: ProviderCtx) => Promise<LeadItem[]>;

const shimProvider: Provider = async ({ host, region, radius }) => {
  // Deterministic single-item output for now (keeps “one-per-click” UX sane).
  const h = normalizeHost(host);
  const { score, temp, whyText, title } = scoreFor(h, region, radius);

  const item: LeadItem = {
    host: h,
    platform: "web",
    title,
    created: nowISO(),
    temp,
    whyText,
    score: Number(score.toFixed(3)),
  };
  return [item];
};

// Registry (easy to add real ones later without touching routes)
const REGISTRY: Record<string, Provider> = {
  shim: shimProvider,
  // rss: rssProvider,         // (future)
  // gnews: googleNewsProvider // (future)
};

/* -------------------------- public API -------------------------------- */

export function listProviders(): string[] {
  return Object.keys(REGISTRY);
}

/**
 * Return exactly one lead (best of available providers).
 * Today: uses shim only; future: merge+rank across providers.
 */
export async function findBuyerLead(host: string, region: string, radius: string): Promise<LeadItem> {
  const ctx = { host, region, radius };
  const all: LeadItem[] = [];
  for (const name of Object.keys(REGISTRY)) {
    try {
      const out = await REGISTRY[name](ctx);
      if (Array.isArray(out)) all.push(...out);
    } catch {
      // keep going; other providers may succeed
    }
  }
  // pick best by score, then hot > warm > cold
  const ranked = all
    .map(x => ({ ...x, _s: typeof x.score === "number" ? x.score : 0 }))
    .sort((a, b) => (b._s - a._s) || rankTemp(b.temp) - rankTemp(a.temp));
  return (ranked[0] ?? shimProvider(ctx).then(arr => arr[0]));
}

function rankTemp(t: any): number {
  if (t === "hot") return 2;
  if (t === "warm") return 1;
  return 0;
}

/**
 * Return up to topK leads (de-duplicated, stable per host).
 * For now we just repeat the best single candidate (one provider),
 * but the signature is stable for future multi-source merge.
 */
export async function runProviders(ctx: ProviderCtx, topK = 1): Promise<LeadItem[]> {
  const one = await findBuyerLead(ctx.host, ctx.region, ctx.radius);
  const k = Math.max(1, Math.min(3, Number(topK) || 1));
  // If we only have one item, just return it; later, other providers will fill more.
  return [one].slice(0, k);
}