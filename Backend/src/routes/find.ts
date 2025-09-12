// Backend/src/routes/find.ts
//
// One-file “finder” that turns a supplierDomain (+ optional user hints)
// into a persona, micro-metrics, a calibrated score, and human-friendly WHY.
// No external deps; no fs reads; no LLM call here.
//
// Endpoint: POST /api/v1/leads/find-buyers
// Exports:  named mountFind(app: Express)

import type { Express, Request, Response } from "express";

// ----------------------------- Types ---------------------------------

type Temperature = "warm" | "hot";

type MetricKey =
  | "RPI"  // Right-size Pressure Index (dim weight, cartonization)
  | "DFS"  // DTC Footprint Score (ecom ops footprint)
  | "FEI"  // Fragility Exposure Index (damage risk/ISTA)
  | "CCI"  // Cold-Chain Indicator
  | "ST"   // Sustainability Tone
  | "ILL"  // Irregular Load Likelihood (pallet shapes, mixed SKUs)
  | "MWI"  // Machine-Wrap Index (throughput / automation language)
  | "NB"   // New Business momentum (launches, “new arrivals” tone)
  | "DCS"; // Distributed Cap Ship (multi-node, 3PL hints)

type Metric = {
  key: MetricKey;
  value: number;          // 0..1
  evidence: string[];     // tokens/phrases that triggered it
};

type Features = Record<MetricKey, Metric>;

type Persona = {
  productOffer: string;   // e.g., "Right-size corrugated programs"
  solves: string;         // e.g., "Cut DIM weight and damage"
  buyerTitles: string[];  // e.g., ["Fulfillment Ops Manager", ...]
  verticals?: string[];   // optional user hints
  regions?: string[];     // optional user hints
};

type WhyChip = {
  label: string;          // short label users can skim
  detail: string;         // plain-language explanation
  score?: number;         // optional: show metric value if relevant
};

type FindRequestBody = {
  supplierDomain: string;
  custom?: {
    productOffer?: string;
    solves?: string;
    buyerTitles?: string[];
    verticals?: string[];
    regions?: string[];
    knownCustomers?: string[]; // domains or names the user claims
    sampleLeads?: string[];    // optional pre-picked lead domains
  };
};

type FindResponse = {
  ok: true;
  supplierDomain: string;
  persona: Persona;
  features: Features;
  score: number;                // 0..1 calibrated
  temperature: Temperature;
  why: WhyChip[];
  // Finder does not return lead list; downstream “webscout” uses persona+features
};

// ------------------------ Utility: safe parsing ----------------------

function parseBody(req: Request): FindRequestBody | null {
  try {
    const b = req.body as any;
    if (!b || typeof b !== "object") return null;
    if (typeof b.supplierDomain !== "string" || !b.supplierDomain.trim()) return null;
    const body: FindRequestBody = {
      supplierDomain: b.supplierDomain.trim().toLowerCase(),
      custom: undefined,
    };
    if (b.custom && typeof b.custom === "object") {
      const c = b.custom;
      body.custom = {
        productOffer: typeof c.productOffer === "string" ? c.productOffer.trim() : undefined,
        solves: typeof c.solves === "string" ? c.solves.trim() : undefined,
        buyerTitles: Array.isArray(c.buyerTitles) ? c.buyerTitles.filter((x: any) => typeof x === "string") : undefined,
        verticals: Array.isArray(c.verticals) ? c.verticals.filter((x: any) => typeof x === "string") : undefined,
        regions: Array.isArray(c.regions) ? c.regions.filter((x: any) => typeof x === "string") : undefined,
        knownCustomers: Array.isArray(c.knownCustomers) ? c.knownCustomers.filter((x: any) => typeof x === "string") : undefined,
        sampleLeads: Array.isArray(c.sampleLeads) ? c.sampleLeads.filter((x: any) => typeof x === "string") : undefined,
      };
    }
    return body;
  } catch {
    return null;
  }
}

