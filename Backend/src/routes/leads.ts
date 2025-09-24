import { Router } from "express";
import type { Request, Response } from "express";
import {
  buckets,
  saveByHost,
  replaceHotWarm,
  watchers as getWatchers,
  type StoredLead,
} from "../shared/memStore";

const r = Router();

type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;
  temp?: "hot" | "warm" | "cold" | string;
  whyText?: string;
};

type ApiOk<T = unknown> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

function map(l: StoredLead): LeadItem {
  return {
    host: l.host,
    platform: l.platform ?? "web",
    title: l.title ?? "Possible buyer",
    created: l.created,
    temp: l.temperature,
    whyText: l.why ?? "",
  };
}

function sendCsv(res: Response, leads: StoredLead[], filename: string) {
  const rows = [
    ["host", "platform", "title", "created", "temp", "whyText"].join(","),
    ...leads.map((l) =>
      [
        l.host,
        l.platform ?? "web",
        (l.title ?? "").replace(/[\r\n,]+/g, " "),
        l.created,
        l.temperature,
        (l.why ?? "").replace(/[\r\n,]+/g, " "),
      ].join(",")
    ),
  ].join("\n");

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${filename}"`);
  res.status(200).send(rows);
}

// --- list endpoints ---
r.get("/leads/warm", (_req, res) => {
  const warm = buckets().warm;
  const wantCsv = String(_req.query.format ?? "").toLowerCase() === "csv";
  if (wantCsv) return sendCsv(res, warm, "leads-warm.csv");
  const body: ApiOk<{ items: LeadItem[] }> = { ok: true, items: warm.map(map) };
  res.json(body);
});

r.get("/leads/hot", (_req, res) => {
  const hot = buckets().hot;
  const wantCsv = String(_req.query.format ?? "").toLowerCase() === "csv";
  if (wantCsv) return sendCsv(res, hot, "leads-hot.csv");
  const body: ApiOk<{ items: LeadItem[] }> = { ok: true, items: hot.map(map) };
  res.json(body);
});

// Friendly CSV aliases if your UI calls explicit .csv paths
r.get("/leads/warm.csv", (_req, res) => sendCsv(res, buckets().warm, "leads-warm.csv"));
r.get("/leads/hot.csv", (_req, res) => sendCsv(res, buckets().hot, "leads-hot.csv"));

// --- lock (warm/hot) from the panel ---
r.post("/leads/lock", (req: Request, res: Response) => {
  const host = String(req.body.host ?? "").trim().toLowerCase();
  let temp = String(req.body.temp ?? "warm").toLowerCase();
  if (!host) {
    const err: ApiErr = { ok: false, error: "host required" };
    return res.status(400).json(err);
  }
  if (!["warm", "hot", "cold"].includes(temp)) temp = "warm";

  const updated = replaceHotWarm(host, temp as any);
  const { watchers, competitors } = getWatchers(host);
  const body: ApiOk<{
    lead: LeadItem;
    watchers: string[];
    competitors: string[];
  }> = { ok: true, lead: map(updated), watchers, competitors };
  res.json(body);
});

// --- light “deepen” hook the UI uses (returns whatever we have) ---
r.post("/leads/deepen", (req: Request, res: Response) => {
  const host = String(req.body.host ?? "").trim().toLowerCase();
  if (!host) {
    const err: ApiErr = { ok: false, error: "host required" };
    return res.status(400).json(err);
  }
  const { watchers, competitors } = getWatchers(host);
  const lead = saveByHost(host); // ensure it exists
  const body: ApiOk<{
    lead: LeadItem;
    watchers: string[];
    competitors: string[];
  }> = { ok: true, lead: map(lead), watchers, competitors };
  res.json(body);
});

export default r;
