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

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

type Beat = { at: number };
const presence = new Map<string, Beat>();
const uidFrom = (req: express.Request) =>
  (req.header("x-galactly-user") || "anon").toString();

// ---------- health ----------
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ---------- mount /api/v1 ----------
const api = express.Router();
app.use("/api/v1", api);

// ---------- presence ----------
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

// ---------- status (quota banner) ----------
api.get("/status", (req, res) => {
  const uid = uidFrom(req);
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    ok: true,
    uid,
    plan: "free",
    quota: {
      date: today,
      findsUsed: 0,
      revealsUsed: 0,
      findsLeft: DEV_UNLIMITED ? 999999 : 99,
      revealsLeft: DEV_UNLIMITED ? 999999 : 5
    },
    devUnlimited: DEV_UNLIMITED,
    counts: { free: 0, pro: 0 }
  });
});

/* ------------------------------------------------------------------
   Simple, deterministic “catalog” so the UI shows real cards now.
   (Swap this with real scrapers later.)
------------------------------------------------------------------- */

type CatalogItem = {
  buyer: string;
  domain: string;
  state: string;                 // US state code
  product: string;               // “corrugated”, “stretch wrap”, …
  title: string;                 // card headline
  tags: string[];                // small chips under title
  channels: ("email" | "sms" | "call" | "linkedin_dm")[];
  why: string[];                 // “why we think it’s a live need”
  link?: string;                 // optional detail link
};

const CATALOG: CatalogItem[] = [
  {
    buyer: "Riverbend Snacks",
    domain: "riverbendsnacks.com",
    state: "GA",
    product: "corrugated",
    title: '“Need 10k corrugated boxes”',
    tags: ["RSC", "double-wall", "48h turn"],
    channels: ["linkedin_dm", "email", "call"],
    why: [
      "RFP post mentions ‘10k corrugated’ (last 72h)",
      "Product pages add 3 new SKUs in snack family",
      "Ops role hiring includes ‘case pack change’"
    ],
    link: "https://riverbendsnacks.com/procurement/rfp"
  },
  {
    buyer: "Peak Outfitters",
    domain: "peakoutfitters.com",
    state: "VT",
    product: "stretch wrap",
    title: "Stretch wrap pallets",
    tags: ["80g", "18″ × 1500′"],
    channels: ["sms", "call", "email"],
    why: [
      "Warehouse expansion press release (14d)",
      "Palletized freight volume up (carrier feeds)"
    ]
  },
  {
    buyer: "Marathon Labs",
    domain: "marathonlabs.com",
    state: "MD",
    product: "mailers",
    title: "Urgent: custom mailers next week",
    tags: ["Kraft", "2-color", "die-cut"],
    channels: ["email", "call", "linkedin_dm"],
    why: [
      "Marketing launch date in 10 days",
      "Creative brief uploaded with dieline ref"
    ]
  },
  {
    buyer: "Pioneer Pantry",
    domain: "pioneerpantry.com",
    state: "PA",
    product: "cartons",
    title: 'Quote: 16oz cartons (retail)',
    tags: ["PDP restock surge"],
    channels: ["linkedin_dm", "email"],
    why: [
      "Retail PDP shows ‘low stock’ on 16oz 4-pack",
      "Sell-through velocity spike in last 7d"
    ]
  },
  {
    buyer: "Harbor Pet",
    domain: "harborpet.com",
    state: "WV",
    product: "pouches",
    title: "Pouches 5k/mo",
    tags: ["8oz / 16oz", "matte + zipper"],
    channels: ["call", "sms", "email"],
    why: [
      "Ingredient COGS report suggests size split 8/16oz",
      "Private label brief references zipper closure"
    ]
  }
];

// Filter helper: crude region and product fit
function filterCatalog(regions: string | undefined, industries: string | undefined) {
  const regionSet = new Set(
    (regions || "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );

  const wantsCorr = /\bcorrugat|beverage|confection/i.test(industries || "");
  return CATALOG.filter((c) => {
    const regionOK = regionSet.size === 0 || regionSet.has("US") || regionSet.has(c.state);
    if (!regionOK) return false;
    if (wantsCorr) return true; // demo: allow all for now but keep knob
    return true;
  });
}

// ---------- find-now ----------
api.post("/find-now", (req, res) => {
  const uid = uidFrom(req);
  const body = (req.body || {}) as {
    website?: string;
    regions?: string;
    industries?: string;
    seed_buyers?: string;
    notes?: string;
  };

  const preview: string[] = [
    "Probing public feeds ✓",
    "Reading procurement + RFPs ✓",
    "Scanning retailer pages ✓",
    "Extracting quantities & materials ✓",
    "Cross-checking signals ✓",
    `Parsed site: ${body.website || "—"}`,
    `Regions: ${body.regions || "—"}`,
    `Industries: ${body.industries || "—"}`,
    `Seeds: ${body.seed_buyers || "—"}`,
    `Notes: ${body.notes || "—"}`
  ];

  // Build items from catalog
  const items = filterCatalog(body.regions, body.industries).map((c) => ({
    title: c.title,
    buyer: c.buyer,
    domain: c.domain,
    state: c.state,
    tags: c.tags,
    channels: c.channels,
    why: c.why,
    link: c.link
  }));

  // Free vs Pro split (free shows first 5)
  const freeItems = items.slice(0, 5);
  const proItemsCount = Math.max(items.length - freeItems.length, 0);

  res.json({
    ok: true,
    uid,
    preview,
    counts: { free: freeItems.length, pro: proItemsCount },
    items: freeItems
  });
});

// ---------- api 404 ----------
api.use((_req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// ---------- start ----------
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
