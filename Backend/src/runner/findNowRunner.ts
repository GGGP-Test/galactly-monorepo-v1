// backend/src/runner/findNowRunner.ts
// Kicks off a single “find now” task, streams preview lines + scored leads into the global bus.
// It uses the available connectors if present; missing connectors are safely ignored.

import type { Request } from "express";

type PreviewFn = (taskId: string, line: string) => void;
type LeadFn = (taskId: string, lead: any) => void;

type Ctx = {
  putPreview: PreviewFn;
  putLead: LeadFn;
  tasks: Map<string, TaskState>;
};

type TaskState = {
  id: string;
  startedAt: number;
  website: string;
  regions: string;
  industries: string;
  seeds: string[];
  notes: string;
  // lifecycle
  done?: boolean;
  error?: string;
};

declare global {
  // created in index.ts
  // eslint-disable-next-line no-var
  var __GAL: {
    tasks: Map<string, TaskState>;
    putPreview: PreviewFn;
    putLead: LeadFn;
  };
}

// ——— helpers ————————————————————————————————————————————————
function ctxFromGlobal(): Ctx {
  const g = (globalThis as any).__GAL;
  if (!g) throw new Error("global bus missing");
  return { tasks: g.tasks, putPreview: g.putPreview, putLead: g.putLead };
}

function safe<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  return fn().catch((e) => {
    const msg = e?.message || String(e);
    const g = (globalThis as any).__GAL;
    if (g?.putPreview && currentTaskId) {
      g.putPreview(currentTaskId, `⚠︎ ${label} skipped (${msg})`);
    }
    return undefined;
  });
}

let currentTaskId = "";

// ——— dynamic connector loaders (optional) ————————————————
async function load<T = any>(p: string): Promise<T | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(p) as T;
  } catch {
    return undefined;
  }
}

type Lead = {
  company_domain?: string;
  domain?: string;
  brand?: string;
  state?: string;
  region?: string;
  source?: string;
  url?: string;
  material?: string;
  package?: string;
  category?: string;
  qty?: string | number;
  deadline?: string;
  intent?: string;
  title?: string;
};

// Map raw to a simple UI-friendly shape (frontend also has its own mapper; this keeps why-data rich)
function normalizeLead(raw: Lead) {
  const buyer =
    raw.company_domain || raw.domain || raw.brand || "unknown-company";
  const state = (raw.state || raw.region || "").toUpperCase();
  const intent =
    raw.intent || raw.material || raw.package || raw.category || "Lead";
  const title =
    raw.title ||
    (raw.intent ? `"${raw.intent}" — ${buyer}` : `Lead — ${buyer}`);

  const why: string[] = [];
  if (raw.qty) why.push(`Quantity: ${raw.qty}`);
  if (raw.material) why.push(`Material: ${raw.material}`);
  if (raw.deadline) why.push(`Timeline: ${raw.deadline}`);
  if (raw.source) why.push(`Matched by ${raw.source}`);
  if (raw.url) why.push(`Source: ${raw.url}`);

  return {
    title,
    buyer,
    state,
    intent,
    why: why.join(" • "),
    source: raw.source || "",
    url: raw.url || "",
  };
}

// ——— scoring (optional module) ——————————————————————————————
async function scoreLead(raw: Lead, prefs: any): Promise<number> {
  const scoring = await load<{ computeScore: (l: any, w?: any, p?: any) => number }>("./scoring");
  if (scoring?.computeScore) {
    return scoring.computeScore(raw, undefined, prefs);
  }
  // fallback light heuristic
  let s = 0;
  if (raw.source?.toLowerCase().includes("rfp")) s += 30;
  if (raw.intent || raw.material) s += 30;
  if (raw.qty) s += 20;
  if (raw.state || raw.region) s += 10;
  return s;
}

// ——— main runner —————————————————————————————————————————————
export type FindNowPayload = {
  website?: string;
  regions?: string;
  industries?: string;
  seed_buyers?: string;
  notes?: string;
  req?: Request;
};

