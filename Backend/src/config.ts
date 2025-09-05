// src/config.ts
/**
 * Centralized config & feature toggles.
 * Reads environment variables once and exposes typed getters.
 */

export type Tier = "free" | "pro";

export interface ProviderKeys {
  openai?: string;
  anthropic?: string; // Claude
  xai?: string;       // Grok
  openrouter?: string;
  hf?: string;        // HuggingFace
  gemini?: string;    // Google AI Studio
  clearbit?: string;
  apollo?: string;
  instantly?: string;
  slack?: string;
  sendgrid?: string;
}

export interface AppConfig {
  env: "dev" | "staging" | "prod";
  region?: string;
  baseUrl?: string;

  providers: ProviderKeys;

  // Model defaults per task
  models: {
    intent: string[];
    enrich: string[];
    channel: string[];
    explain: string[];
    embed: string[];
  };

  // Free vs Pro limits
  limits: {
    free: {
      monthlyLeads: number;
      crawlBytes: number;
      maxCandidates: number;
      aiMonthlyCapUSD: number;
    };
    pro: {
      monthlyLeads: number;
      crawlBytes: number;
      maxCandidates: number;
      aiMonthlyCapUSD: number;
    };
  };

  // Feature flags
  features: {
    contactsOnFree: boolean;
    opalAssist: boolean;
    piiVault: boolean;
    auditWebhook?: string;
  };
}

function env(name: string, def?: string) {
  return process.env[name] || def;
}
function envNum(name: string, def: number) {
  const v = process.env[name];
  return v ? Number(v) : def;
}
function csv(v?: string) {
  return (v || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const config: AppConfig = {
  env: (env("NODE_ENV", "dev") as any),
  region: env("REGION"),
  baseUrl: env("BASE_URL", "http://localhost:3000"),

  providers: {
    openai: env("OPENAI_API_KEY"),
    anthropic: env("ANTHROPIC_API_KEY"),
    xai: env("XAI_API_KEY"),
    openrouter: env("OPENROUTER_API_KEY"),
    hf: env("HF_API_KEY"),
    gemini: env("GEMINI_API_KEY"),
    clearbit: env("CLEARBIT_KEY"),
    apollo: env("APOLLO_API_KEY"),
    instantly: env("INSTANTLY_API_KEY"),
    slack: env("SLACK_BOT_TOKEN"),
    sendgrid: env("SENDGRID_API_KEY"),
  },

  models: {
    intent: csv(env("MODELS_INTENT", "openai:gpt-4o-mini,anthropic:claude-3-haiku,xai:grok-2-mini,openrouter:openrouter/auto")),
    enrich: csv(env("MODELS_ENRICH", "openai:gpt-4o-mini,anthropic:claude-3-haiku")),
    channel: csv(env("MODELS_CHANNEL", "openai:gpt-4o-mini,anthropic:claude-3-haiku")),
    explain: csv(env("MODELS_EXPLAIN", "openai:gpt-4o-mini")),
    embed: csv(env("MODELS_EMBED", "openai:text-embedding-3-small,hf:sentence-transformers/all-MiniLM-L6-v2")),
  },

  limits: {
    free: {
      monthlyLeads: envNum("FREE_MONTHLY_LEADS", 40),
      crawlBytes: envNum("FREE_CRAWL_BYTES", 400_000),
      maxCandidates: envNum("FREE_MAX_CANDIDATES", 10),
      aiMonthlyCapUSD: envNum("FREE_AI_CAP_USD", 5),
    },
    pro: {
      monthlyLeads: envNum("PRO_MONTHLY_LEADS", 2000),
      crawlBytes: envNum("PRO_CRAWL_BYTES", 1_500_000),
      maxCandidates: envNum("PRO_MAX_CANDIDATES", 50),
      aiMonthlyCapUSD: envNum("PRO_AI_CAP_USD", 150),
    },
  },

  features: {
    contactsOnFree: env("FEATURE_CONTACTS_FREE", "false") === "true",
    opalAssist: env("FEATURE_OPAL", "true") === "true",
    piiVault: env("FEATURE_PII_VAULT", "true") === "true",
    auditWebhook: env("AUDIT_WEBHOOK_URL"),
  },
};

export function assertConfig() {
  const missing: string[] = [];
  if (!config.providers.openai && !config.providers.anthropic && !config.providers.xai && !config.providers.openrouter) {
    missing.push("At least one LLM provider key (OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY / OPENROUTER_API_KEY)");
  }
  if (missing.length) throw new Error("Config validation failed:\n- " + missing.join("\n- "));
}
