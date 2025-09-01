// Backend/src/connectors/why.ts
// --------------------------------------------
// Purpose: build a "Why this lead" bundle with clear, human-readable
// reasoning bullets, lightweight estimates, and proof links.
// Works purely on data we already store (lead_pool rows) plus
// simple heuristics; no paid APIs. Safe to run on Northflank free tier.

import { q } from "../db";

// --- Types ---
export type WhyReason = {
  key: string;                 // stable id (e.g., "ads_active", "case_packs")
  label: string;               // short label for the UI chip
  weight: number;              // 0..1 contribution to heat/fit
  evidence: string;            // one-liner used in the modal
  proofUrl?: string | null;    // where a user can click to verify (optional in free)
};

export type WhyEstimates = {
  adSpendUsdMin?: number;
  adSpendUsdMax?: number;
  unitsPerOrder?: number;      // inferred from pack/case text on PDPs
  monthlyOrderBands?: string;  // lightweight band (e.g., "100–300 orders/mo")
  packagingTypeHint?: string;  // label/corrugated/sleeve/shrink/Strech, etc.
  queueWindow?: string;        // e.g., "Now–2 weeks" if demand looks elevated
};

export type WhyBundle = {
  ok: true;
  leadId: number;
  domain: string;
  heat: number;
  summary: string;             // 1–2 sentence summarization for the header
  reasons: WhyReason[];        // sorted by weight desc
  estimates: WhyEstimates;
  sources: {
    adProofUrls: string[];
    pdpUrls: string[];
    intakeUrls: string[];
    related: { id: number; platform: string | null; title: string | null; url: string }[];
  };
};

// --- Helpers ---
function hostFrom(url?: string | null): string {
  try { return url ? new URL(url).hostname.toLowerCase() : ""; } catch { return ""; }
}

function containsAny(text: string, needles: string[]): boolean {
  const t = text.toLowerCase();
  return needles.some(n => t.includes(n.toLowerCase()));
}

function pickUnitsFromText(text: string): number | undefined {
  // Try to pull numbers like "12-pack", "Pack of 8", "Case of 24"
  const t = text.toLowerCase();
  const m1 = t.match(/(pack|case)\s*of\s*(\d{1,3})/i);
  if (m1) return Number(m1[2]);
  const m2 = t.match(/(\d{1,3})\s*-(?:pack|ct|count)/i);
  if (m2) return Number(m2[1]);
  const m3 = t.match(/(\d{1,3})\s*x\s*\d{1,3}\s*(?:ml|oz|g)/i); // 12 x 355ml
  if (m3) return Number(m3[1]);
  return undefined;
}

function band(n?: number): string | undefined {
  if (!n || !Number.isFinite(n)) return undefined;
  if (n < 50) return "<50/mo";
  if (n < 100) return "50–100/mo";
  if (n < 300) return "100–300/mo";
  if (n < 600) return "300–600/mo";
  if (n < 1200) return "600–1.2k/mo";
  return ">1.2k/mo";
}

function toMoney(n?: number): number | undefined {
  if (!n || !Number.isFinite(n)) return undefined;
  return Math.round(n);
}

// --- Lightweight ad spend heuristic ---
// We keep it inside this file to avoid hard dependency on other modules.
// If you already created connectors/spend.ts with richer logic, you can swap it in.
function estimateAdSpendFromProofUrls(proofs: string[]): { min?: number; max?: number } {
  // Heuristic: presence of both Meta and Google proofs bumps range; otherwise conservative.
  const hasMeta = proofs.some(u => u.includes("facebook.com/ads/library"));
  const hasGoogle = proofs.some(u => u.includes("adstransparency.google.com") || u.includes("site:adstransparency.google.com"));
  if (hasMeta && hasGoogle) return { min: 3000, max: 12000 };
  if (hasMeta || hasGoogle) return { min: 1500, max: 6000 };
  return {};
}