// --------------- Heuristics: tokenize + detect cues ------------------

function tokensFromText(...texts: (string | undefined)[]): string[] {
  const joined = texts.filter(Boolean).join(" ").toLowerCase();
  // Split on non-letters/digits, keep simple tokens
  return joined.split(/[^a-z0-9+]+/g).filter(Boolean);
}

function hasAny(tokens: string[], patterns: (string | RegExp)[]): string[] {
  const hits: string[] = [];
  for (const p of patterns) {
    if (typeof p === "string") {
      if (tokens.includes(p)) hits.push(p);
    } else {
      const m = tokens.join(" ").match(p);
      if (m) hits.push(m[0]);
    }
  }
  return hits;
}

// ------------------------ Metric builders (independent) --------------

function buildIndependentFeatures(tokens: string[]): Features {
  // Define canonical patterns per metric
  const P = {
    RPI: ["dim", "dimensional", "dim-weight", "dimensionalweight", "right-size", "rightsize", "cartonization", "cartonize"],
    DFS: ["shopify", "woocommerce", "bigcommerce", "checkout", "returns", "rma", "subscription", "dtc", "direct-to-consumer"],
    FEI: ["ista", "drop", "shock", "fragile", "damage", "breakage", "cushion", "void", "void-fill"],
    CCI: ["cold", "frozen", "refrigerated", "thermal", "insulated", "gel", "phase-change", "vaccine", "perishable"],
    ST:  ["recyclable", "recycled", "less", "reduce", "lightweight", "compostable", "sustainable", "lca"],
    ILL: ["mixed", "assorted", "odd", "irregular", "non-square", "unstable", "pallet", "palletizing", "palletized"],
    MWI: ["turntable", "pre-stretch", "prestretch", "automatic", "semi-automatic", "conveyor", "throughput", "cpm", "wrapping"],
    NB:  ["launch", "new", "now live", "grand", "opening", "just added", "now shipping"],
    DCS: ["3pl", "fulfillment", "node", "multi-node", "dc", "distribution", "ship-from-store", "micro-fulfillment"],
  };

  function metric(key: MetricKey, pats: string[], weight = 1): Metric {
    const hits = hasAny(tokens, pats);
    // value is a soft clip of unique hits; 1–2 hits = 0.35–0.6; 3+ = 0.8–1.0
    const uniq = Array.from(new Set(hits));
    const base =
      uniq.length === 0 ? 0 :
      uniq.length === 1 ? 0.35 :
      uniq.length === 2 ? 0.6 :
      uniq.length === 3 ? 0.8 : Math.min(1, 0.8 + 0.08 * (uniq.length - 3));
    return { key, value: Math.max(0, Math.min(1, base * weight)), evidence: uniq };
  }

  const features: Features = {
    RPI: metric("RPI", P.RPI),
    DFS: metric("DFS", P.DFS),
    FEI: metric("FEI", P.FEI),
    CCI: metric("CCI", P.CCI),
    ST:  metric("ST",  P.ST),
    ILL: metric("ILL", P.ILL),
    MWI: metric("MWI", P.MWI),
    NB:  metric("NB",  P.NB, 0.8), // tone-y; cap its influence
    DCS: metric("DCS", P.DCS),
  };

  // Interaction bonus examples (Olympiad-style “together it matters”)
  if (features.DFS.value > 0.5 && features.RPI.value > 0.5) {
    features.RPI.value = Math.min(1, features.RPI.value + 0.1); // DTC + right-size = stronger pressure
  }
  if (features.MWI.value > 0.4 && features.ILL.value > 0.4) {
    features.MWI.value = Math.min(1, features.MWI.value + 0.1); // machine wrap + irregular loads
  }

  return features;
}

// ----------------------- Metric builders (user hints) ----------------

