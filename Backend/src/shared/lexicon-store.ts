// src/shared/lexicon-store.ts
//
// Persistent store for "learned" discovery tokens.
// - Buckets: tags, cities, providers
// - Sanitizes inputs, dedupes, caps growth
// - Writes rolling JSON to disk (safe write)
// - Exposes helpers to blend learned tokens into query sets
//
// Zero external deps. CJS/ESM safe.

import fs from "fs";
import path from "path";

type Bucket = "tags" | "cities" | "providers";

type Entry = {
  value: string;
  count: number;
  lastISO: string;
};

type State = {
  tags: Record<string, Entry>;
  cities: Record<string, Entry>;
  providers: Record<string, Entry>;
  // housekeeping
  updatedISO: string;
};

type LearnPayload = {
  source?: string;                // e.g., "leads-web:auto"
  hostSeed?: string;              // acme.com
  band?: "HOT" | "WARM" | "COOL";
  plan?: "free" | "pro" | "enterprise";
  learned?: { tags?: string[]; cities?: string[]; providers?: string[] };
  sample?: Array<{ host?: string; city?: string | null; tags?: string[] }>;
};

const NOW = () => new Date().toISOString();

// ---------------------------- config ---------------------------------

const DATA_DIR =
  process.env.LEXICON_DATA_DIR ||
  process.env.DATA_DIR ||
  path.join(process.cwd(), "data");

const LEARN_DIR = path.join(DATA_DIR, "lexicon-learn");

// hard caps to keep memory/disk sane
const CAP_PER_BUCKET = 500;      // max distinct items per bucket
const CAP_TOP_FOR_BLEND = 60;    // how many we expose when blending
const MIN_LEN = 2;               // shortest token kept after clean
const MAX_LEN = 40;              // longest token kept after clean

// --------------------------- in-memory --------------------------------

const STATE: State = {
  tags: Object.create(null),
  cities: Object.create(null),
  providers: Object.create(null),
  updatedISO: NOW(),
};

// --------------------------- helpers ----------------------------------

function ensureDir(p: string) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function safeWriteJSON(fullPath: string, obj: any) {
  try {
    const tmp = fullPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    fs.renameSync(tmp, fullPath);
  } catch { /* ignore */ }
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

const BAD_SUBSTR = ["http", "www.", ".com", ".net", ".org", "@", "<", ">", "{", "}"];

function cleanToken(raw?: string): string | null {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^\w\s\-/&.]/g, " ")      // basic safe characters
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length < MIN_LEN || s.length > MAX_LEN) return null;
  for (const bad of BAD_SUBSTR) if (s.includes(bad)) return null;
  // collapse simple plurals (very light touch)
  const base = s.endsWith("s") && s.length > 3 ? s.slice(0, -1) : s;
  return base;
}

function upsert(bucket: Bucket, token: string, n = 1) {
  const bag = STATE[bucket] as Record<string, Entry>;
  const cur = bag[token];
  if (cur) {
    cur.count += n;
    cur.lastISO = NOW();
  } else {
    // enforce cap by evicting lowest-count items if needed
    if (Object.keys(bag).length >= CAP_PER_BUCKET) {
      const worst = Object.entries(bag).sort((a, b) => a[1].count - b[1].count)[0];
      if (worst) delete bag[worst[0]];
    }
    bag[token] = { value: token, count: n, lastISO: NOW() };
  }
  STATE.updatedISO = NOW();
}

function topValues(bucket: Bucket, maxN = CAP_TOP_FOR_BLEND): string[] {
  const bag = STATE[bucket] as Record<string, Entry>;
  return Object.values(bag)
    .sort((a, b) => (b.count - a.count) || (b.lastISO.localeCompare(a.lastISO)))
    .slice(0, Math.max(0, maxN))
    .map(e => e.value);
}

// ---------------------------- public API --------------------------------

/**
 * Record a learning payload. Returns how many tokens were added/updated.
 */
