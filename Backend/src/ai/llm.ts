export type Temperature = "hot" | "warm" | "cold";

export type Signal = {
  label: string;
  kind: "meta" | "platform" | "signal";
  score: number;        // 0..1
  detail?: string;
};

export type ClassifyResult = {
  temperature: Temperature;
  why: Signal[];
  packagingMath?: {
    spendPerMonth: number | null;
    estOrdersPerMonth: number | null;
    estUnitsPerMonth: number | null;
    packagingTypeHint: string | null;
    confidence: number;            // 0..1
  };
};

// Present for older imports
export type ExtractResult = Record<string, unknown>;

/**
 * Minimal LLM facade. Later you can branch to Gemini/Groq/OpenRouter.
 * For now, a local heuristic so builds pass and scoring works without external calls.
 */
export interface LLMProvider {
  classify(text: string): Promise<ClassifyResult>;
}

function simpleHeuristic(text: string): ClassifyResult {
  const t = text.toLowerCase();

  const hasIntent =
    /\brfp\b|\brfq\b|\btender\b|\bbid\b|\bproposal\b|packaging|labels?|cartons?|mailers?/.test(t);

  const signals: Signal[] = [];

  if (/\.com\b|\.(io|co|net|org)\b/.test(t)) {
    signals.push({ label: "Domain quality", kind: "meta", score: 0.65, detail: "domain present" });
  }

  if (/shopify/.test(t)) {
    signals.push({ label: "Platform fit", kind: "platform", score: 0.75, detail: "shopify" });
  } else if (/woocommerce|wp\-?commerce|woo/.test(t)) {
    signals.push({ label: "Platform fit", kind: "platform", score: 0.6, detail: "woocommerce" });
  }

  if (hasIntent) {
    signals.push({ label: "Intent keywords", kind: "signal", score: 0.9, detail: "rfp/rfq/packaging" });
  }

  const hot = hasIntent;
  const temperature: Temperature = hot ? "hot" : signals.length ? "warm" : "cold";

  const confidence =
    signals.reduce((s, x) => s + x.score, 0) / Math.max(1, signals.length);

  return {
    temperature,
    why: signals,
    packagingMath: {
      spendPerMonth: null,
      estOrdersPerMonth: null,
      estUnitsPerMonth: null,
      packagingTypeHint: /label/.test(t) ? "labels" :
                         /mailer/.test(t) ? "mailers" :
                         /carton|box/.test(t) ? "cartons" : null,
      confidence: Math.min(1, confidence)
    }
  };
}

class LocalLLM implements LLMProvider {
  async classify(text: string): Promise<ClassifyResult> {
    return simpleHeuristic(text);
  }
}

export function getLLM(_pref?: string): LLMProvider {
  // Later: switch on env (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY).
  return new LocalLLM();
}

/** Safe JSON parse helper kept for compatibility with older imports. */
export function parseJSON<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
