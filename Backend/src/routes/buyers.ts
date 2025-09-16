import type { Express, Router, Request, Response } from "express";
import { discoverSupplier } from "../buyers/discovery";
import { generateLeads } from "../buyers/pipeline";

// Mounts POST /api/v1/leads/find-buyers
export default function mountBuyerRoutes(appOrRouter: Express | Router) {
  const post = (appOrRouter as any).post?.bind(appOrRouter);
  if (typeof post !== "function") {
    throw new Error("mountBuyerRoutes: app/router missing .post()");
  }

  post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
    try {
      const { supplier, region, personaInput, pro } = (req.body || {}) as {
        supplier: string;
        region?: string;
        personaInput?: string;
        pro?: boolean;
      };

      if (!supplier || typeof supplier !== "string") {
        return res.status(400).json({ ok: false, error: "supplier (domain or URL) is required" });
      }

      // 1) Discover (cheap-first, 1 LLM hop max if keys present)
      const discovery = await discoverSupplier({ supplier, region, personaInput });

      // 2) Generate free-first leads (Pro ready)
      const pipe = await generateLeads(discovery, { region, pro: !!pro });

      // 3) Token hints for friendly UI chips
      const offerTokens = (discovery.persona.oneLiner.match(/(corrugated|flexible packaging|labels|stretch\/shrink film|wrapping machines|packaging solutions)/gi) || []).map(x => x.trim());
      const sectorTokens = discovery.persona.sectors;
      const titleTokens = discovery.persona.buyerTitles;

      return res.json({
        ok: true,
        supplierDomain: discovery.supplierDomain,
        persona: discovery.persona,
        personaTokens: {
          offer: offerTokens,
          sectors: sectorTokens,
          titles: titleTokens,
        },
        metrics: discovery.metrics,
        leads: pipe.leads,
        evidence: [...discovery.evidence, ...pipe.evidence].slice(-200), // cap for payload size
      });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
