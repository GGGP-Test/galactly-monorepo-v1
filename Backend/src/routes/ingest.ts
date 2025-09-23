// src/routes/ingest.ts
import { Router, Request, Response } from "express";
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  buckets,
  type StoredLead,
} from "../shared/memStore";

const router = Router();

/** ---------------------------
 * helpers
 * --------------------------*/
function toHost(input?: string): string | undefined {
  const s = String(input || "").trim();
  if (!s) return;
  // Try URL parsing
  try {
    const u = s.includes("://") ? new URL(s) : new URL(`https://${s}`);
    const h = (u.hostname || "").toLowerCase().replace(/^www\./, "");
    if (h && h.includes(".")) return h;
  } catch {
    // fallthrough to regex
  }
  // Fallback: find domain-like token
  const m = s.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  if (m && !m[1].toLowerCase().endsWith("github.com")) {
    return m[1].toLowerCase();
  }
  return;
}

function nowISO() {
  return new Date().toISOString();
}

type Temp = "hot" | "warm" | "cold";
type IngestBody = {
  homepage?: string;
  owner?: string;
  name?: string;
  description?: string;
  topics?: string[];
  temp?: Temp;
};

function ok(res: Response, data: any) {
  return res.status(200).json({ ok: true, ...data });
}
function bad(res: Response, msg = "bad request", code = 400) {
  return res.status(code).json({ ok: false, error: msg });
}

/** Convert a StoredLead into the panel’s table item shape */
function toPanelItem(lead: StoredLead) {
  return {
    id: lead.id,
    host: lead.host,
    platform: lead.platform || "web",
    title: lead.title || "",
    created: lead.created || "",
    temperature: lead.temperature || "warm",
    why: lead.why
      ? {
          signal: { label: "Discovery", score: 0.7, detail: lead.why },
        }
      : null,
    whyText: lead.why || "",
  };
}

/** ---------------------------
 * POST /ingest/github
 * Accepts items from Actions (Zie619 → our API)
 * --------------------------*/
async function handleGithubIngest(req: Request, res: Response) {
  const b: IngestBody = (req.body || {}) as any;

  // Choose a host from homepage or description; fallback to owner.github.io
  let host = toHost(b.homepage) || toHost(b.description);
  if (!host && b.owner) host = `${String(b.owner).toLowerCase()}.github.io`;
  if (!host) return bad(res, "no usable domain found (homepage/description/owner)");

  // Create/update lead
  const lead0 = ensureLeadForHost(host);
  const temp: Temp = b.temp === "hot" || b.temp === "cold" ? b.temp : "warm";

  const why =
    b.description
      ? `Found via GitHub (${b.owner ?? "unknown"}/${b.name ?? "repo"}): ${b.description}`
      : `Found via GitHub (${b.owner ?? "unknown"}/${b.name ?? "repo"})`;

  const updated: StoredLead = saveByHost(host, {
    platform: "github",
    title: lead0.title || (b.name ? `Repo: ${b.name}` : "Discovered repository"),
    created: lead0.created || nowISO(),
    why,
    saved: true,
  });

  // mark temperature
  replaceHotWarm(host, temp);

  return ok(res, { host, item: updated });
}

/** Keep a tiny health for this router */
router.get("/ingest/health", (_req, res) => ok(res, { scope: "ingest" }));

/** Primary ingest endpoint (relative); will end up as /api/ingest/github when mounted at /api */
router.post("/ingest/github", handleGithubIngest);

/** Also register absolute path for belt-and-suspenders if app mounts this router at root */
router.post("/api/ingest/github", handleGithubIngest);

/** ---------------------------
 * READ endpoints for Free Panel
 * The panel calls: GET /api/v1/leads?temp=hot|warm
 * We’ll provide both /leads and /v1/leads for compatibility.
 * --------------------------*/
function handleList(req: Request, res: Response) {
  const tempQ = String(req.query.temp || "").toLowerCase();
  const { hot, warm, cold } = buckets();
  let list = warm;
  if (tempQ === "hot") list = hot;
  else if (tempQ === "cold") list = cold;

  const items = list.map(toPanelItem);
  return ok(res, { items });
}

// canonical: /api/v1/leads
router.get("/v1/leads", handleList);
// alias: /api/leads
router.get("/leads", handleList);
// extra convenience paths
router.get("/leads/hot", (_req, res) => ok(res, { items: buckets().hot.map(toPanelItem) }));
router.get("/leads/warm", (_req, res) => ok(res, { items: buckets().warm.map(toPanelItem) }));

export default router;