/**
 * src/server/routes.public.ts
 *
 * Lightweight public routes to:
 *  - push seed items (CSV or JSON)
 *  - trigger discovery/crawl/score
 *  - read basic queue stats
 *
 * Mount under /public in your Express app:
 *   app.use("/public", publicRouter);
 */

import express, { Request, Response } from "express";
import { promises as fs } from "fs";
import * as path from "path";
import * as crypto from "crypto";

const router = express.Router();

// Accept JSON and text (for CSV). Mount body parsers before using router or here:
router.use(express.json({ limit: "1mb" }));
router.use(express.text({ type: ["text/*", "text/csv"], limit: "2mb" }));

const DEFAULT_QUEUE = path.resolve(process.cwd(), "data/lead-source-queue.ndjson");

type LeadSource = "OPAL" | "MANUAL" | "IMPORT" | "OTHER";

interface LeadSourceQuery {
  id: string;
  tenantId: string;
  domain: string;
  name?: string;
  region?: string;
  reason?: string;
  signalUrl?: string | null;
  source: LeadSource;
  createdAt: string;
}

function toDomain(urlOrDomain: string): string {
  let raw = (urlOrDomain || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = "http://" + raw;
  try {
    const u = new URL(raw);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^www\./, "");
  }
}

function stableId(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

// Minimal CSV → objects
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headers = (lines.shift() || "").split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // naive split; acceptable for our controlled exports (no commas in fields)
    const cells = line.split(",").map((c) => c.trim());
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = cells[i] || "";
    rows.push(obj);
  }
  return rows;
}

async function enqueueFile(queries: LeadSourceQuery[], queuePath = DEFAULT_QUEUE) {
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  const lines = queries.map((q) => JSON.stringify(q)).join("\n") + "\n";
  await fs.appendFile(queuePath, lines, "utf8");
  return queries.length;
}

async function tryModuleEnqueue(queries: LeadSourceQuery[]) {
  try {
    const mod = await import(path.resolve(process.cwd(), "src/lead-sources.ts")).catch(() =>
      import(path.resolve(process.cwd(), "src/lead-sources.js"))
    );
    if (typeof (mod as any).enqueueLeadSourceQueries === "function") {
      return await (mod as any).enqueueLeadSourceQueries(queries);
    }
    throw new Error("enqueueLeadSourceQueries() missing");
  } catch {
    return null; // caller will fallback to file
  }
}

/**
 * POST /public/seeds
 * Body: JSON { tenantId, source?, region?, items:[ { name?, website?, domain?, reason?, signal? } ] }
 * Or: text/csv with headers: Name,Website,HQ/Region,Reason,Signal  (query: tenantId=..., source=..., region=...)
 */
router.post("/seeds", async (req: Request, res: Response) => {
  const contentType = req.headers["content-type"] || "";
  const tenantId =
    String(req.query.tenantId || (req.body && (req.body.tenantId || "")) || "").trim();
  if (!tenantId) return res.status(400).json({ ok: false, error: "tenantId required" });

  const source = (String(req.query.source || req.body?.source || "OPAL").toUpperCase() ||
    "OPAL") as LeadSource;
  const region = String(req.query.region || req.body?.region || "").trim() || undefined;

  let rows: Record<string, string>[] = [];
  if (/^application\/json/i.test(contentType)) {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    rows = items;
  } else if (/^text\//i.test(contentType)) {
    const text = String(req.body || "");
    rows = parseCsv(text);
  } else {
    return res.status(415).json({ ok: false, error: "Unsupported Content-Type" });
  }

  const dedupe = new Set<string>();
  const items: LeadSourceQuery[] = [];
  for (const r of rows) {
    const name =
      r["Name"] || r["Company"] || r["name"] || r["company"] || r["brand"] || undefined;
    const domain = toDomain(r["Website"] || r["URL"] || r["Domain"] || r["website"] || "");
    if (!domain) continue;
    if (dedupe.has(domain)) continue;
    dedupe.add(domain);
    items.push({
      id: stableId(`${tenantId}:${domain}`),
      tenantId,
      domain,
      name,
      region: (r["HQ/Region"] || r["Region"] || region) || undefined,
      reason: r["Reason"] || r["Why"] || r["reason"] || undefined,
      signalUrl: r["Signal"] || r["signal"] || null,
      source,
      createdAt: new Date().toISOString(),
    });
  }

  let enqueued = await tryModuleEnqueue(items);
  if (enqueued === null) {
    enqueued = await enqueueFile(items);
  }

  res.json({
    ok: true,
    tenantId,
    source,
    region: region || null,
    received: rows.length,
    enqueued,
    adapter: enqueued === items.length ? "file|module" : "file",
  });
});

/**
 * POST /public/cron
 * Body: { job: "discover"|"crawl"|"score"|"route"|"notify", limit?, concurrency?, tenantId? }
 * Tries to import project job runners; if not found, no-ops with 202.
 */
router.post("/cron", async (req: Request, res: Response) => {
  const job: string = String(req.body?.job || "").toLowerCase();
  const limit = Number(req.body?.limit || 100);
  const concurrency = Number(req.body?.concurrency || 5);
  const tenantId = req.body?.tenantId ? String(req.body.tenantId) : undefined;

  try {
    const { runCronJob } = await import(path.resolve(process.cwd(), "src/ops/cron.ts")).catch(
      () => ({ runCronJob: undefined })
    );
    if (typeof runCronJob === "function") {
      const out = await runCronJob({ job, limit, concurrency, tenantId });
      return res.json({ ok: true, adapter: "module", result: out });
    }
  } catch (err) {
    // fall through
    console.warn("Module cron adapter failed:", (err as Error).message);
  }
  return res.status(202).json({
    ok: true,
    adapter: "none",
    note: "cron module not found; accepted request (no-op).",
    job,
    limit,
    concurrency,
    tenantId: tenantId || null,
  });
});

/**
 * GET /public/queue
 * Returns basic stats about the file-backed queue (if present).
 */
router.get("/queue", async (_req: Request, res: Response) => {
  try {
    const p = DEFAULT_QUEUE;
    const data = await fs.readFile(p, "utf8");
    const lines = data.trim() ? data.trim().split("\n") : [];
    res.json({ ok: true, adapter: "file", path: p, count: lines.length });
  } catch {
    res.json({ ok: true, adapter: "none", count: 0 });
  }
});

router.get("/health", (_req, res) => res.json({ ok: true }));

export const publicRouter = router;
export default router;
