// src/ai/core/feature-flags.ts

/**
 * Feature Flags
 * -------------
 * Lightweight, dependency-free flags & remote config with:
 *  - plan/user/org/environment targeting
 *  - % rollouts (deterministic hashing)
 *  - JSON overrides via FEATURE_FLAGS_PATH
 *  - env var overrides (FLAG__<DOT_REPLACED_WITH_DOUBLE_UNDERSCORE>=value)
 *
 * Examples:
 *   const enabled = isEnabled("llm.gemini.free", ctx)
 *   const depth = getVar<number>("crawler.depth", ctx) // variant per plan
 */

export type PlanTier = "free" | "pro" | "scale";
export type Env = "dev" | "staging" | "prod";

export interface FeatureContext {
  userId?: string;
  orgId?: string;
  plan?: PlanTier;
  country?: string; // ISO2
  env?: Env;
  attrs?: Record<string, any>;
}

type Primitive = string | number | boolean | null;
export type Variant = Primitive | Record<string, any> | Array<any>;

export interface AudienceRule {
  planIn?: PlanTier[];
  envIn?: Env[];
  orgIdIn?: string[];
  userIdIn?: string[];
  countryIn?: string[]; // ISO2
  percentage?: number; // 0..100 (deterministic on userId||orgId)
  where?: Condition;   // extra predicate on ctx.attrs
  value?: Variant;     // optional override value when rule matches
}

export interface FlagDefinition {
  key: string;
  description?: string;
  default: Variant;
  rules?: AudienceRule[];
}

export interface Condition {
  all?: Condition[];
  any?: Condition[];
  none?: Condition[];
  op?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "contains" | "exists";
  path?: string; // e.g. attrs.company.size
  value?: any;
}

// ---------------- internals ----------------

const DEFAULT_ENV: Env =
  (process.env.NODE_ENV === "production" ? "prod" : process.env.NODE_ENV === "staging" ? "staging" : "dev");

function djb2(str: string) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = (hash * 33) ^ str.charCodeAt(i);
  return (hash >>> 0); // uint32
}

function inPercent(id: string | undefined, pct: number): boolean {
  if (!id) return false;
  const h = djb2(id) % 10000;
  return h < Math.floor(pct * 100);
}

function getPath(obj: any, path?: string) {
  if (!path) return undefined;
  return path.split(".").reduce((acc: any, k) => (acc == null ? undefined : acc[k]), obj);
}

function evalCondition(cond: Condition | undefined, ctx: FeatureContext): boolean {
  if (!cond) return true;
  if (cond.all && cond.all.length) return cond.all.every((c) => evalCondition(c, ctx));
  if (cond.any && cond.any.length) return cond.any.some((c) => evalCondition(c, ctx));
  if (cond.none && cond.none.length) return cond.none.every((c) => !evalCondition(c, ctx));

  const lhs = getPath({ ...ctx, attrs: ctx.attrs ?? {} }, cond.path);
  const rhs = cond.value;

  switch (cond.op) {
    case "exists": return lhs !== undefined && lhs !== null && !(typeof lhs === "number" && Number.isNaN(lhs));
    case "eq": return lhs === rhs;
    case "neq": return lhs !== rhs;
    case "gt": return Number(lhs) > Number(rhs);
    case "gte": return Number(lhs) >= Number(rhs);
    case "lt": return Number(lhs) < Number(rhs);
    case "lte": return Number(lhs) <= Number(rhs);
    case "in": return Array.isArray(rhs) && rhs.includes(lhs);
    case "nin": return Array.isArray(rhs) && !rhs.includes(lhs);
    case "contains":
      if (Array.isArray(lhs)) return lhs.includes(rhs);
      if (typeof lhs === "string") return String(lhs).toLowerCase().includes(String(rhs).toLowerCase());
      return false;
    default:
      return false;
  }
}

let REMOTE: Record<string, FlagDefinition> | null = null;
let LOADED_AT = 0;
const TTL_MS = 60_000;

function tryLoadRemote() {
  if (REMOTE && Date.now() - LOADED_AT < TTL_MS) return;
  const p = process.env.FEATURE_FLAGS_PATH;
  if (!p) { REMOTE = null; LOADED_AT = Date.now(); return; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const json = require(p);
    const map: Record<string, FlagDefinition> = {};
    for (const def of json.flags as FlagDefinition[]) map[def.key] = def;
    REMOTE = map;
  } catch {
    REMOTE = null;
  } finally {
    LOADED_AT = Date.now();
  }
}

function envOverride(key: string): Variant | undefined {
  // FLAG__foo__bar__baz=value  -> flag key "foo.bar.baz"
  const envKey = "FLAG__" + key.replace(/\./g, "__");
  const val = process.env[envKey];
  if (val === undefined) return undefined;
  try {
    if (val === "true") return true;
    if (val === "false") return false;
    const num = Number(val);
    if (!Number.isNaN(num) && /^\d+(\.\d+)?$/.test(val)) return num;
    return JSON.parse(val);
  } catch {
    return val;
  }
}

// ---------------- registry ----------------

/**
 * Default flags: safe, cost-aware defaults
 */
