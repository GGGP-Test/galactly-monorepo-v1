/* eslint-disable no-console */
import { loadSeeds } from "../utils/seeds-loader"; // from earlier
import { URL } from "node:url";

// Minimal types compatible with earlier files
type LeadSeed = {
  name: string;
  website: string;
  region?: string;
  vertical?: string;
  reason?: string;
  signal?: string;
  source?: string;
};

function toDomain(urlOrHost: string): string | null {
  if (!urlOrHost) return null;
  const raw = urlOrHost.trim();
  try {
    const u = raw.startsWith("http") ? new URL(raw) : new URL(`https://${raw}`);
    return u.hostname.toLowerCase();
  } catch {
    // last resort: treat as host
    return raw.replace(/^https?:\/\//, "").split("/")[0].toLowerCase() || null;
  }
}

function validateSeed(r: LeadSeed): { ok: boolean; msg?: string } {
  if (!r.name?.trim()) return { ok: false, msg: "missing name" };
  const d = toDomain(r.website || "");
  if (!d) return { ok: false, msg: "invalid website" };
  // light blacklist: avoid obvious carriers & staffing that may be low-fit
  const banned = ["ups.com", "fedex.com"];
  if (banned.includes(d)) return { ok: false, msg: "banned domain" };
  return { ok: true };
}

// TODO: wire to your actual queue/pipeline
async function enqueueSeed(r: LeadSeed) {
  // Example: push to stdout JSONL for now
  console.log(JSON.stringify({ kind: "lead.seed", ts: Date.now(), payload: r }));
}

(async () => {
  try {
    const rows = await loadSeeds(); // reads /run/secrets/seeds.csv by default
    if (!rows.length) {
      console.error("No seeds loaded. Check SEEDS_FILE mount or CSV content.");
      process.exitCode = 2;
      return;
    }

    // Normalize + validate + dedupe
    const dedup = new Set<string>();
    const good: LeadSeed[] = [];
    const bad: { row: LeadSeed; reason: string }[] = [];

    for (const r of rows) {
      const domain = toDomain(r.website || "");
      const v = validateSeed(r);
      if (!v.ok) {
        bad.push({ row: r, reason: v.msg! });
        continue;
      }
      if (domain && !dedup.has(domain)) {
        dedup.add(domain);
        good.push({ ...r, website: domain });
      }
    }

    console.error(`Loaded: ${rows.length}, Valid: ${good.length}, Skipped: ${bad.length}`);

    // Emit work
    for (const r of good) {
      await enqueueSeed(r);
    }

    if (bad.length) {
      console.error("First few skipped rows:", bad.slice(0, 5));
    }
  } catch (err) {
    console.error("seed-import failed:", (err as Error).message);
    process.exitCode = 1;
  }
})();
