// src/index.ts
import express, { Request, Response } from "express";
import cors from "cors";
import * as mem from "./shared/memStore";

/* ----------------------------- types ----------------------------- */

type Temp = "hot" | "warm" | "cold";
type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;   // ISO
  temp?: Temp | string;
  whyText?: string;
  score?: number;     // 0..1 demo score
};
type ApiOk<T = unknown> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

/* ----------------------------- app ------------------------------ */

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* --------------- route registry (for /routes debug) ------------- */

const ROUTES: string[] = [];
function reg(method: string, path: string) {
  ROUTES.push(`${method.toUpperCase()} ${path}`);
}

/* ---------------------------- health ---------------------------- */

app.get("/healthz", (_req, res) => res.json({ ok: true, msg: "healthy" })); reg("get","/healthz");
app.get("/routes", (_req, res) => {
  res.json({ ok: true, routes: ROUTES.sort() });
}); reg("get","/routes");

/* ---------------------------- helpers --------------------------- */

function pickParams(req: Request) {
  const q = Object.assign({}, req.query, req.body);
  const rawHost = String(q.host ?? "").trim();
  const host = normalizeHost(rawHost);
  const region = String(q.region ?? "").trim() || "US/CA";
  const radius = String(q.radius ?? "").trim() || "50 mi";
  const topK = Number(q.topK ?? 1) || 1;
  return { host, region, radius, topK };
}

function sendBad(res: Response, error: string, code = 400) {
  const body: ApiErr = { ok: false, error };
  return res.status(code).json(body);
}

function nowISO() {
  return new Date().toISOString();
}
function normalizeHost(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

// tiny deterministic PRNG (stable per host+region+radius)
function seedFrom(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}
function rand01(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return (s >>> 0) / 0xffffffff;
  };
}
function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function scoreFor(host: string, region: string, radius: string): { score: number; temp: Temp; whyText: string; title: string } {
  const base = host.includes("pack") || host.includes("wrap") || host.includes("film") ? 0.25 : 0.05;
  const bumps = ["warehouse","fulfill","logistic","distrib","supply","pallet","ship"];
  let bump = 0;
  for (const b of bumps) if (host.includes(b)) bump += 0.05;

  const s = seedFrom(host + "::" + region + "::" + radius);
  const r = rand01(s);
  const jitter = r() * 0.4;
  const score = Math.max(0, Math.min(1, base + bump + jitter));

  let temp: Temp = "warm";
  if (score >= 0.7) temp = "hot";
  else if (score < 0.4) temp = "cold";

  const titles = [
    "Purchasing Manager",
    "Warehouse Operations",
    "Supply Chain Lead",
    "Plant Manager",
    "Materials Manager",
    "Logistics Coordinator"
  ];
  const title = `${pick(r, titles)} @ ${host}`;

  const whyText =
    temp === "hot"
      ? "Strong buying signals in your region (time-sensitive)."
      : temp === "warm"
        ? "Operational fit detected; likely periodic packaging needs."
        : "Weak signals; might still be relevant for outreach.";

  return { score, temp, whyText, title };
}

// deterministic single lead
async function findOneBuyer(host: string, region: string, radius: string): Promise<LeadItem> {
  const { score, temp, whyText, title } = scoreFor(host, region, radius);
  return {
    host,
    platform: "web",
    title,
    created: nowISO(),
    temp,
    whyText,
    score: Number(score.toFixed(3)),
  };
}

