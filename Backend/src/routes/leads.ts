import type { Express, Request, Response } from "express";
import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { webScoutFindBuyers, type Candidate, type Persona } from "../ai/webscout";

// -------- types & in-memory store --------

type Temperature = "hot" | "warm";

export type Lead = Candidate & {
  id: number;
  stage?: "new" | "contacted" | "qualified" | "won" | "lost";
  notes?: string[];
  source?: "seed" | "ai";
};

type ListResponse = {
  items: Lead[];
};

const store: Lead[] = [];
let idSeq = 1;

// US/CA heuristic filter (v0 — swap for a geocoder later)
const US_CA_TLDS = [".com", ".us", ".ca", ".org", ".net"];
function inUSorCA(host: string): boolean {
  return US_CA_TLDS.some((tld) => host.endsWith(tld));
}

// -------- helpers --------

function bool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
  return fallback;
}

function nowStr() {
  return new Date().toLocaleString();
}

function csvLine(cols: string[]) {
  return cols
    .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
    .join(",");
}

async function appendCSV(leads: Lead[], file = "leads_dump.csv") {
  try {
    const header =
      "id,host,platform,title,created,temperature,whyText,stage,source\r\n";
    const lines = leads.map((l) =>
      csvLine([
        String(l.id),
        l.host,
        l.platform || "unknown",
        l.title || "",
        l.created || "",
        l.temperature || "",
        l.whyText || "",
        l.stage || "new",
        l.source || "ai",
      ])
    );
    const full = header + lines.join("\r\n") + "\r\n";
    const outPath = path.resolve(process.cwd(), file);
    // overwrite each time (panel can also export client-side CSV)
    await fs.writeFile(outPath, full, "utf8");
  } catch {
    // ignore disk failures in ephemeral containers
  }
}

function pickRegion(req: Request): "us" | "ca" | "usca" | undefined {
  const r = String(req.query.region || "").toLowerCase();
  return r === "us" || r === "ca" || r === "usca" ? (r as any) : undefined;
}

function filterByRegion(items: Lead[], region?: "us" | "ca" | "usca"): Lead[] {
  if (!region || region === "usca") {
    // keep US/CA-ish domains (heuristic)
    return items.filter((x) => inUSorCA(x.host));
  }
  // Until we wire a real geo, use same heuristic for both; still satisfies US/CA-only constraint
  return items.filter((x) => inUSorCA(x.host));
}

// Simple write-guard: if API_KEY is set, require x-api-key for POST/PUT/PATCH/DELETE
function requireKey(req: Request, res: Response, next: () => void) {
  const need = process.env.API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got && got === need) return next();
  res.status(401).json({ ok: false, error: "missing or invalid api key" });
}

// -------- router factory --------

export function mountLeads(app: Express) {
  const router = Router();

  // GET /api/v1/leads?temp=hot|warm&region=us|ca|usca
  router.get("/", (_req: Request, res: Response) => {
    // NOTE: we re-read req via res.req because types narrow awkwardly otherwise
    const req = res.req as Request;
    const temp = String(req.query.temp || "").toLowerCase() as Temperature | "";
    const region = pickRegion(req);

    let items = [...store].sort((a, b) => b.id - a.id);

    if (temp === "hot" || temp === "warm") {
      items = items.filter((l) => l.temperature === temp);
    }
    if (region) {
      items = filterByRegion(items, region);
    }

    const out: ListResponse = { items };
    res.json(out);
  });

  // POST /api/v1/leads/find-buyers
  // body: { supplier, region?, radiusMi?, persona?, onlyUSCA? }
  router.post("/find-buyers", requireKey, async (req: Request, res: Response) => {
    try {
      const supplier = String(req.body?.supplier || "").trim().toLowerCase();
      if (!supplier) {
        return res.status(400).json({ ok: false, error: "supplier is required" });
      }
      const persona: Persona | undefined = req.body?.persona;
      const region = (String(req.body?.region || "usca").toLowerCase() ||
        "usca") as "us" | "ca" | "usca";
      const onlyUSCA = req.body?.onlyUSCA !== false;

      const out = await webScoutFindBuyers({
        supplier,
        region,
        radiusMi: Number(req.body?.radiusMi || 50) || 50,
        persona,
        onlyUSCA,
      });

      // Persist to memory (+ mirror CSV for debugging)
      const created: Lead[] = out.candidates.map((c) => {
        const lead: Lead = {
          ...c,
          id: idSeq++,
          created: nowStr(),
          stage: "new",
          source: "ai",
        };
        store.push(lead);
        return lead;
      });

      await appendCSV(created, "leads_latest.csv");

      res.json({
        ok: true,
        supplierDomain: out.supplierDomain,
        created: created.length,
        ids: created.map((l) => l.id),
        candidates: created,
      });
    } catch (err: any) {
      res
        .status(500)
        .json({ ok: false, error: String(err?.message || err || "error") });
    }
  });

  // PATCH /api/v1/leads/:id/stage { stage, note? }
  router.patch("/:id/stage", requireKey, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = store.find((l) => l.id === id);
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });

    const stage = String(req.body?.stage || "").toLowerCase();
    if (!["new", "contacted", "qualified", "won", "lost"].includes(stage)) {
      return res.status(400).json({ ok: false, error: "invalid stage" });
    }
    lead.stage = stage as Lead["stage"];

    const note = String(req.body?.note || "").trim();
    if (note) {
      lead.notes = lead.notes || [];
      lead.notes.push(`${nowStr()} — ${note}`);
    }

    res.json({ ok: true, id: lead.id, stage: lead.stage, notes: lead.notes || [] });
  });

  // Optional: GET /api/v1/leads/:id (detail)
  router.get("/:id", (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = store.find((l) => l.id === id);
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });
    res.json(lead);
  });

  // Mount under /api/v1/leads
  app.use("/api/v1/leads", router);
  return router;
}

// Export default AND named to satisfy either import style from index.ts
export default mountLeads;
