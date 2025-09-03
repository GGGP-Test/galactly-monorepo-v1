import express from "express";
import cors from "cors";

const app = express();
const PORT = Number(process.env.PORT || 8787);

// ===== config =====
const DEV_UNLIMITED =
  process.env.DEV_UNLIMITED === "1" ||
  process.env.DEV_UNLIMITED === "true" ||
  false;

// ===== middleware =====
app.use(
  cors({
    origin: true,
    credentials: false,
    allowedHeaders: ["content-type", "x-galactly-user"]
  })
);
app.use(express.json({ limit: "1mb" }));

// very tiny logger (avoid morgan)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===== in-memory presence =====
type Beat = { at: number };
const presence = new Map<string, Beat>();

function uidFrom(req: express.Request) {
  return (req.header("x-galactly-user") || "anon").toString();
}

// ===== health for platform probe =====
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ===== base prefix =====
const api = express.Router();
app.use("/api/v1", api);

// ===== presence =====
api.get("/presence/online", (req, res) => {
  const uid = uidFrom(req);
  presence.set(uid, { at: Date.now() });
  res.json({ ok: true, uid, online: true });
});

api.get("/presence/beat", (req, res) => {
  const uid = uidFrom(req);
  presence.set(uid, { at: Date.now() });
  res.json({ ok: true, uid, beat: Date.now() });
});

// ===== status (quota banner on UI) =====
api.get("/status", (req, res) => {
  const uid = uidFrom(req);
  const today = new Date().toISOString().slice(0, 10);

  // simple demo quota (always unlimited when DEV_UNLIMITED=1)
  const quota = {
    date: today,
    findsUsed: 0,
    revealsUsed: 0,
    findsLeft: DEV_UNLIMITED ? 999999 : 99,
    revealsLeft: DEV_UNLIMITED ? 999999 : 5
  };

  res.json({
    ok: true,
    uid,
    plan: "free",
    quota,
    devUnlimited: DEV_UNLIMITED,
    counts: { free: 0, pro: 0 }
  });
});

// ===== find-now (always 200; returns empty items unless you plug real fetchers) =====
api.post("/find-now", (req, res) => {
  const uid = uidFrom(req);
  const body = (req.body || {}) as {
    website?: string;
    regions?: string;
    industries?: string;
    seed_buyers?: string;
    notes?: string;
  };

  // Preview lines shown in the right column (UI keeps last 6)
  const preview = [
    `Parsed site: ${body.website || "—"}`,
    `Regions: ${body.regions || "—"}`,
    `Industries: ${body.industries || "—"}`,
    `Seeds: ${body.seed_buyers || "—"}`,
    `Notes: ${body.notes || "—"}`,
    `Running scrapers…`
  ];

  // Return an empty set to avoid “demo leads”; UI is ready to render if you add real items here.
  const items: any[] = [];

  res.json({
    ok: true,
    uid,
    preview,
    counts: { free: 0, pro: 0 },
    items
  });
});

// ===== 404 fallback (under api prefix) =====
api.use((_req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// ===== start =====
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