function buildUserHintFeatures(custom: NonNullable<FindRequestBody["custom"]>): Features {
  const tokens = tokensFromText(
    custom.productOffer,
    custom.solves,
    ...(custom.buyerTitles || []),
    ...(custom.verticals || [])
  );
  const f = buildIndependentFeatures(tokens);

  // Light nudges from user titles/verticals:
  if (custom.buyerTitles?.some(t => /engineer|packaging/i.test(t))) {
    f.FEI.value = Math.min(1, f.FEI.value + 0.1);
  }
  if (custom.buyerTitles?.some(t => /(ops|operations|fulfillment)/i.test(t))) {
    f.DFS.value = Math.min(1, f.DFS.value + 0.1);
    f.MWI.value = Math.min(1, f.MWI.value + 0.05);
  }
  return f;
}

// -------------------------- Blending logic ---------------------------

// By default, we respect user hints (they know their biz) but leave room
// for independent signals to overrule strong mistakes.
const USER_WEIGHT = 0.90;
const INDEP_WEIGHT = 0.10;

// If independent evidence is very strong (>0.85) and user is weak (<0.25),
// allow a hard override up to this cap:
const OVERRIDE_DELTA = 0.35;

function blendFeatures(userF: Features | null, indepF: Features): Features {
  const out = {} as Features;
  (Object.keys(indepF) as MetricKey[]).forEach((k) => {
    const u = userF ? userF[k].value : 0;
    const i = indepF[k].value;
    let blended = USER_WEIGHT * u + INDEP_WEIGHT * i;

    // “Overrule” when independent is loud and user is quiet
    if (i > 0.85 && u < 0.25) {
      blended = Math.min(1, Math.max(blended, i - (1 - USER_WEIGHT) + OVERRIDE_DELTA));
    }

    out[k] = {
      key: k,
      value: Math.max(0, Math.min(1, blended)),
      evidence: Array.from(new Set([...(userF ? userF[k].evidence : []), ...indepF[k].evidence])),
    };
  });
  return out;
}

// -------------------------- Scoring math -----------------------------

// Global base weights (can be learned later; hand-tuned now)
const W: Record<MetricKey, number> = {
  RPI: 1.20,
  DFS: 1.05,
  FEI: 0.75,
  CCI: 0.70,
  ST:  0.40,
  ILL: 0.95,
  MWI: 0.90,
  NB:  0.35,
  DCS: 0.85,
};

function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function score(features: Features): number {
  // Interactions: DFS×RPI, ILL×MWI, FEI×DFS (small)
  const inter =
    0.60 * features.DFS.value * features.RPI.value +
    0.50 * features.ILL.value * features.MWI.value +
    0.25 * features.FEI.value * features.DFS.value;

  const lin =
    W.RPI * features.RPI.value +
    W.DFS * features.DFS.value +
    W.FEI * features.FEI.value +
    W.CCI * features.CCI.value +
    W.ST  * features.ST.value  +
    W.ILL * features.ILL.value +
    W.MWI * features.MWI.value +
    W.NB  * features.NB.value  +
    W.DCS * features.DCS.value;

  // Bias chosen so “neutral” lands ~0.45–0.55
  const z = -2.0 + lin + inter;
  return Number(logistic(z).toFixed(4));
}

function toTemperature(p: number): Temperature {
  return p >= 0.72 ? "hot" : "warm";
}

// -------------------------- Persona build ----------------------------

function buildPersona(domain: string, custom?: FindRequestBody["custom"]): Persona {
  // Start generic; overlay custom; overlay domain heuristics
  let productOffer = "Packaging programs";
  let solves = "Lower costs and damage; speed fulfillment";
  let buyerTitles = ["Operations Manager", "Procurement Manager"];

  if (custom?.productOffer) productOffer = custom.productOffer;
  if (custom?.solves) solves = custom.solves;
  if (custom?.buyerTitles?.length) buyerTitles = custom.buyerTitles;

  // Domain-based nuance (tiny heuristics, safe & deterministic)
  if (domain.includes("stretch")) {
    productOffer = custom?.productOffer || "Stretch film & pallet protection";
    solves = custom?.solves || "Stabilize loads and cut film waste";
    buyerTitles = custom?.buyerTitles || ["Warehouse Manager", "COO", "Procurement Manager"];
  }
  if (domain.includes("box") || domain.includes("pack") || domain.includes("corr")) {
    productOffer = custom?.productOffer || "Right-size corrugated & pack-out";
    solves = custom?.solves || "Reduce DIM weight, damage, and materials";
    buyerTitles = custom?.buyerTitles || ["Fulfillment Ops Manager", "Packaging Engineer", "Supply Chain Manager"];
  }

  return {
    productOffer,
    solves,
    buyerTitles,
    verticals: custom?.verticals,
    regions: custom?.regions,
  };
}

