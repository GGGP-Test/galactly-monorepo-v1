// src/routes/routes.pipeline.ts
import express from "express";
import { z } from "zod";
import { createAuditLogger } from "../security/audit-log";
import { CostTracker } from "../ops/cost-tracker";
import { MemoryBleedStore } from "../data/bleed-store";
import { MemoryLearningStore, makeLeadOutcomeEvent } from "../ai/learning-store";
// Optional: if you have an orchestrator, wire it here
// import { Orchestrator } from "../ai/orchestrator";

export const router = express.Router();

// --- Singletons (swap with DI in your app bootstrap)
const audit = createAuditLogger({ nodeId: "api" });
const costs = new CostTracker({ audit });
const bleed = new MemoryBleedStore();
const learn = new MemoryLearningStore();

// --- Schemas

const RunSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  plan: z.enum(["free", "pro"]).default("free"),
  seed: z
    .object({
      verticals: z.array(z.string()).default([]),
      regions: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
      sampleDomains: z.array(z.string()).default([]),
    })
    .default({ verticals: [], regions: [], keywords: [], sampleDomains: [] }),
  maxLeads: z.number().int().min(1).max(500).default(50),
  providers: z
    .object({
      search: z.array(z.enum(["opal", "google", "directories", "c-pacs", "reddit", "news"])).default(["directories"]),
      contacts: z.array(z.enum(["apollo", "clearbit", "instantly", "none"])).default(["none"]),
      llm: z
        .array(z.enum(["openai:gpt-4o-mini", "anthropic:haiku", "xai:grok-2", "gemini:flash", "openrouter:any"]))
        .default(["openai:gpt-4o-mini"]),
    })
    .default({ search: ["directories"], contacts: ["none"], llm: ["openai:gpt-4o-mini"] }),
});

const IdParam = z.object({ id: z.string().min(1) });

// --- In-memory job registry for demo

