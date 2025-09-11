// Backend/src/routes/find.ts
// Routes:
//   GET  /api/v1/persona/:supplier
//   POST /api/v1/persona
//   POST /api/v1/leads/find-buyers
//
// Uses event_log for persona persistence (no schema changes).
// Inserts candidates into lead_pool when possible, but never crashes the API.

import express from "express";
import { q } from "../db";
import fs from "fs";
import path from "path";
import { generateCandidatesHints } from "../ai/llm";

type Persona = {
  supplierDomain: string;
  offer: string;
  solves: string;
  buyerTitles: string[];
};

type FindReq = {
  supplierDomain: string;
  region?: string;      // e.g. "Austin, TX" or "US/CA"
  radiusMi?: number;    // default 50
  uscaOnly?: boolean;   // default true
};

const SEEDS_PATH =
  process.env.SEEDS_PATH || "/etc/secrets/seeds.txt";

// ---------- helpers ----------

function normalizeHost(input: string): string {
  try {
    let s = (input || "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "http://" + s;
    const u = new URL(s);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return (input || "").trim().toLowerCase();
  }
}

function domainQuality(host: string): number {
  const tld = (host.split(".").pop() || "").toLowerCase();
  const good = ["com", "ca", "co", "io", "ai", "net", "org"];
  return good.includes(tld) ? 0.65 : 0.35;
}

function tempFromScores(scores: number[]): "hot" | "warm" {
  const avg =
    scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  return avg >= 0.7 ? "hot" : "warm";
}

function makeWhy(opts: {
  host: string;
  platform?: string;
  intent?: string;
  geo?: string;
  context?: string[];
}) {
  const why: any[] = [];
  why.push({
    label: "Domain quality",
    kind: "meta",
    score: domainQuality(opts.host),
    detail: `${opts.host} (${opts.host.split(".").pop()?.toLowerCase()})`,
  });
  if (opts.platform) {
    why.push({
      label: "Platform fit",
      kind: "platform",
      score: opts.platform === "shopify" ? 0.75 :
             opts.platform === "woocommerce" ? 0.6 : 0.5,
      detail: opts.platform,
    });
  }
  if (opts.intent) {
    why.push({
      label: "Intent keywords",
      kind: "signal",
      score: /rfp|rfq|quote|tender|packaging/i.test(opts.intent) ? 0.9 : 0.75,
      detail: opts.intent,
    });
  }
  if (opts.geo) {
    why.push({
      label: "Geo",
      kind: "geo",
      score: /US|CA|USA|Canada/i.test(opts.geo) ? 0.8 : 0.5,
      detail: opts.geo,
    });
  }
  for (const line of opts.context || []) {
    why.push({
      label: "Evidence",
      kind: "evidence",
      score: 0.7,
      detail: line,
    });
  }
  return why;
}

async function insertLead(c: {
  cat: "product" | "procurement" | "other";
  kw: string[];
  platform: string;
  source_url: string;
  title: string;
  snippet?: string;
}) {
  // Try to write; ignore errors to keep UX smooth
  try {
    await q(
      `INSERT INTO lead_pool (cat, kw, platform, source_url, title, snippet)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [c.cat, c.kw, c.platform, c.source_url, c.title, c.snippet || null]
    );
  } catch {
    // swallow
  }
}

function readSeeds(): string[] {
  try {
    const p = SEEDS_PATH;
    if (!p) return [];
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8");
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 500);
  } catch {
    return [];
  }
}

async function latestPersona(supplierDomain: string): Promise<Persona | null> {
  try {
    const r = await q<any>(
      `SELECT meta
         FROM event_log
        WHERE event_type='persona_set'
          AND (meta->>'supplierDomain')=$1
        ORDER BY created_at DESC
        LIMIT 1`,
      [supplierDomain]
    );
    const meta = r.rows?.[0]?.meta;
    if (!meta) return null;
    return {
      supplierDomain,
      offer: meta.offer || "",
      solves: meta.solves || "",
      buyerTitles: Array.isArray(meta.buyerTitles) ? meta.buyerTitles : [],
    };
  } catch {
    return null;
  }
}

// ---------- routes ----------

export function mountFind(app: express.Express) {
  // Persona: GET
  app.get("/api/v1/persona/:supplier", async (req, res) => {
    const supplierDomain = normalizeHost(req.params.supplier || "");
    if (!supplierDomain) {
      return res.status(400).json({ ok: false, error: "missing supplier" });
    }
    const p =
      (await latestPersona(supplierDomain)) ||
      {
        supplierDomain,
        offer: "",
        solves: "",
        buyerTitles: [],
      };
    res.json({ ok: true, persona: p });
  });

  // Persona: POST (save)
  app.post("/api/v1/persona", express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const supplierDomain = normalizeHost(body.supplierDomain || "");
      if (!supplierDomain) {
        return res.status(400).json({ ok: false, error: "missing supplierDomain" });
      }
      const persona: Persona = {
        supplierDomain,
        offer: String(body.offer || ""),
        solves: String(body.solves || ""),
        buyerTitles: Array.isArray(body.buyerTitles)
          ? body.buyerTitles.map((s: any) => String(s)).filter(Boolean)
          : [],
      };
      // Persist to event_log (no schema changes)
      try {
        await q(
          `INSERT INTO event_log(user_id, event_type, meta)
           VALUES ($1,$2,$3)`,
          ["anon", "persona_set", persona as any]
        );
      } catch {
        // swallow
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Find buyers: POST
  app.post("/api/v1/leads/find-buyers", express.json(), async (req, res) => {
    try {
      const body: FindReq & Partial<Persona> = req.body || {};
      const supplierDomain = normalizeHost(body.supplierDomain || "");
      if (!supplierDomain) {
        return res.status(400).json({ ok: false, error: "missing supplierDomain" });
      }
      const region = String(body.region || "US/CA");
      const radiusMi = Number(body.radiusMi || 50);
      const uscaOnly = body.uscaOnly !== false;

      const persona: Persona = {
        supplierDomain,
        offer: String(body.offer || ""),
        solves: String(body.solves || ""),
        buyerTitles: Array.isArray(body.buyerTitles)
          ? body.buyerTitles.map((s) => String(s)).filter(Boolean)
          : [],
      };

      // Save persona event (best-effort)
      try {
        await q(
          `INSERT INTO event_log(user_id, event_type, meta)
           VALUES ($1,$2,$3)`,
          ["anon", "persona_set", persona as any]
        );
      } catch {}

      // 1) Seeds (instant)
      const seeds = readSeeds()
        .map(normalizeHost)
        .filter(Boolean);

      // 2) LLM ideas (fast; not guaranteed)
      const llm = await generateCandidatesHints(persona, region);
      const ideas = (llm.ideas || []).map((s) => s.replace(/^https?:\/\//, ""));

      // Merge & dedupe simple host-like tokens
      const seen = new Set<string>();
      const hosts: string[] = [];
      function pushHost(h: string) {
        const host = normalizeHost(h);
        if (!host) return;
        if (uscaOnly && !/.+\.(com|ca)$/i.test(host)) return; // cheap TLD pref
        if (seen.has(host)) return;
        seen.add(host);
        hosts.push(host);
      }
      for (const s of seeds) pushHost(s);
      for (const s of ideas) pushHost(s);

      // Build candidates + insert (best-effort)
      let hot = 0, warm = 0;
      const ids: number[] = [];
      for (const host of hosts.slice(0, 40)) {
        const why = makeWhy({
          host,
          platform: "unknown",
          intent: "rfp, packaging",
          geo: uscaOnly ? "US/CA preferred" : "global",
          context: [
            region ? `Priority region: ${region} (±${radiusMi} mi)` : "",
            llm.provider !== "none" ? `LLM hints from ${llm.provider}` : "",
          ].filter(Boolean),
        });
        const sIntent = why.find((w) => w.kind === "signal")?.score || 0.75;
        const sMeta = why.find((w) => w.kind === "meta")?.score || 0.5;
        const sGeo = why.find((w) => w.kind === "geo")?.score || 0.5;
        const temperature = tempFromScores([sIntent, sMeta, sGeo]);

        // Insert into DB (if available)
        await insertLead({
          cat: "product",
          kw: ["packaging", "rfp"],
          platform: "unknown",
          source_url: `https://${host}/`,
          title: `Potential buyer: ${host}`,
          snippet: `${temperature.toUpperCase()} candidate • ${region || "US/CA"} • from ${llm.provider || "seeds"}`,
        }).catch(() => {});

        if (temperature === "hot") hot++; else warm++;

        // Don't try to return DB ids; just echo list positions
        ids.push(ids.length + 1);
      }

      res.json({
        ok: true,
        supplierDomain,
        added: hosts.length,
        hot,
        warm,
        provider: llm.provider,
        ids,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
