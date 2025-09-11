import type { Application, Request, Response } from "express";

/**
 * Mount all lead-related endpoints onto the provided Express app.
 * We use a named export to match the import in index.ts.
 */
export function mountLeads(app: Application): void {
  const base = "/api/v1/leads";

  // List leads (hot/warm). For now returns an empty list if nothing is loaded.
  app.get(base, (req: Request, res: Response) => {
    // you can add filtering by req.query.temp === 'hot' | 'warm' later
    res.json({ ok: true, items: [] });
  });

  // Find buyers from a supplier (panel calls this).
  app.post(`${base}/find-buyers`, (req: Request, res: Response) => {
    // minimal echo so the panel stops seeing 404/405:
    // expected body: { supplier: string, region?: string, radiusMi?: number }
    const { supplier, region, radiusMi } = req.body || {};
    if (!supplier || typeof supplier !== "string") {
      res.status(400).json({ ok: false, error: "supplier (domain) is required" });
      return;
    }

    // stub response; wire real logic next
    res.json({
      ok: true,
      supplier,
      region: region ?? "us/ca",
      radiusMi: typeof radiusMi === "number" ? radiusMi : 50,
      created: Date.now(),
      candidates: [], // fill with real matches later
      skipped: 0,
      errors: 0
    });
  });

  // Optional: warm/hot CSV downloads
  app.get(`${base}/csv/:kind`, (req: Request, res: Response) => {
    const kind = req.params.kind === "hot" ? "hot" : "warm";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leads_${kind}.csv"`);
    res.send("id,host,platform,title,created,temp,why\n"); // empty CSV header stub
  });
}
