import { runProviders } from "../providers";
import { UICandidate, FindBuyersInput } from "../providers/types";
import { buildCacheKey, saveLeadsToDisk } from "../utils/fsCache";

// Public shape the router returns
export type FindBuyersResponse = {
  ok: true;
  created: number;
  candidates: UICandidate[];
  meta: Record<string, unknown>;
};

// Normalize raw input → strong FindBuyersInput
function normalize(raw: Partial<FindBuyersInput>): FindBuyersInput {
  const personaRaw = raw.persona ?? { offer: "", solves: "", titles: "" };

  const titles =
    Array.isArray(personaRaw.titles)
      ? personaRaw.titles
      : String(personaRaw.titles || "")
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);

  return {
    supplier: String(raw.supplier || "").trim(),
    region: String(raw.region || "usca").toLowerCase(),
    radiusMi: Number(raw.radiusMi ?? 50),
    persona: {
      offer: String(personaRaw.offer || ""),
      solves: String(personaRaw.solves || ""),
      titles,
    },
  };
}

// Simple de-dup by host (keep first occurrence)
function dedupeByHost(arr: UICandidate[]): UICandidate[] {
  const seen = new Set<string>();
  const out: UICandidate[] = [];
  for (const c of arr) {
    const h = (c.host || "").toLowerCase();
    if (!seen.has(h)) {
      seen.add(h);
      out.push(c);
    }
  }
  return out;
}

/**
 * Main service used by the router. Wraps providers, cleans data,
 * counts hot/warm, and writes a tiny cache to disk.
 */
export async function findBuyersService(
  raw: Partial<FindBuyersInput>
): Promise<FindBuyersResponse> {
  const input = normalize(raw);
  const key = buildCacheKey(input);

  const t0 = Date.now();
  const { candidates: fromProviders, meta: providerMeta = {} } = await runProviders(input);

  const candidates = dedupeByHost(fromProviders);
  const hotCount = candidates.filter(c => c.temp === "hot").length;
  const warmCount = candidates.filter(c => c.temp === "warm").length;

  // Persist last run (split to hot/warm arrays for convenience)
  await saveLeadsToDisk(
    key,
    candidates.filter(c => c.temp === "hot"),
    candidates.filter(c => c.temp === "warm"),
    providerMeta
  );

  // No duplicate keys inside this object literal
  const meta = {
    ms: Date.now() - t0,
    ...providerMeta,
    hot: hotCount,
    warm: warmCount,
  };

  return {
    ok: true,
    created: candidates.length,
    candidates,
    meta,
  };
}