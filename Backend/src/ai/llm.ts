// Backend/src/ai/llm.ts

/**
 * Minimal LLM router with safe heuristics fallback.
 * No extra deps (uses global fetch in Node 18/20).
 */

export type Temperature = "hot" | "warm" | "cold";

export interface Signal {
  label: string;
  kind: "meta" | "platform" | "signal";
  score: number;      // 0..1
  detail?: string;
}

export interface PackagingMath {
  spendPerMonth?: number | null;
  estOrdersPerMonth?: number | null;
  estUnitsPerMonth?: number | null;
  packagingTypeHint?: string | null;
  confidence?: number | null; // 0..1
}

export interface ClassifyResult {
  temperature: Temperature;
  why: Signal[];
  packagingMath?: PackagingMath;
}

export interface ExtractResult {
  host: string;
  platform?: string;
  title: string;
  cat: string;
  created_at?: string;
}

/** Simple provider interface. */
interface LLMProvider {
  classify(text: string): Promise<ClassifyResult>;
}

/** Heuristic fallback (no external calls). */
class HeuristicLLM implements LLMProvider {
  async classify(text: string): Promise<ClassifyResult> {
    const t = text.toLowerCase();
    const isRfp = /(rfp|rfq|tender|bid)/.test(t);
    const hasPkg = /(packaging|carton|box|mailer|label|bag|pouch)/.test(t);
    const platform =
      /shopify/.test(t) ? "shopify" :
      /woocommerce|woo/.test(t) ? "woocommerce" : undefined;

    const why: Signal[] = [];
    if (hasPkg) why.push({ label: "Intent keywords", kind: "signal", score: 0.85, detail: "packaging terms" });
    if (platform)  why.push({ label: "Platform fit", kind: "platform", score: platform === "shopify" ? 0.75 : 0.6, detail: platform });
    why.push({ label: "Domain quality", kind: "meta", score: 0.65, detail: "unknown (.com)" });

    const temperature: Temperature =
      isRfp && hasPkg ? "hot" :
      hasPkg ? "warm" : "cold";

    const packagingMath: PackagingMath = {
      spendPerMonth: null,
      estOrdersPerMonth: null,
      estUnitsPerMonth: null,
      packagingTypeHint: hasPkg ? "cartons/labels" : null,
      confidence: temperature === "hot" ? 0.8 : temperature === "warm" ? 0.6 : 0.3,
    };

    return { temperature, why, packagingMath };
  }
}

/** Google Gemini */
class GeminiLLM implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}
  async classify(text: string): Promise<ClassifyResult> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const body = {
        contents: [{ role: "user", parts: [{ text: buildPrompt(text) }]}],
        generationConfig: { temperature: 0.2 },
      };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      const parsed = parseJsonFromModel(data);
      return normalizeModelOutput(parsed);
    } catch {
      return new HeuristicLLM().classify(text);
    }
  }
}

/** Groq (OpenAI-compatible) */
class GroqLLM implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}
  async classify(text: string): Promise<ClassifyResult> {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: buildPrompt(text) }],
          temperature: 0.2,
        }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = safeJson(content);
      return normalizeModelOutput(parsed);
    } catch {
      return new HeuristicLLM().classify(text);
    }
  }
}

/** OpenRouter (OpenAI-compatible) */
class OpenRouterLLM implements LLMProvider {
  constructor(private apiKey: string, private model: string) {}
  async classify(text: string): Promise<ClassifyResult> {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: buildPrompt(text) }],
          temperature: 0.2,
        }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = safeJson(content);
      return normalizeModelOutput(parsed);
    } catch {
      return new HeuristicLLM().classify(text);
    }
  }
}

/** Public router */
export function getLLM(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (provider === "gemini") {
    const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    if (key) return new GeminiLLM(key, model);
  }
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY || "";
    const model = process.env.GROQ_MODEL || "llama-3.1-70b-versatile";
    if (key) return new GroqLLM(key, model);
  }
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY || "";
    const model = process.env.OPENROUTER_MODEL || "openrouter/auto";
    if (key) return new OpenRouterLLM(key, model);
  }
  // default: heuristic (safe)
  return new HeuristicLLM();
}

/** Utilities */

function buildPrompt(text: string): string {
  return [
    "Classify packaging lead intent. Return STRICT JSON with keys:",
    `{"temperature":"hot|warm|cold","why":[{"label":"","kind":"meta|platform|signal","score":0..1,"detail":""}],"packagingMath":{"spendPerMonth":null|number,"estOrdersPerMonth":null|number,"estUnitsPerMonth":null|number,"packagingTypeHint":string|null,"confidence":0..1}}`,
    "Text:",
    text,
  ].join("\n");
}

function safeJson(maybe: any): any {
  if (!maybe || typeof maybe !== "string") return {};
  try { return JSON.parse(maybe); } catch { return {}; }
}

// gemini returns a different envelope; try to extract a JSON block
function parseJsonFromModel(data: any): any {
  const txt =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).join("\n") ??
    "";
  return safeJson(txt);
}

function normalizeModelOutput(x: any): ClassifyResult {
  // Best-effort normalization
  const temperature: Temperature = (["hot","warm","cold"].includes(x?.temperature) ? x.temperature : "warm") as Temperature;
  const why: Signal[] = Array.isArray(x?.why) ? x.why.map((w: any) => ({
    label: String(w?.label ?? "signal"),
    kind: (w?.kind === "platform" || w?.kind === "meta") ? w.kind : "signal",
    score: typeof w?.score === "number" ? Math.max(0, Math.min(1, w.score)) : 0.5,
    detail: w?.detail ? String(w.detail) : undefined,
  })) : [];
  const pm = x?.packagingMath ?? {};
  const packagingMath: PackagingMath = {
    spendPerMonth: normNumNull(pm?.spendPerMonth),
    estOrdersPerMonth: normNumNull(pm?.estOrdersPerMonth),
    estUnitsPerMonth: normNumNull(pm?.estUnitsPerMonth),
    packagingTypeHint: pm?.packagingTypeHint ?? null,
    confidence: typeof pm?.confidence === "number" ? Math.max(0, Math.min(1, pm.confidence)) : 0.6,
  };
  return { temperature, why, packagingMath };
}

function normNumNull(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
