// src/routes/ingest.ts
import { Router, Request, Response } from "express";
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  type StoredLead,
} from "../shared/memStore";

const router = Router();

/** Parse a host from a URL-like or free text. */
function toHost(input?: string): string | undefined {
  const s = String(input || "").trim();
  if (!s) return;
  // Try URL parsing
  try {
    const u = s.includes("://") ? new URL(s) : new URL(`https://${s}`);
    const h = (u.hostname || "").toLowerCase().replace(/^www\./, "");
    if (h && h.includes(".")) return h;
  } catch {
    // fallthrough
  }
  // Fallback: find domain-looking token in free text
  const m = s.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  if (m && !m[1].toLowerCase().endsWith("github.com")) {
    return m[1].toLowerCase();
  }
  return;
}

function nowISO() {
  return new Date().toISOString();
}

type IngestBody = {
  homepage?: string;     // "https://example.com"
  owner?: string;        // "Zie619"
  name?: string;         // repo name
  description?: string;  // repo description
  topics?: string[];     // ["n8n","workflow"]
  temp?: "hot" | "warm" | "cold";
};

function ok(res: Response, data: any) {
  return res.status(200).json({ ok: true, ...data });
}
function bad(res: Response, msg = "bad request", code = 400) {
  return res.status(code).json({ ok: false, error: msg });
}

/**
 * POST /api/ingest/github
 * Body: IngestBody
 */
async function handleGithubIngest(req: Request, res: Response) {
  const b: IngestBody = (req.body || {}) as any;

  // pick a host from homepage first, then description
  let host = toHost(b.homepage) || toHost(b.description);
  // last fallback: owner.github.io
  if (!host && b.owner) host = `${String(b.owner).toLowerCase()}.github.io`;

  if (!host) return bad(res, "no usable domain found (homepage/description/owner)");

  // Create or update a lead for this host
  const lead0 = ensureLeadForHost(host);
  const temp = (b.temp === "hot" || b.temp === "warm" || b.temp === "cold") ? b.temp : "warm";

  const why =
    b.description
      ? `Found via GitHub (${b.owner ?? "unknown"}/${b.name ?? "repo"}): ${b.description}`
      : `Found via GitHub (${b.owner ?? "unknown"}/${b.name ?? "repo"})`;

  // merge/update
  const updated: StoredLead = saveByHost(host, {
    platform: "github",
    title: lead0.title || (b.name ? `Repo: ${b.name}` : "Discovered repository"),
    created: lead0.created || nowISO(),
    why,
    saved: true,
  });

  // set temperature explicitly (also marks as saved)
  replaceHotWarm(host, temp);

  return ok(res, { host, item: updated });
}

// health for this router
router.get("/ingest/health", (_req, res) => ok(res, { scope: "ingest" }));

// IMPORTANT: register relative path so that mounting at `/api` yields `/api/ingest/github`
router.post("/ingest/github", handleGithubIngest);

// Optional extra absolute path for belt-and-suspenders (works if mounted at '/')
router.post("/api/ingest/github", handleGithubIngest);

export default router;