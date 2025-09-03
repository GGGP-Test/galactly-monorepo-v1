// backend/src/index.ts
// Express boot, single global bus for preview/leads streaming, and route registration.

import express from "express";
import cors from "cors";
import compression from "compression";
import type { Request, Response } from "express";

// Global bus (in-memory)
type TaskState = {
  id: string;
  startedAt: number;
  done?: boolean;
  error?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __GAL: {
    tasks: Map<string, TaskState>;
    preview: Map<string, string[]>;
    leads: Map<string, any[]>;
    putPreview: (taskId: string, line: string) => void;
    putLead: (taskId: string, lead: any) => void;
  };
}

if (!(globalThis as any).__GAL) {
  (globalThis as any).__GAL = {
    tasks: new Map(),
    preview: new Map(),
    leads: new Map(),
    putPreview(taskId: string, line: string) {
      const g = (globalThis as any).__GAL;
      const arr = g.preview.get(taskId) || [];
      arr.push(line);
      // cap memory
      if (arr.length > 300) arr.shift();
      g.preview.set(taskId, arr);
    },
    putLead(taskId: string, lead: any) {
      const g = (globalThis as any).__GAL;
      const arr = g.leads.get(taskId) || [];
      arr.push(lead);
      if (arr.length > 1000) arr.shift();
      g.leads.set(taskId, arr);
    },
  };
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(cors({ origin: "*", credentials: false }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));

// Health
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
app.get("/api/v1/healthz", (_req, res) => res.status(200).json({ ok: true }));

// Status (quota stub; devUnlimited obeys GAL_UNLIMITED env)
app.get("/api/v1/status", (req, res) => {
  const devUnlimited = process.env.GAL_UNLIMITED === "true";
  res.json({
    ok: true,
    uid: req.header("x-galactly-user") || "anon",
    plan: "free",
    quota: { date: new Date().toISOString().slice(0, 10), findsUsed: 0, revealsUsed: 0, findsLeft: 99, revealsLeft: 5 },
    devUnlimited,
  });
});

// Presence (optional)
app.get("/api/v1/presence/online", (_req, res) => res.json({ ok: true }));
app.get("/api/v1/presence/beat", (_req, res) => res.json({ ok: true }));

// Runner
import { findNowRunner } from "./runner/findNowRunner";

// Find-now entry
app.post("/api/v1/find-now", async (req: Request, res: Response) => {
  try {
    const r = await findNowRunner({ ...req.body, req });
    // return initial snapshot for preview convenience
    const g = (globalThis as any).__GAL;
    res.json({
      ok: true,
      task: r.task,
      preview: g.preview.get(r.task) || [],
      items: g.leads.get(r.task) || [],
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "runner_failed" });
  }
});

// Stream (poll-friendly endpoints used by the frontend)
app.get("/api/v1/stream/preview", (req: Request, res: Response) => {
  const task = String(req.query.task || "");
  const g = (globalThis as any).__GAL;
  if (!task) return res.status(400).json({ ok: false, error: "missing_task" });
  return res.json({ ok: true, preview: g.preview.get(task) || [] });
});

app.get("/api/v1/stream/leads", (req: Request, res: Response) => {
  const task = String(req.query.task || "");
  const g = (globalThis as any).__GAL;
  if (!task) return res.status(400).json({ ok: false, error: "missing_task" });
  return res.json({ ok: true, items: g.leads.get(task) || [] });
});

// Fallback: current pool (last task)
app.get("/api/v1/leads", (_req, res) => {
  const g = (globalThis as any).__GAL;
  const last = [...g.leads.keys()].pop();
  res.json({ ok: true, items: (last && g.leads.get(last)) || [] });
});

// Start
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});
