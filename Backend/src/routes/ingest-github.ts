// src/routes/ingest-github.ts
import { Router, Request, Response } from "express";
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  type StoredLead,
  type Temp,
} from "../shared/memStore";

const r = Router();

type ApiOk = { ok: true; items: Array<{
  host: string; platform?: string; title?: string; created?: string;
  temp?: string; whyText?: string;
}>};
type ApiErr = { ok: false; error: string };

function bad(res: Response, msg: string, code = 400) {
  const body: ApiErr = { ok: false, error: msg };
  return res.status(code).json(body);
}

function toHost(urlLike?: string, fallbackText?: string): string | undefined {
  if (!urlLike && !fallbackText) return;
  const tryUrl = (s: string) => {
    try {
      const u = s.includes("://") ? new URL(s) : new URL("https://" + s);
      const h = u.hostname.replace(/^www\./, "").toLowerCase();
      if (h.endsWith("github.com") || h.endsWith("githubusercontent.com")) return undefined;
      return h;
    } catch { return undefined; }
  };
  const fromUrl = urlLike ? tryUrl(urlLike) : undefined;
  if (fromUrl) return fromUrl;

  if (fallbackText) {
    const m = fallbackText.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
    if (m && !m[1].endsWith("github.com")) return m[1].toLowerCase();
  }
}

function panelView(lead: StoredLead) {
  return {
    host: lead.host,
    platform: lead.platform ?? "web",
    title: lead.title ?? `Buyer lead for ${lead.host}`,
    created: lead.created,
    temp: lead.temperature,
    whyText: lead.why ?? "",
  };
}

/** POST /api/ingest/github
 * Body: { homepage, owner, name, description, topics, temp? }
 */
r.post("/ingest/github", (req: Request, res: Response) => {
  const { homepage, owner, name, description, temp } = req.body || {};
  const host = toHost(String(homepage || ""), String(description || ""));
  if (!host) return bad(res, "could not derive host from homepage/description");

  const when = new Date().toISOString();
  const title = `Buyer lead for ${host}${owner && name ? ` (via ${owner}/${name})` : ""}`;

  saveByHost(host, {
    title,
    platform: "web",
    created: when,
    why: `mirrored repo: ${owner ?? ""}/${name ?? ""}`,
  });

  const t = (String(temp || "").toLowerCase() as Temp) || "warm";
  if (["hot", "warm", "cold"].includes(t)) replaceHotWarm(host, t as Temp);

  return res.json({ ok: true, items: [panelView(ensureLeadForHost(host))] } as ApiOk);
});

r.get("/ingest/health", (_req, res) => res.json({ ok: true }));

export default r;