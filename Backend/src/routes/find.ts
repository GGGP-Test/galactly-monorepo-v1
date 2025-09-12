// src/routes/find.ts
import type { Express, Request, Response } from "express";
import type { Lead, Temp } from "./public";

type LeadsStore = { hot: Lead[]; warm: Lead[] };

function getStore(req: Request): LeadsStore {
  const app = req.app;
  if (!app.locals.leadsStore) app.locals.leadsStore = { hot: [], warm: [] } as LeadsStore;
  return app.locals.leadsStore as LeadsStore;
}

function mkId(seed: string, i: number) {
  // deterministic-ish id per domain + index (good enough for demo)
  const base = Buffer.from(`${seed}:${i}`).toString("base64url").slice(0, 8);
  return `L_${Date.now()}_${base}`;
}

export default function mountFind(app: Express) {
  app.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
    try {
      // Payload from panel
      const domain = (req.body?.domain ?? "").trim().toLowerCase();
      const region = (req.body?.region ?? "US/CA").trim();
      const radiusMi = Number(req.body?.radiusMi ?? 50);

      if (!domain) {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }

      // TODO: replace this block with your real finder (webscout / buyers provider)
      // Demo candidates so the UI shows rows and end-to-end is verified.
      const now = new Date().toISOString();
      const candidates: Lead[] = Array.from({ length: 3 }).map((_, i) => ({
        id: mkId(domain, i),
        host: domain,
        platform: "web",
        title: `Prospect ${i + 1} @ ${domain}`,
        createdAt: now,
        temp: (i < 2 ? "hot" : "warm") as Temp,
        why: `Near ${region} • signal ${i + 1} • ${radiusMi}mi`,
        region,
      }));

      const store = getStore(req);
      // Write into the shared store the panel reads
      for (const c of candidates) {
        if (c.temp === "hot") store.hot.unshift(c);
        else store.warm.unshift(c);
      }

      const result = { ok: true, created: candidates.length, hot: store.hot.length, warm: store.warm.length };
      console.log(`[find] POST /leads/find-buyers -> 200 domain=${domain} +${candidates.length} hot=${store.hot.length} warm=${store.warm.length}`);
      return res.status(200).json(result);
    } catch (err: any) {
      console.error("[find] error:", err?.stack || err);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
}
