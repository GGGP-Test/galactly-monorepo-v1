// scripts/ads-sync.mjs
// Pushes ads intelligence into your API via /api/ads/bulk.
// Reads ./docs/ads-sources.json if present (optional). Safe no-op if empty.
//
// Run locally:  node scripts/ads-sync.mjs
// Used by CI:   .github/workflows/ads-sync.yml

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env.API_BASE?.replace(/\/+$/,"")
  || "https://p01--animated-cellar--vz4ftkwrzdfs.code.run/api";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

if (!ADMIN_TOKEN) {
  console.error("Missing ADMIN_TOKEN env.");
  process.exit(0); // soft exit (safe on forks/PRs)
}

const SOURCES_FILE = path.join(__dirname, "..", "docs", "ads-sources.json");

// Helper: POST JSON
async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": ADMIN_TOKEN
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, data };
}

// Try to load sources file (optional)
async function loadSources() {
  try {
    const raw = await fs.readFile(SOURCES_FILE, "utf8");
    const j = JSON.parse(raw);
    if (Array.isArray(j?.items)) return j.items;
  } catch {}
  return [];
}

// Normalize a row (very light)
function normHost(s="") {
  return s.toLowerCase().replace(/^https?:\/\//,"").replace(/\/.*$/,"");
}

// Build bulk payload
async function buildPayload() {
  const items = await loadSources();
  // Expected shape per item:
  // { host: "brand.com", rows: [{ platform:"meta", landing:"https://...", seenAtISO:"2025-10-03T20:33:00Z" }, ...] }
  const bulk = [];
  for (const it of items) {
    const host = normHost(it?.host || "");
    const rows = Array.isArray(it?.rows) ? it.rows : [];
    if (!host || !rows.length) continue;
    bulk.push({ host, rows });
  }
  return { items: bulk };
}

(async () => {
  const payload = await buildPayload();
  if (!payload.items.length) {
    console.log("ads-sync: no items; nothing to push.");
    return;
  }

  const url = `${API_BASE}/ads/bulk`;
  try {
    const r = await post(url, payload);
    if (r.status === 404) {
      console.log("ads-sync: /ads/bulk not mounted yet (index.ts wiring pending). Skipping.");
      return;
    }
    console.log("ads-sync:", r.status, JSON.stringify(r.data).slice(0, 500));
  } catch (e) {
    console.error("ads-sync failed:", e);
    process.exit(1);
  }
})();