export async function findNowRunner(payload: FindNowPayload) {
  const { tasks, putPreview, putLead } = ctxFromGlobal();

  const task: TaskState = {
    id: `t_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    startedAt: Date.now(),
    website: (payload.website || "").trim(),
    regions: (payload.regions || "").trim(),
    industries: (payload.industries || "").trim(),
    seeds: (payload.seed_buyers || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    notes: (payload.notes || "").trim(),
  };

  tasks.set(task.id, task);
  currentTaskId = task.id;

  // immediate preview lines
  putPreview(task.id, `Parsed site: ${task.website || "—"}`);
  if (task.regions) putPreview(task.id, `Regions: ${task.regions}`);
  if (task.industries) putPreview(task.id, `Industries: ${task.industries}`);
  if (task.seeds.length)
    putPreview(task.id, `Seeds: ${task.seeds.slice(0, 6).join(", ")}`);
  if (task.notes) putPreview(task.id, `Notes: ${task.notes}`);

  // kick async work (do not await completely)
  (async () => {
    try {
      // 1) Derive targets from vendor site (ICP guess)
      putPreview(task.id, "Deriving ICP from your site…");
      const derive = await load<{ deriveTargetsFromVendorSite: (u: string) => Promise<string[]> }>(
        "./connectors/derivebuyersfromvendorsite"
      );
      if (derive?.deriveTargetsFromVendorSite && task.website) {
        const guesses = (await safe(
          "ICP guess",
          () => derive!.deriveTargetsFromVendorSite!(task.website)
        )) as string[] | undefined;
        if (guesses?.length) {
          putPreview(task.id, `ICP guess → ${guesses.slice(0, 8).join(", ")}`);
        }
      }

      // 2) Brand intake / procurement pages
      putPreview(task.id, "Scanning procurement & intake pages…");
      const brandIntake = await load<{ brandIntake: (seeds: string[], prefs: any) => Promise<Lead[]> }>(
        "./connectors/brandintake"
      );
      const prefs = {
        regions: task.regions,
        industries: task.industries,
        notes: task.notes,
      };
      const leadsA =
        (await safe("intake", () =>
          brandIntake?.brandIntake
            ? brandIntake.brandIntake(task.seeds, prefs)
            : Promise.resolve([])
        )) || [];

      // 3) Ads library (free)
      putPreview(task.id, "Probing ad-library bursts…");
      const adlib = await load<{ adlibFree: (seeds: string[], prefs: any) => Promise<Lead[]> }>(
        "./connectors/adlib_free"
      );
      const leadsB =
        (await safe("adlib", () =>
          adlib?.adlibFree ? adlib.adlibFree(task.seeds, prefs) : Promise.resolve([])
        )) || [];

      // 4) Reviews
      putPreview(task.id, "Reading public reviews…");
      const reviews = await load<{ reviewsSignals: (seeds: string[], prefs: any) => Promise<Lead[]> }>(
        "./connectors/reviews"
      );
      const leadsC =
        (await safe("reviews", () =>
          reviews?.reviewsSignals
            ? reviews.reviewsSignals(task.seeds, prefs)
            : Promise.resolve([])
        )) || [];

      // 5) Product detail / restock
      putPreview(task.id, "Scanning retailer pages…");
      const pdp = await load<{ pdpSignals: (seeds: string[], prefs: any) => Promise<Lead[]> }>(
        "./connectors/pdp"
      );
      const leadsD =
        (await safe("pdp", () =>
          pdp?.pdpSignals ? pdp.pdpSignals(task.seeds, prefs) : Promise.resolve([])
        )) || [];

      const all: Lead[] = ([] as Lead[]).concat(leadsA, leadsB, leadsC, leadsD);

      // score + stream
      for (const raw of all) {
        const score = await scoreLead(raw, prefs);
        const norm = normalizeLead(raw);
        (norm as any).score = score;
        putLead(task.id, norm);
      }

      putPreview(task.id, "Ranking by fit…");
      putPreview(task.id, "Done.");
      const t = tasks.get(task.id);
      if (t) t.done = true;
    } catch (e: any) {
      const msg = e?.message || String(e);
      putPreview(task.id, `✖ error: ${msg}`);
      const t = tasks.get(task.id);
      if (t) t.error = msg;
    }
  })();

  return {
    ok: true,
    task: task.id,
  };
}
