// src/index.ts
import express, { Request, Response } from "express";
import cors from "cors";
import buyers from "./routes/buyers";
import { saveByHost } from "./shared/memStore";

// --- types the panel expects back ---
type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;
  temp?: "hot" | "warm" | "cold" | string;
  whyText?: string;
};
type ApiOk = { ok: true; items: LeadItem[] };
type ApiErr = { ok: false; error: string };

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// mount our buyers/leads API under /api
app.use("/api", buyers);

// keep a registry so /routes can show what's mounted
const ROUTES: string[] = [];
function reg(method: string, fullPath: string) {
  ROUTES.push(`${method.toUpperCase()} ${fullPath}`);
}

// ---------- health ----------
app.get("/healthz", (_req, res) => res.json({ ok: true, msg: "healthy" }));

app.get("/routes", (_req, res) => {
  res.json({ ok: true, routes: ROUTES.sort() });
});

// ---------- helpers ----------
function pickParams(req: Request) {
  const q = Object.assign({}, req.query, req.body);
  const host = String(q.host ?? "").trim().toLowerCase();
  const region = String(q.region ?? "").trim() || "US/CA";
  const radius = String(q.radius ?? "").trim() || "50 mi";
  return { host, region, radius };
}

function sendBad(res: Response, error: string, code = 400) {
  const body: ApiErr = { ok: false, error };
  return res.status(code).json(body);
}

// This is the single place you can later swap with your real finder.
async function findOneBuyer(host: string, region: string, radius: string): Promise<LeadItem> {
  // TEMP compat response so the UI unblocks; replace with real lookup.
  return {
    host,
    platform: "web",
    title: `Buyer lead for ${host}`,
    created: new Date().toISOString(),
    temp: "warm",
    whyText: `Compat shim matched (${region}, ${radius})`,
  };
}

async function handleFind(req: Request, res: Response) {
  const { host, region, radius } = pickParams(req);
  if (!host) return sendBad(res, "host is required");

  try {
    // 1) get a lead
    const item = await findOneBuyer(host, region, radius);

    // 2) persist it into the in-memory store so the panel can Lock/Deepen/CSV it
    saveByHost(host, {
      host,
      title: item.title,
      platform: item.platform ?? "web",
      created: item.created ?? new Date().toISOString(),
      temperature: (item.temp as any) === "hot" ? "hot" : "warm",
      why: item.whyText ?? `Compat shim matched (${region}, ${radius})`,
      saved: false,
    });

    // 3) return panel-shaped payload
    const body: ApiOk = { ok: true, items: [item] };
    return res.json(body);
  } catch (e: any) {
    return sendBad(res, e?.message ?? "internal error", 500);
  }
}

// Mount a full set of compat paths under several possible roots.
function mountCompat(root = "") {
  const base = (p: string) => (root ? `/${root.replace(/^\/+|\/+$/g, "")}${p}` : p);

  const paths = [
    "/leads/find-buyers",
    "/buyers/find-buyers",
    "/find-buyers",
    "/leads/find",
    "/buyers/find",
    "/find",
    "/leads/find-one",
    "/buyers/find-one",
    "/find-one",
  ];

  for (const p of paths) {
    app.get(base(p), handleFind);
    reg("GET", base(p));
    app.post(base(p), handleFind);
    reg("POST", base(p));
  }

  // optional simple index to show it's alive under this root
  app.get(base("/"), (_req, res) => res.json({ ok: true, root: root || "(root)" }));
  reg("GET", base("/"));
}

// mount on common roots the panel probes
mountCompat(""); // /
mountCompat("api"); // /api
mountCompat("api/v1"); // /api/v1
mountCompat("v1"); // /v1

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api compat listening on :${PORT}`);
});