// --- Main ---
export async function buildWhy(leadId: number): Promise<WhyBundle> {
  // 1) Pull the lead
  const r = await q<any>(
    `SELECT id, cat, kw, platform, heat, source_url, title, snippet, created_at
       FROM lead_pool WHERE id=$1 LIMIT 1`,
    [leadId]
  );
  if (!r.rowCount) {
    // Return a harmless minimal bundle; caller can 404 if desired
    return {
      ok: true,
      leadId,
      domain: "",
      heat: 0,
      summary: "",
      reasons: [],
      estimates: {},
      sources: { adProofUrls: [], pdpUrls: [], intakeUrls: [], related: [] }
    };
  }
  const L = r.rows[0] as {
    id: number; cat: string | null; kw: string[] | null; platform: string | null;
    heat: number | null; source_url: string; title: string | null; snippet: string | null;
  };

  const domain = hostFrom(L.source_url);
  const text = `${L.title || ""} ${L.snippet || ""}`;
  const reasons: WhyReason[] = [];
  const sources = { adProofUrls: [] as string[], pdpUrls: [] as string[], intakeUrls: [] as string[], related: [] as { id: number; platform: string | null; title: string | null; url: string }[] };

  // 2) Seed reason from the current lead/platform
  if ((L.platform || "").toLowerCase() === "adlib_free") {
    reasons.push({
      key: "ads_active",
      label: "Active customer acquisition",
      weight: 0.40,
      evidence: "Brand appears in ad transparency libraries (Meta/Google).",
      proofUrl: L.source_url
    });
    sources.adProofUrls.push(L.source_url);
  } else if ((L.platform || "").toLowerCase() === "pdp") {
    const units = pickUnitsFromText(text);
    reasons.push({
      key: units ? "case_packs" : "pdp_signal",
      label: units ? `Case/Pack signal: ~${units}/order` : "Product demand signal",
      weight: units ? 0.35 : 0.25,
      evidence: units ? `Detail page mentions ~${units} per order (pack/case).` : "Product page suggests active DTC inventory.",
      proofUrl: L.source_url
    });
    sources.pdpUrls.push(L.source_url);
  } else if ((L.platform || "").toLowerCase() === "brandintake") {
    reasons.push({
      key: "intake_open",
      label: "Open supplier intake",
      weight: 0.45,
      evidence: "Brand lists Procurement/Supplier/Vendor portal.",
      proofUrl: L.source_url
    });
    sources.intakeUrls.push(L.source_url);
  } else {
    // Generic catch-all
    reasons.push({ key: "recent_signal", label: "Recent signal", weight: 0.15, evidence: "Fresh lead from public sources.", proofUrl: L.source_url });
  }

  // 3) Pull a few related proof rows for the same domain to strengthen the case
  if (domain) {
    const rel = await q<any>(
      `SELECT id, platform, title, source_url FROM lead_pool
         WHERE source_url ILIKE $1 AND id <> $2
         ORDER BY created_at DESC LIMIT 10`,
      [`%://${domain}%`, L.id]
    );
    for (const row of rel.rows) {
      const p = (row.platform || "").toLowerCase();
      if (p === "adlib_free") sources.adProofUrls.push(row.source_url);
      if (p === "pdp") sources.pdpUrls.push(row.source_url);
      if (p === "brandintake") sources.intakeUrls.push(row.source_url);
      sources.related.push({ id: row.id, platform: row.platform, title: row.title, url: row.source_url });
    }
  }

  // 4) Derive rough estimates
  const est: WhyEstimates = {};
  // 4a) Ad spend band if any ad proofs exist
  if (sources.adProofUrls.length) {
    const { min, max } = estimateAdSpendFromProofUrls(sources.adProofUrls);
    est.adSpendUsdMin = toMoney(min);
    est.adSpendUsdMax = toMoney(max);
    if (min || max) {
      reasons.push({
        key: "demand_investment",
        label: "Investing in demand",
        weight: 0.25,
        evidence: `Monthly paid reach estimated ${min ? `$${min.toLocaleString()}` : ""}${min && max ? "–" : ""}${max ? `$${max.toLocaleString()}` : ""}.`
      });
    }
  }

  // 4b) Units/order from PDP if visible anywhere
  if (!est.unitsPerOrder) {
    for (const url of [L.source_url, ...sources.pdpUrls]) {
      const t = `${L.title || ""} ${L.snippet || ""}`; // we only have title/snippet in DB; deeper scrape lives elsewhere
      const u = pickUnitsFromText(t);
      if (u) { est.unitsPerOrder = u; break; }
    }
  }

  // 4c) Very coarse order band based on signals observed
  const baseOrders = sources.pdpUrls.length >= 2 ? 180 : sources.pdpUrls.length === 1 ? 90 : 40;
  const demandBoost = sources.adProofUrls.length >= 2 ? 1.7 : sources.adProofUrls.length === 1 ? 1.3 : 1.0;
  const ordersEst = Math.round(baseOrders * demandBoost);
  est.monthlyOrderBands = band(ordersEst);

  // 4d) Packaging hint
  const lower = text.toLowerCase();
  if (containsAny(lower, ["can", "12oz", "355ml"])) est.packagingTypeHint = "Beverage can secondary (tray/corrugate) + labels";
  else if (containsAny(lower, ["jar", "lid"])) est.packagingTypeHint = "Jar labels + corrugated shipper";
  else if (containsAny(lower, ["gummy", "chew", "pouch"])) est.packagingTypeHint = "Pouch/film + labels + shipper";

  // 4e) Queue window: if intake open or strong ads+PDP, push sooner
  const strong = sources.intakeUrls.length > 0 || (sources.adProofUrls.length && sources.pdpUrls.length);
  est.queueWindow = strong ? "Now–2 weeks" : "2–6 weeks";

  // 5) Compose summary
  const pfx = domain ? domain.replace(/^www\./, "") : "This brand";
  const spendTxt = est.adSpendUsdMin || est.adSpendUsdMax ? ` is actively acquiring customers ($${(est.adSpendUsdMin||est.adSpendUsdMax||0).toLocaleString()}+ / mo)` : " has recent buying signals";
  const pdpTxt = sources.pdpUrls.length ? ` and sells in ${est.unitsPerOrder ? `${est.unitsPerOrder}-packs` : "packs"}` : "";
  const intakeTxt = sources.intakeUrls.length ? "; supplier intake is open" : "";
  const summary = `${pfx}${spendTxt}${pdpTxt}${intakeTxt}.`;

  // 6) Sort reasons by weight desc and cap the list (UI can show top N)
  reasons.sort((a, b) => b.weight - a.weight);

  return {
    ok: true,
    leadId: L.id,
    domain,
    heat: Number(L.heat || 0),
    summary,
    reasons,
    estimates: est,
    sources
  };
}

// Optional convenience: build why by URL/domain (used when you bucket multiple proofs to one brand)
export async function buildWhyByDomain(domainOrUrl: string): Promise<WhyBundle | null> {
  const host = hostFrom(domainOrUrl);
  if (!host) return null;
  const r = await q<any>(
    `SELECT id FROM lead_pool WHERE source_url ILIKE $1 ORDER BY created_at DESC LIMIT 1`,
    [ `%://${host}%` ]
  );
  if (!r.rowCount) return null;
  return buildWhy(r.rows[0].id as number);
}
