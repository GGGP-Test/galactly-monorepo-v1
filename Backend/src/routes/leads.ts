// Backend/src/routes/leads.ts
// Leads API + "find buyers" endpoint wired to WebScout v0 + JSON persistence.
// NOTE: keep typing lax on `app` parameter to avoid Express type-mismatch across versions.

import type { Lead, WhyChip } from "../store";
import { allLeads, addLeads, updateStage, appendNote } from "../store";
import { scanSupplier } from "../ai/webscout";
import fs from "node:fs/promises";
import path from "node:path";

// ===== helpers =====

function csvEscape(s: string): string {
  if (s == null) return "";
  const t = String(s);
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function toCSV(leads: Lead[]): string {
  const header = ["id","host","platform","title","created","temperature","why","stage"].join(",");
  const rows = leads.map(l => {
    const why = l.why?.map(w => `${w.label}${w.score!=null?` (${w.score.toFixed(2)})`:""}`).join(" | ") ?? "";
    return [
      l.id, l.host, l.platform, l.title, l.created, l.temperature, why, l.stage ?? ""
    ].map(csvEscape).join(",");
  });
  return [header, ...rows].join("\n");
}

function scoreFromText(text: string): { intent: number; context: WhyChip[] } {
  const T = text.toLowerCase();
  let intent = 0;
  const chips: WhyChip[] = [];

  const bump = (n: number) => (intent = Math.min(1, intent + n));

  if (/\brfp\b|\brfq\b|\btender\b/.test(T)) {
    bump(0.6);
    chips.push({ label: "RFP/RFQ language", kind: "intent", score: 0.9 });
  }
  if (/launch|new product|now available|coming soon/.test(T)) {
    bump(0.25);
    chips.push({ label: "Product launch language", kind: "intent", score: 0.6 });
  }
  if (/warehouse|3pl|distribution center|pallet|dock/.test(T)) {
    bump(0.2);
    chips.push({ label: "Has warehousing signals", kind: "context", score: 0.5 });
  }
  if (/packaging|carton|corrugated|pouch|film|wrap/.test(T)) {
    bump(0.2);
    chips.push({ label: "Packaging keywords", kind: "intent", score: 0.5 });
  }

  return { intent, context: chips };
}

async function readSeedsUSCA(): Promise<string[]> {
  // Seeds live in /etc/secrets/seeds.txt (one domain per line, may include junk)
  const SEEDS_FILE = "/etc/secrets/seeds.txt";
  try {
    const raw = await fs.readFile(SEEDS_FILE, "utf8");
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    // Allow comma-separated formats; keep only host-ish tokens
    const domains = lines.flatMap(line => line.split(/[,\s]+/))
      .map(t => t.replace(/^https?:\/\//i, "").replace(/\/+.*$/, "").toLowerCase())
      .filter(h => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
    // Hard US/CA guardrail by TLD; (WebScout will tighten further by content)
    return domains.filter(h => h.endsWith(".com") || h.endsWith(".us") || h.endsWith(".ca"));
  } catch {
    return [];
  }
}

async function fetchSnippet(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal as any, redirect: "follow" as any });
    clearTimeout(t);
    if (!res.ok) return "";
    const txt = await res.text();
    return txt.slice(0, 100_000).toLowerCase();
  } catch {
    return "";
  }
}

function tempFromIntent(x: number): "hot" | "warm" {
  return x >= 0.8 ? "hot" : "warm";
}

// ===== routes =====

export function mountLeads(app: any) {
  // List
  app.get("/api/v1/leads", async (_req: any, res: any) => {
    const leads = await allLeads();
    res.json({ ok: true, leads });
  });

  // CSV
  app.get("/api/v1/leads.csv", async (_req: any, res: any) => {
    const leads = await allLeads();
    const csv = toCSV(leads);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.send(csv);
  });

  // Update stage
  app.post("/api/v1/leads/:id/stage", async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { stage } = req.body ?? {};
    const updated = await updateStage(id, stage);
    if (!updated) return res.status(404).json({ ok: false, error: "not-found" });
    res.json({ ok: true, lead: updated });
  });

  // Append note
  app.post("/api/v1/leads/:id/notes", async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { text } = req.body ?? {};
    const updated = await appendNote(id, String(text ?? "").slice(0, 2000));
    if (!updated) return res.status(404).json({ ok: false, error: "not-found" });
    res.json({ ok: true, lead: updated });
  });

  // === Core: find buyers ===
  app.post("/api/v1/leads/find-buyers", async (req: any, res: any) => {
    const { domain, region = "us", radiusMi = 50 } = req.body ?? {};
    if (!domain || typeof domain !== "string") {
      return res.status(400).json({ ok: false, error: "domain-required" });
    }
    if (!["us","ca"].includes(String(region).toLowerCase())) {
      return res.status(400).json({ ok: false, error: "region-must-be-us-or-ca" });
    }

    // 1) Understand the supplier
    const persona = await scanSupplier(domain);
    const personaRegion = persona.hqRegion ?? (region as "us"|"ca");

    // 2) Start with seeds (fast)
    const seeds = await readSeedsUSCA();

    // 3) Score and filter each seed quickly (homepage + a couple of cues)
    const batch = seeds.slice(0, 400); // cap per request to stay snappy
    const scored: {
      host: string;
      platform: string;
      title: string;
      why: WhyChip[];
      intentScore: number;
    }[] = [];

    await Promise.all(batch.map(async (host) => {
      const url = `https://${host}`;
      const snippet = await fetchSnippet(url);
      if (!snippet) return;

      // Region hard-guard: simple heuristic — keep .ca for CA; prefer US terms for US.
      if (personaRegion === "ca" && !/\.ca$/.test(host)) {
        const hasCA = /canada|\bqc\b|\bon\b|\bbc\b|\balberta\b|\bontario\b|\bquebec\b/.test(snippet);
        if (!hasCA) return;
      }
      if (personaRegion === "us" && /\.ca$/.test(host)) return;

      const { intent, context } = scoreFromText(snippet);

      // Persona matching (very light for v0)
      const personaHit = (() => {
        const P = (persona.offer + " " + persona.solves + " " + persona.buyerTitles.join(" ")).toLowerCase();
        const hit =
          (P.includes("stretch") && /stretch|pallet|warehouse/.test(snippet)) ||
          (P.includes("corrugat") && /carton|corrugat|box/.test(snippet)) ||
          (P.includes("label") && /label|bottle|pouch/.test(snippet));
        return hit ? 0.2 : 0;
      })();

      const temperature = tempFromIntent(Math.min(1, intent + personaHit));
      const why: WhyChip[] = [
        { label: "Domain quality", kind: "meta", score: host.endsWith(".com") ? 0.65 : 0.6, detail: host },
        { label: "Platform fit", kind: "platform", score: 0.5, detail: "unknown" },
        ...context,
      ];

      scored.push({
        host,
        platform: "unknown",
        title: `Lead: ${host}`,
        why,
        intentScore: Math.min(1, intent + personaHit),
      });
    }));

    // 4) Persist new leads
    const toInsert = scored
      .sort((a, b) => b.intentScore - a.intentScore)
      .slice(0, 80)
      .map(s => ({
        host: s.host,
        platform: s.platform,
        title: s.title,
        temperature: tempFromIntent(s.intentScore),
        why: s.why,
        keywords: undefined,
        stage: "new" as const,
      }));

    const inserted = await addLeads(toInsert);

    return res.json({
      ok: true,
      persona,
      created: inserted.length,
      ids: inserted.map(x => x.id),
    });
  });
}