type JobStatus = "queued" | "running" | "done" | "error" | "canceled";
interface Job {
  id: string;
  tenantId: string;
  userId: string;
  plan: "free" | "pro";
  input: z.infer<typeof RunSchema>;
  status: JobStatus;
  logs: string[];
  leads: string[]; // lead ids created
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

const jobs = new Map<string, Job>();

function jobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Routes

router.post("/api/pipeline/run", async (req, res) => {
  const parse = RunSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const input = parse.data;

  const id = jobId();
  const job: Job = {
    id,
    tenantId: input.tenantId,
    userId: input.userId,
    plan: input.plan,
    input,
    status: "queued",
    logs: [],
    leads: [],
  };
  jobs.set(id, job);

  audit.emit({
    severity: "INFO",
    action: "PIPELINE_RUN",
    actor: { type: "user", id: input.userId },
    tenantId: input.tenantId,
    target: { type: "job", id },
    meta: { providers: input.providers, maxLeads: input.maxLeads, plan: input.plan },
  });

  // Start async run (fire-and-forget for this demo)
  runJob(job).catch((err) => {
    job.status = "error";
    job.error = String(err?.message || err);
    job.finishedAt = Date.now();
  });

  res.json({ jobId: id, status: job.status });
});

router.get("/api/pipeline/:id", async (req, res) => {
  const parse = IdParam.safeParse(req.params);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const job = jobs.get(parse.data.id);
  if (!job) return res.status(404).json({ error: "not_found" });
  res.json({ id: job.id, status: job.status, leads: job.leads, logs: job.logs, error: job.error });
});

router.post("/api/pipeline/:id/cancel", async (req, res) => {
  const parse = IdParam.safeParse(req.params);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const job = jobs.get(parse.data.id);
  if (!job) return res.status(404).json({ error: "not_found" });
  if (job.status === "done" || job.status === "error" || job.status === "canceled") {
    return res.json({ ok: true, status: job.status });
  }
  job.status = "canceled";
  job.finishedAt = Date.now();
  audit.emit({
    severity: "WARN",
    action: "CONFIG_CHANGE",
    actor: { type: "user", id: job.userId },
    tenantId: job.tenantId,
    target: { type: "job", id: job.id },
    meta: { canceled: true },
  });
  res.json({ ok: true, status: job.status });
});

// Simple Server-Sent Events stream for logs
router.get("/api/pipeline/:id/stream", async (req, res) => {
  const parse = IdParam.safeParse(req.params);
  if (!parse.success) return res.status(400).end();

  const job = jobs.get(parse.data.id);
  if (!job) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let offset = 0;
  const interval = setInterval(() => {
    if (!jobs.has(job.id)) return;
    const j = jobs.get(job.id)!;
    while (offset < j.logs.length) {
      res.write(`event: log\ndata: ${JSON.stringify(j.logs[offset])}\n\n`);
      offset++;
    }
    if (["done", "error", "canceled"].includes(j.status)) {
      res.write(`event: end\ndata: ${JSON.stringify({ status: j.status, error: j.error || null })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on("close", () => clearInterval(interval));
});

// --- Job runner (demo stub)

async function runJob(job: Job) {
  job.status = "running";
  job.startedAt = Date.now();

  const log = (m: string) => {
    job.logs.push(`[${new Date().toISOString()}] ${m}`);
  };

  log(`Plan: ${job.plan}. Providers: ${JSON.stringify(job.input.providers)}`);
  log(`Seeds: verticals=${job.input.seed.verticals.join(",") || "-"} keywords=${job.input.seed.keywords.join(",") || "-"}`);

  // 1) Simulate discovery (replace with actual discovery pipeline)
  const discovered = simulateDiscovery(job.input.maxLeads, job.input.seed);
  log(`Discovered ${discovered.length} candidates`);

  // 2) Upsert into BLEED store and assign initial scores
  for (const cand of discovered) {
    const lead = await bleed.upsertLead({
      tenantId: job.tenantId,
      source: cand.source,
      company: cand.company,
      domain: cand.domain,
      website: cand.website,
      region: cand.region,
      country: cand.country,
      verticals: cand.verticals,
      signals: cand.signals,
      scores: cand.scores,
      status: "qualified",
      meta: { seed: job.input.seed },
    });
    job.leads.push(lead.id);
  }
  log(`Upserted ${job.leads.length} leads`);

  // 3) Learn from any immediate signals (demo)
  if (job.plan === "pro") {
    for (const leadId of job.leads.slice(0, 5)) {
      const ev = makeLeadOutcomeEvent({
        tenantId: job.tenantId,
        userId: job.userId,
        plan: "pro",
        leadId,
        vertical: job.input.seed.verticals[0],
        region: job.input.seed.regions[0],
        label: Math.random() > 0.5 ? 1 : -1,
        type: Math.random() > 0.5 ? "WIN" : "LOSS",
      });
      await learn.record(ev);
      await learn.updateFromEvent(ev);
    }
    log(`Updated personalization weights with seed outcomes`);
  }

  // 4) Record cost (dummy)
  costs.recordOther({ tenantId: job.tenantId, unitUSD: 0.0005, quantity: discovered.length, type: "CRAWL" });
  log(`Cost recorded`);

  job.status = "done";
  job.finishedAt = Date.now();
  log(`Pipeline finished`);
}

// demo discovery stub
function simulateDiscovery(n: number, seed: { keywords: string[]; verticals: string[]; regions: string[] }) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const v = seed.verticals[0] || "packaging-general";
    const r = seed.regions[0] || "US-NJ";
    const company = `Prospect ${i + 1} ${v.toUpperCase()}`;
    const domain = `prospect${i + 1}-${v.replace(/\W+/g, "-")}.example.com`;
    arr.push({
      source: "seed:demo",
      company,
      domain,
      website: `https://${domain}`,
      region: r,
      country: r.startsWith("US") ? "US" : "CA",
      verticals: [v],
      signals: { running_ads: Math.random() > 0.4 ? 1 : 0, hiring_ops: Math.random() > 0.7 ? 1 : 0 },
      scores: {
        intent: Math.random(),
        fit: Math.random(),
        timing: Math.random(),
        trust: Math.random(),
      },
    });
  }
  return arr;
}

export default router;