export function recordLearn(payload: LearnPayload): {
  ok: true; updated: number; snapshot: { tags: number; cities: number; providers: number };
} {
  const got = payload?.learned || {};
  const tags = Array.isArray(got.tags) ? got.tags : [];
  const cities = Array.isArray(got.cities) ? got.cities : [];
  const providers = Array.isArray(got.providers) ? got.providers : [];

  let updated = 0;
  const uniq = <T extends string>(arr: string[]) => Array.from(new Set(arr.map((t) => cleanToken(t) || "").filter(Boolean))) as T[];

  const ctTags = uniq(tags);
  const ctCities = uniq(cities);
  const ctProviders = uniq(providers);

  for (const t of ctTags) { upsert("tags", t); updated++; }
  for (const c of ctCities) { upsert("cities", c); updated++; }
  for (const p of ctProviders) { upsert("providers", p); updated++; }

  // persist daily and roll snapshot
  persistDaily(payload, { tags: ctTags, cities: ctCities, providers: ctProviders });
  persistState();

  return {
    ok: true,
    updated,
    snapshot: {
      tags: Object.keys(STATE.tags).length,
      cities: Object.keys(STATE.cities).length,
      providers: Object.keys(STATE.providers).length,
    },
  };
}

/**
 * Blend learned tokens into a base query list (dedup, capped).
 * Use weights to control how many from each bucket.
 */
export function blendQueries(base: string[], opts?: {
  tags?: number; cities?: number; providers?: number; cap?: number;
}): string[] {
  const cap = Math.max(1, Number(opts?.cap ?? 80));
  const wantTags = Math.max(0, Math.min(cap, Number(opts?.tags ?? 20)));
  const wantCities = Math.max(0, Math.min(cap, Number(opts?.cities ?? 8)));
  const wantProviders = Math.max(0, Math.min(cap, Number(opts?.providers ?? 6)));

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (s?: string) => {
    const v = (s || "").trim().toLowerCase();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  for (const b of base) push(b);

  for (const t of topValues("tags", wantTags)) push(t);
  for (const c of topValues("cities", wantCities)) push(c);
  for (const p of topValues("providers", wantProviders)) push(p);

  return out.slice(0, cap);
}

/**
 * Small summary for admin/debug.
 */
export function summarize(): {
  updatedISO: string;
  counts: { tags: number; cities: number; providers: number };
  top: { tags: string[]; cities: string[]; providers: string[] };
} {
  return {
    updatedISO: STATE.updatedISO,
    counts: {
      tags: Object.keys(STATE.tags).length,
      cities: Object.keys(STATE.cities).length,
      providers: Object.keys(STATE.providers).length,
    },
    top: {
      tags: topValues("tags", 10),
      cities: topValues("cities", 6),
      providers: topValues("providers", 6),
    },
  };
}

/**
 * Load snapshot from disk (call once on boot).
 */
export function loadFromDisk(): void {
  try {
    ensureDir(LEARN_DIR);
    const snap = path.join(LEARN_DIR, "state.json");
    if (fs.existsSync(snap)) {
      const txt = fs.readFileSync(snap, "utf8");
      const obj = JSON.parse(txt) as State;
      if (obj && obj.tags && obj.cities && obj.providers) {
        // shallow trust; keep caps
        for (const [k, e] of Object.entries(obj.tags || {})) if (k && e) STATE.tags[k] = e as Entry;
        for (const [k, e] of Object.entries(obj.cities || {})) if (k && e) STATE.cities[k] = e as Entry;
        for (const [k, e] of Object.entries(obj.providers || {})) if (k && e) STATE.providers[k] = e as Entry;
        STATE.updatedISO = obj.updatedISO || NOW();
      }
    }
  } catch { /* ignore */ }
}

/**
 * Clear everything (tests/ops).
 */
export function clearAll(): void {
  STATE.tags = Object.create(null);
  STATE.cities = Object.create(null);
  STATE.providers = Object.create(null);
  STATE.updatedISO = NOW();
  persistState();
}

// --------------------------- persistence --------------------------------

function persistDaily(payload: LearnPayload, cleaned: { tags: string[]; cities: string[]; providers: string[] }) {
  try {
    ensureDir(LEARN_DIR);
    const file = path.join(LEARN_DIR, `${dayKey()}.jsonl`);
    const line = JSON.stringify({
      at: NOW(),
      source: payload?.source || "",
      hostSeed: payload?.hostSeed || "",
      band: payload?.band || "",
      plan: payload?.plan || "",
      learned: cleaned,
    });
    fs.appendFileSync(file, line + "\n", "utf8");
  } catch { /* ignore */ }
}

function persistState() {
  try {
    ensureDir(LEARN_DIR);
    const snap = path.join(LEARN_DIR, "state.json");
    safeWriteJSON(snap, STATE);
  } catch { /* ignore */ }
}

// auto-load once on import
try { loadFromDisk(); } catch { /* ignore */ }

export default {
  recordLearn,
  blendQueries,
  summarize,
  loadFromDisk,
  clearAll,
};