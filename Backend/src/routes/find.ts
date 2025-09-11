import type { App } from "../index";
import { inferPersonaAndTargets } from "../ai/webscout";

// Compatibility helper – normalize region/radius
function parseFindBody(body: any) {
  const supplierDomain = String(body.supplierDomain || body.domain || body.host || "").trim();
  const region = String(body.region || body.country || "US/CA").toLowerCase();
  const radiusMi = Number(body.radiusMi || body.radius || 50);
  return { supplierDomain, region, radiusMi };
}

// Minimal in-memory “results”; in real code this calls external adapters.
function fakeMatchHosts(personaCats: string[], region: string) {
  const catalog = [
    "homebrewsupply.com",
    "globallogistics.com",
    "sustainchem.com",
    "peakperform.com",
    "brightfuture.com",
    "urbangreens.com",
  ];
  return catalog.map((host, i) => ({
    id: i + 1,
    host,
    platform: "unknown",
    title: `Lead: ${host}`,
    created: new Date().toISOString(),
    temperature: personaCats.some(c => /3pl|dc|warehouse/i.test(c)) ? "hot" : "warm",
    why: [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: `${host} (.com)` },
      { label: "Platform fit", kind: "platform", score: 0.5, detail: "unknown" },
      { label: "Context", kind: "context", score: 0.6, detail: `Region focus: ${region}` },
    ],
  }));
}

export function mountFind(app: App) {
  // Legacy aliases accepted by Free Panel
  const paths = [
    "/api/v1/leads/find-buyers",
    "/api/v1/find-buyers",
    "/api/v1/find",
  ];

  for (const p of paths) {
    app.post(p, async (req, res) => {
      const { supplierDomain, region, radiusMi } = parseFindBody(req.body);
      if (!supplierDomain) return res.status(400).json({ ok: false, error: "supplierDomain required" });

      try {
        const persona = await inferPersonaAndTargets(supplierDomain, region);
        const rows = fakeMatchHosts(persona.categories, region);
        res.json({
          ok: true,
          supplierDomain,
          region,
          radiusMi,
          persona,
          rows,
          count: rows.length,
        });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message || "find failed" });
      }
    });
  }
}
