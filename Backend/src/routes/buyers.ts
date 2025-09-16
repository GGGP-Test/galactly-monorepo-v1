// Backend/src/routes/buyers.ts
import type { Express, Request, Response } from "express";
import { discoverSupplier } from "../buyers/discovery";

// Minimal HTML decode
const decode = (s: string) => s
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"');

type Lead = {
  name: string;
  url: string;
  reason: string;
  score: number;
  source: "duckduckgo" | "heuristic";
};

async function ddg(query: string): Promise<{ title: string; url: string }[]> {
  const u = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
  const html = await fetch(u, {
    headers: { "User-Agent": "Mozilla/5.0 (ArtemisBot/1.0)" }
  }).then(r => r.text());

  // Parse common DDG HTML result anchors
  const out: { title: string; url: string }[] = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 10) {
    out.push({ title: decode(m[2]).replace(/<[^>]+>/g, "").trim(), url: m[1] });
  }
  return out;
}

function scoreLead(title: string, why: string[], metrics: Record<string, number>) {
  const T = title.toLowerCase();
  let s = 0;
  if (/3pl|fulfillment|warehouse|dc/.test(T)) s += 0.4;
  if (/procurement|purchasing|buyer|sourcing/.test(T)) s += 0.4;
  if (/packaging|film|corrugat|carton/.test(T)) s += 0.3;
  // nudge with metric pressure
  s += (metrics.RPI || 0) * 0.2 + (metrics.ILL || 0) * 0.1;
  if (why.length) s += 0.1;
  return Math.min(1, Number(s.toFixed(3)));
}

export default function mountBuyerRoutes(app: Express) {
  app.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
    try {
      const { supplier, region, personaInput, personaStyle } = req.body || {};
      if (!supplier || typeof supplier !== "string") {
        return res.status(400).json({ error: "bad_request", detail: "`supplier` is required" });
      }

      // Step 1: discover supplier + persona (cheap, no LLM)
      const disc = await discoverSupplier({
        supplier,
        region,
        personaInput,
        personaStyle
      });

      // Step 2: fetch live candidates from DDG for each query
      const leads: Lead[] = [];
      for (const q of disc.candidateSourceQueries) {
        const results = await ddg(q.q);
        for (const r of results) {
          leads.push({
            name: r.title || r.url,
            url: r.url,
            reason: `matched query: ${q.q}`,
            score: scoreLead(r.title, disc.persona.why, disc.metrics),
            source: "duckduckgo"
          });
        }
      }

      // Step 3: fallback heuristics (guarantee at least something shows up)
      if (leads.length === 0) {
        const dom = disc.supplierDomain;
        for (const prefix of ["purchasing", "procurement", "sourcing", "warehouse", "operations", "info", "sales"]) {
          leads.push({
            name: `${prefix}@${dom}`,
            url: `mailto:${prefix}@${dom}`,
            reason: "domain heuristic",
            score: 0.25,
            source: "heuristic"
          });
        }
      }

      // Deduplicate by URL, sort by score desc
      const seen = new Set<string>();
      const final = leads.filter(l => {
        const key = l.url.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => b.score - a.score).slice(0, 25);

      return res.status(200).json({
        supplier: {
          domain: disc.supplierDomain,
          name: disc.supplierName,
        },
        persona: disc.persona,           // includes your one-liner in chosen style
        metrics: disc.metrics,
        evidence: disc.evidence,
        sourceQueries: disc.candidateSourceQueries,
        leads: final
      });
    } catch (err: any) {
      console.error("[find-buyers] error", err);
      return res.status(500).json({ error: "internal_error", detail: String(err?.message || err) });
    }
  });
}