const DEFAULTS: FlagDefinition[] = [
  {
    key: "contacts.vendor.apollo",
    description: "Enable Apollo vendor (costed)",
    default: false,
    rules: [{ planIn: ["pro", "scale"], percentage: 100 }],
  },
  {
    key: "contacts.vendor.clearbit",
    description: "Enable Clearbit enrichment (costed)",
    default: false,
    rules: [{ planIn: ["pro", "scale"], percentage: 100 }],
  },
  {
    key: "contacts.vendor.instantly",
    description: "Enable Instantly prospect search",
    default: false,
    rules: [{ planIn: ["pro", "scale"], percentage: 100 }],
  },
  {
    key: "contacts.vendor.webhook",
    description: "Enable generic webhook vendor (cheap)",
    default: true,
  },
  {
    key: "llm.gemini.free",
    description: "Gemini Nano/Pro for free tier classification/extraction",
    default: true,
  },
  {
    key: "llm.hf.mini",
    description: "HuggingFace small models for tagging",
    default: true,
  },
  {
    key: "llm.openai.paid",
    description: "Use high-end reasoning models for paid",
    default: false,
    rules: [{ planIn: ["pro", "scale"], percentage: 100 }],
  },
  {
    key: "crawler.depth",
    description: "Per-plan crawl depth",
    default: 2,
    rules: [
      { planIn: ["free"], value: 2 },
      { planIn: ["pro"], value: 5 },
      { planIn: ["scale"], value: 8 },
    ],
  },
  {
    key: "crawler.maxPages",
    description: "Max pages per company",
    default: 20,
    rules: [
      { planIn: ["free"], value: 20 },
      { planIn: ["pro"], value: 80 },
      { planIn: ["scale"], value: 200 },
    ],
  },
  {
    key: "learning.enable",
    description: "Enable per-tenant continuous learning",
    default: false,
    rules: [{ planIn: ["pro", "scale"], percentage: 100 }],
  },
  {
    key: "outreach.auto",
    description: "Auto-notify on hot leads",
    default: true,
  },
  {
    key: "ui.debug.explanations",
    description: "Show scorecard explanations in UI",
    default: true,
    rules: [{ envIn: ["prod"], percentage: 20 }, { envIn: ["dev", "staging"], percentage: 100 }],
  },
  {
    key: "router.channel.v2",
    description: "Use Channel Bandit v2",
    default: false,
    rules: [{ envIn: ["dev", "staging"], percentage: 100 }],
  },
];

const DEFAULT_MAP = Object.fromEntries(DEFAULTS.map((f) => [f.key, f]));

// ---------------- API ----------------

function resolveFlagDef(key: string): FlagDefinition | undefined {
  tryLoadRemote();
  return REMOTE?.[key] || DEFAULT_MAP[key];
}

function matchAudience(rule: AudienceRule, ctx: FeatureContext): boolean {
  if (rule.planIn && !rule.planIn.includes((ctx.plan ?? "free") as PlanTier)) return false;
  if (rule.envIn && !rule.envIn.includes((ctx.env ?? DEFAULT_ENV))) return false;
  if (rule.orgIdIn && ctx.orgId && !rule.orgIdIn.includes(ctx.orgId)) return false;
  if (rule.userIdIn && ctx.userId && !rule.userIdIn.includes(ctx.userId)) return false;
  if (rule.countryIn && ctx.country && !rule.countryIn.includes(ctx.country)) return false;
  if (rule.where && !evalCondition(rule.where, ctx)) return false;
  if (typeof rule.percentage === "number") {
    const seed = ctx.userId || ctx.orgId || "global";
    if (!inPercent(seed, rule.percentage)) return false;
  }
  return true;
}

export function getFlag<T extends Variant = Variant>(key: string, ctx: FeatureContext = {}): T {
  const env = envOverride(key);
  if (env !== undefined) return env as T;

  const def = resolveFlagDef(key);
  if (!def) return undefined as unknown as T;

  // first matching rule wins
  const rule = (def.rules || []).find((r) => matchAudience(r, ctx));
  if (rule?.value !== undefined) return rule.value as T;

  return def.default as T;
}

export function isEnabled(key: string, ctx?: FeatureContext): boolean {
  const v = getFlag(key, ctx);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") return ["on", "true", "enabled", "1"].includes(v.toLowerCase());
  return !!v;
}

export function getVariant<T extends Variant = Variant>(key: string, ctx?: FeatureContext): T {
  return getFlag<T>(key, ctx);
}

// Helpers for common flags
export const Flags = {
  apollo: (ctx?: FeatureContext) => isEnabled("contacts.vendor.apollo", ctx),
  clearbit: (ctx?: FeatureContext) => isEnabled("contacts.vendor.clearbit", ctx),
  instantly: (ctx?: FeatureContext) => isEnabled("contacts.vendor.instantly", ctx),
  webhookVendor: (ctx?: FeatureContext) => isEnabled("contacts.vendor.webhook", ctx),
  geminiFree: (ctx?: FeatureContext) => isEnabled("llm.gemini.free", ctx),
  hfMini: (ctx?: FeatureContext) => isEnabled("llm.hf.mini", ctx),
  openaiPaid: (ctx?: FeatureContext) => isEnabled("llm.openai.paid", ctx),
  crawlDepth: (ctx?: FeatureContext) => getVariant<number>("crawler.depth", ctx),
  crawlMaxPages: (ctx?: FeatureContext) => getVariant<number>("crawler.maxPages", ctx),
  learning: (ctx?: FeatureContext) => isEnabled("learning.enable", ctx),
  autoOutreach: (ctx?: FeatureContext) => isEnabled("outreach.auto", ctx),
  uiDebug: (ctx?: FeatureContext) => isEnabled("ui.debug.explanations", ctx),
  routerV2: (ctx?: FeatureContext) => isEnabled("router.channel.v2", ctx),
};