// ---------------------- WHY (plain-language) -------------------------

function whyFor(features: Features, persona: Persona): WhyChip[] {
  const chips: WhyChip[] = [];

  const push = (label: string, detail: string, score?: number) =>
    chips.push({ label, detail, score: score !== undefined ? Number(score.toFixed(2)) : undefined });

  // Show top-5 metrics by value, in friendly language
  const top = Object.values(features)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  for (const m of top) {
    if (m.key === "RPI") push("Right-size signals", "We see language about carton sizes / DIM weight. Those teams usually buy custom corrugate and pack-out services.", m.value);
    if (m.key === "DFS") push("DTC operations", "E-commerce and returns language suggests a direct-to-consumer flow needing steady packaging supply.", m.value);
    if (m.key === "MWI") push("Automation throughput", "Mentions of automatic/semi-auto wrap or conveyors indicate higher-volume ops that value machine-compatible materials.", m.value);
    if (m.key === "ILL") push("Irregular pallets", "Clues about mixed or unstable loads point to irregular pallets, which favors certain films and techniques.", m.value);
    if (m.key === "FEI") push("Fragile handling", "Fragility and test language (ISTA, drop, cushioning) means protection and box design matter more.", m.value);
    if (m.key === "DCS") push("Distributed shipping", "3PL or multi-node fulfillment cues mean they care about consistent supply across sites.", m.value);
    if (m.key === "CCI") push("Cold chain", "Cold/thermal keywords imply temperature-sensitive goods that need specialized materials.", m.value);
    if (m.key === "ST")  push("Sustainability pressure", "Claims about recycled/less material suggest sustainability goals you can support.", m.value);
    if (m.key === "NB")  push("Momentum", "‘New’/‘launch’ tone hints at growth or changes that often trigger packaging buys.", m.value);
  }

  // Tie back to persona in one clear sentence
  push(
    "Who to contact",
    `Based on the signals, your ideal contacts look like ${persona.buyerTitles.join(", ")}.`
  );

  return chips;
}

// ---------------------------- Route ----------------------------------

export function mountFind(app: Express) {
  app.post("/api/v1/leads/find-buyers", (req: Request, res: Response) => {
    const body = parseBody(req);
    if (!body) {
      return res.status(400).json({ ok: false, error: "bad request" });
    }

    const { supplierDomain, custom } = body;

    // Tokenize only the user-provided hints (independent evidence will come from webscout later).
    const userTokens = custom
      ? tokensFromText(
          custom.productOffer,
          custom.solves,
          ...(custom.buyerTitles || []),
          ...(custom.verticals || []),
          ...(custom.regions || [])
        )
      : [];

    // Build feature sets
    const indepFeatures = buildIndependentFeatures(userTokens); // for now, independent = structural language in hints
    const userFeatures = custom ? buildUserHintFeatures(custom) : null;
    const blended = blendFeatures(userFeatures, indepFeatures);

    // Persona
    const persona = buildPersona(supplierDomain, custom);

    // Score & temperature
    const p = score(blended);
    const temperature = toTemperature(p);

    // WHY chips
    const why = whyFor(blended, persona);

    const payload: FindResponse = {
      ok: true,
      supplierDomain,
      persona,
      features: blended,
      score: p,
      temperature,
      why,
    };

    return res.json(payload);
  });
}
