import { Router } from "express";
import type { Request, Response } from "express";
import { saveByHost, type Temp } from "../shared/memStore";

const r = Router();

type IncomingRow = {
  host?: string;
  homepage?: string;
  owner?: string;
  name?: string;
  platform?: string;
  title?: string;
  description?: string;
  topics?: string[] | string;
  temp?: Temp | string;
  whyText?: string;
  created?: string;
};

function toHost(s?: string) {
  if (!s) return "";
  try {
    const t = s.trim();
    const u = t.includes("://") ? new URL(t) : new URL("https://" + t);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    // maybe already a hostname
    return s.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  }
}

r.post("/ingest/github", (req: Request, res: Response) => {
  const rows: IncomingRow[] = Array.isArray(req.body?.items) ? req.body.items : [];
  let saved = 0;

  for (const row of rows) {
    const host = toHost(row.host || row.homepage || "");
    if (!host || !host.includes(".")) continue;

    const title =
      row.title ||
      (row.owner && row.name ? `Repo ${row.name} — possible buyer @ ${row.owner}` : "Possible buyer");
    const why =
      row.whyText ||
      (row.description ? row.description : "(from GitHub mirror)");

    const temp: Temp =
      (row.temp === "hot" || row.temp === "warm" || row.temp === "cold") ? (row.temp as Temp) : "warm";

    const created =
      row.created || new Date().toISOString();

    saveByHost(host, {
      platform: row.platform || "web",
      title,
      why,
      created,
      temperature: temp,
      saved: true,
    });
    saved++;
  }

  return res.json({ ok: true, saved });
});

export default r;