// generate up to k variations (slight radius tweaks)
async function deepen(host: string, region: string, radius: string, k: number): Promise<LeadItem[]> {
  const baseMi = Math.max(10, parseInt(String(radius).replace(/\D+/g, "") || "50", 10));
  const variants = [0, 15, -10, 30, -20].slice(0, Math.max(1, Math.min(3, k)));
  const outs: LeadItem[] = [];
  for (const dv of variants) {
    const rad = `${Math.max(10, baseMi + dv)} mi`;
    const item = await findOneBuyer(host, region, rad);
    outs.push(item);
  }
  // de-dupe by (title+whyText)
  const seen = new Set<string>();
  return outs.filter(x => {
    const key = (x.title || "") + "||" + (x.whyText || "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------ core handlers -------------------------- */

async function handleFind(req: Request, res: Response) {
  const { host, region, radius } = pickParams(req);
  if (!host) return sendBad(res, "host is required");

  try {
    const item = await findOneBuyer(host, region, radius);

    // persist in memory store for later list/CSV/etc
    const temp: Temp = (item.temp === "hot" || item.temp === "cold") ? item.temp : "warm";
    mem.saveByHost(host, {
      title: item.title,
      platform: item.platform || "web",
      created: item.created || nowISO(),
      temperature: temp,
      why: item.whyText,
      saved: true,
    });

    const body: ApiOk<{ items: LeadItem[] }> = { ok: true, items: [item] };
    return res.json(body);
  } catch (e: any) {
    return sendBad(res, e?.message ?? "internal error", 500);
  }
}

async function handleLock(req: Request, res: Response) {
  const host = normalizeHost(String(req.body?.host || req.query?.host || ""));
  const to = String(req.body?.temp || req.query?.temp || "warm").toLowerCase() as Temp;
  if (!host) return sendBad(res, "host is required");

  const updated = mem.replaceHotWarm(host, (to === "hot" || to === "cold") ? to : "warm");
  const fomo = demoFOMO(host);
  const body: ApiOk<{ lead: mem.StoredLead; fomo: typeof fomo }> = { ok: true, lead: updated, fomo };
  return res.json(body);
}

async function handleDeepen(req: Request, res: Response) {
  const { host, region, radius, topK } = pickParams(req);
  if (!host) return sendBad(res, "host is required");
  const items = await deepen(host, region, radius, topK);
  // do not overwrite mem store here; client may choose what to save
  const body: ApiOk<{ items: LeadItem[] }> = { ok: true, items };
  return res.json(body);
}

/* ---------------------------- FOMO demo -------------------------- */

// returns a small non-zero viewer/competitor count to avoid showing "0"
function demoFOMO(host: string) {
  // stable per host + lightly time-varying
  const t = Math.floor(Date.now() / 60000); // minute bucket
  const r = rand01(seedFrom(host + "::" + t));
  // fewer at night (fake day partition)
  const hour = new Date().getHours();
  const base = (hour >= 22 || hour <= 6) ? 1 : 3;
  const watchers = base + Math.floor(r() * 4);     // 1..6
  const competitors = Math.max(1, Math.floor(watchers / 2)); // 1..3
  return { watchers, competitors };
}

/* ---------------------- compat path mounting --------------------- */

function mountCompat(root = "") {
  const base = (p: string) => (root ? `/${root.replace(/^\/+|\/+$/g, "")}${p}` : p);

  // FIND (GET/POST)
  const findPaths = [
    "/leads/find-buyers", "/buyers/find-buyers", "/find-buyers",
    "/leads/find", "/buyers/find", "/find",
    "/leads/find-one", "/buyers/find-one", "/find-one",
  ];
  for (const p of findPaths) {
    app.get(base(p), handleFind);  reg("get",  base(p));
    app.post(base(p), handleFind); reg("post", base(p));
  }

  // LOCK (POST only)
  const lockPaths = ["/leads/lock", "/buyers/lock", "/lock"];
  for (const p of lockPaths) {
    app.post(base(p), handleLock); reg("post", base(p));
  }

  // DEEPEN (POST only)
  const deepPaths = ["/leads/deepen", "/buyers/deepen", "/deepen"];
  for (const p of deepPaths) {
    app.post(base(p), handleDeepen); reg("post", base(p));
  }

  // simple index to show alive at this root
  app.get(base("/"), (_req, res) => res.json({ ok: true, root: root || "(root)" })); reg("get", base("/"));
}

// mount on common roots the panel probes
mountCompat("");        // /
mountCompat("api");     // /api
mountCompat("api/v1");  // /api/v1
mountCompat("v1");      // /v1

/* --------------------------- listen ------------------------------ */

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api listening on :${PORT}`);
});

export default app;