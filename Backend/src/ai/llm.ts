// Backend/src/ai/llm.ts
// Minimal LLM router with 3 providers (Gemini → Groq → OpenRouter).
// Exposes a single helper: generateCandidatesHints(persona, region)
// that returns text ideas we can turn into candidate leads.
// All network errors are swallowed so the API never 500s.

type ModelHint = { ideas: string[]; provider: string };

type Persona = {
  supplierDomain: string;
  offer: string;
  solves: string;
  buyerTitles: string[];
};

const GEMINI_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_AI_STUDIO_KEY ||
  process.env.GOOGLE_GEMINI_KEY ||
  "";
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const OPENROUTER_KEY =
  process.env.OPENROUTER_API_KEY ||
  process.env.OPENROUTER_KEY ||
  "";

const DEFAULT_TIMEOUT_MS = 6000;

function withTimeout<T>(p: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return p.finally(() => clearTimeout(t)) as any;
}

// ---- Providers ----

async function askGemini(prompt: string): Promise<ModelHint | null> {
  if (!GEMINI_KEY) return null;
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
    encodeURIComponent(GEMINI_KEY);
  try {
    const r = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
      })
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const text: string =
      j?.candidates?.[0]?.content?.parts?.[0]?.text ||
      j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).join("\n") ||
      "";
    const ideas = parseIdeas(text);
    if (!ideas.length) return null;
    return { ideas, provider: "gemini-1.5-flash" };
  } catch {
    return null;
  }
}

async function askGroq(prompt: string): Promise<ModelHint | null> {
  if (!GROQ_KEY) return null;
  try {
    const r = await withTimeout(
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: "You output newline-separated company/lead ideas only." },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
        }),
      })
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const text: string = j?.choices?.[0]?.message?.content || "";
    const ideas = parseIdeas(text);
    if (!ideas.length) return null;
    return { ideas, provider: "groq/llama-3.1-8b-instant" };
  } catch {
    return null;
  }
}

async function askOpenRouter(prompt: string): Promise<ModelHint | null> {
  if (!OPENROUTER_KEY) return null;
  try {
    const r = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_KEY}`,
        },
        body: JSON.stringify({
          model: "openrouter/auto",
          messages: [
            { role: "system", content: "You output newline-separated company/lead ideas only." },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
        }),
      })
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const text: string = j?.choices?.[0]?.message?.content || "";
    const ideas = parseIdeas(text);
    if (!ideas.length) return null;
    return { ideas, provider: "openrouter/auto" };
  } catch {
    return null;
  }
}

function parseIdeas(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((s) => s.replace(/^[\-\*\d\.\)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

// ---- Public API ----

export async function generateCandidatesHints(
  persona: Persona,
  region: string
): Promise<ModelHint> {
  const prompt =
    `You are helping a packaging supplier find live buyers in ${region || "US/CA"}.\n` +
    `Supplier sells: ${persona.offer}\n` +
    `It solves: ${persona.solves}\n` +
    `Buyer titles: ${persona.buyerTitles.join(", ")}\n\n` +
    `Return 10-20 short lines. Each line = a potential buyer lead idea with company name or domain-like string and a reason (rfp/rfq, shipping, rebrand, new product, 3PL/warehouse, etc.). No extra commentary.`;

  // Priority: Gemini → Groq → OpenRouter
  const first =
    (await askGemini(prompt)) ||
    (await askGroq(prompt)) ||
    (await askOpenRouter(prompt));
  return (
    first || { ideas: [], provider: "none" }
  );
}
