// src/core/pipeline-manager.ts
/**
 * PipelineManager: durable job orchestration with concurrency control, retries, pause/resume,
 * pluggable persistence, and telemetry.
 *
 * Emits events:
 *  - 'register'         ({ pipeline })
 *  - 'enqueue'          ({ pipeline, job })
 *  - 'start'            ({ pipeline, job })
 *  - 'heartbeat'        ({ pipeline, id, ts })
 *  - 'log'              ({ pipeline, id, line })
 *  - 'progress'         ({ pipeline, id, progress })  // 0..1
 *  - 'retry'            ({ pipeline, job })
 *  - 'done'             ({ pipeline, job })
 *  - 'error'            ({ pipeline, job })
 *  - 'cancel-requested' ({ pipeline, id })
 *  - 'canceled'         ({ pipeline, job })
 *  - 'concurrency'      ({ pipeline, concurrency })
 *  - 'pause' | 'resume' ({ pipeline })
 */
import { EventEmitter } from "events";
import { telemetry } from "../ops/telemetry";
import type { PipelineStore } from "./pipeline-store";
import { InMemoryPipelineStore } from "./pipeline-store";
import { backoffMs } from "./job-utils";

// ---- Types

export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface PipelineJob<I = any, O = any> {
  id: string;
  pipeline: string;
  input: I;
  status: JobStatus;
  tries: number;
  maxRetries: number;
  result?: O;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: string[];
  progress?: number; // 0..1
  cancelRequested?: boolean;
  priority?: number; // higher first
  // opaque metadata for UIs/ops
  meta?: Record<string, any>;
}

export interface PipelineContext {
  log: (msg: string) => void;
  heartbeat: () => void;
  isCanceled: () => boolean;
  setProgress: (p: number) => void;
  /** timer helper that records latency into telemetry; returns stop() */
  timer: () => () => void;
}

export interface Pipeline<I = any, O = any> {
  name: string;
  concurrency: number;
  handler: (job: PipelineJob<I, O>, ctx: PipelineContext) => Promise<O>;
  onSuccess?: (job: PipelineJob<I, O>) => Promise<void> | void;
  onError?: (job: PipelineJob<I, O>) => Promise<void> | void;
  /** optional guard to drop/skip jobs before run (e.g., input validation, dedupe) */
  preflight?: (job: PipelineJob<I, O>) => Promise<"ok" | "drop" | "skip"> | "ok" | "drop" | "skip";
}

export interface EnqueueOptions {
  maxRetries?: number;
  id?: string;
  priority?: number;
  meta?: Record<string, any>;
}

export interface PipelineStats {
  running: number;
  queued: number;
  concurrency: number;
  paused: boolean;
}

// ---- Manager

export class PipelineManager extends EventEmitter {
  private pipelines = new Map<string, Pipeline<any, any>>();
  private runningCount = new Map<string, number>();
  private paused = new Set<string>();
  private store: PipelineStore;

  constructor(store?: PipelineStore) {
    super();
    this.store = store || new InMemoryPipelineStore();

    telemetry.gauge("pipeline_running_jobs", { help: "Number of running jobs", labelNames: ["pipeline"] });
    telemetry.gauge("pipeline_queued_jobs", { help: "Number of queued jobs", labelNames: ["pipeline"] });
    telemetry.histogram("pipeline_job_latency_ms", "latencyMs", { labelNames: ["pipeline", "status"] });
    telemetry.counter("pipeline_enqueue_total", { labelNames: ["pipeline"] });
    telemetry.counter("pipeline_job_done_total", { labelNames: ["pipeline"] });
    telemetry.counter("pipeline_job_error_total", { labelNames: ["pipeline"] });
    telemetry.counter("pipeline_job_retry_total", { labelNames: ["pipeline"] });
    telemetry.counter("pipeline_job_canceled_total", { labelNames: ["pipeline"] });
  }

  withStore(store: PipelineStore) {
    this.store = store;
    return this;
  }

  // Register a pipeline
  register<I, O>(pipe: Pipeline<I, O>) {
    if (this.pipelines.has(pipe.name)) throw new Error(`pipeline already registered: ${pipe.name}`);
    this.pipelines.set(pipe.name, pipe);
    this.runningCount.set(pipe.name, 0);
    this.emit("register", { pipeline: pipe.name });
    // resume any persisted queued/running jobs for this pipeline
    void this.resumePersisted(pipe.name);
    return this;
  }

  async resumePersisted(pipeline: string) {
    const jobs = await this.store.list({ pipeline, statuses: ["queued", "running"] });
    for (const j of jobs) {
      // if a previous process died mid-run, move it back to queued for retry
      if (j.status === "running") {
        j.status = "queued";
        j.startedAt = undefined;
        await this.store.update(j);
      }
      // schedule
      this._schedule(pipeline);
    }
  }

  // Adjust concurrency / pause / resume
  setConcurrency(pipeline: string, concurrency: number) {
    const p = this.mustGetPipeline(pipeline);
    p.concurrency = Math.max(1, Math.floor(concurrency));
    this.emit("concurrency", { pipeline, concurrency: p.concurrency });
    this._schedule(pipeline);
  }
  pause(pipeline: string) {
    this.paused.add(pipeline);
    this.emit("pause", { pipeline });
  }
  resume(pipeline: string) {
    this.paused.delete(pipeline);
    this.emit("resume", { pipeline });
    this._schedule(pipeline);
  }
  isPaused(pipeline: string) {
    return this.paused.has(pipeline);
  }

  // Enqueue a job
  async enqueue<I, O>(pipeline: string, input: I, opts?: EnqueueOptions) {
    const p = this.mustGetPipeline(pipeline);
    const job: PipelineJob<I, O> = {
      id: opts?.id || genId(),
      pipeline,
      input,
      status: "queued",
      tries: 0,
      maxRetries: opts?.maxRetries ?? 2,
      createdAt: Date.now(),
      logs: [],
      priority: opts?.priority ?? 0,
      meta: opts?.meta,
    };
    await this.store.insert(job);
    telemetry.counter("pipeline_enqueue_total").inc(1, { pipeline });
    this.emit("enqueue", { pipeline, job });
    this._schedule(pipeline);
    return job.id;
  }

  // Cancel a job (queued or running)
  async cancel(pipeline: string, id: string) {
    const j = await this.store.get(id);
    if (!j || j.pipeline !== pipeline) return false;
    if (j.status === "queued") {
      j.status = "canceled";
      await this.store.update(j);
      telemetry.counter("pipeline_job_canceled_total").inc(1, { pipeline });
      this.emit("canceled", { pipeline, job: j });
      return true;
    }
    // If it's running, flag cancelRequested; handler should observe and stop
    j.cancelRequested = true;
    await this.store.update(j);
    this.emit("cancel-requested", { pipeline, id });
    return true;
  }

  // Introspection
  async getJob(id: string) {
    return this.store.get(id);
  }
  async listJobs(filter?: { pipeline?: string; status?: JobStatus; limit?: number }) {
    return this.store.list({
      pipeline: filter?.pipeline,
      statuses: filter?.status ? [filter.status] : undefined,
      limit: filter?.limit,
    });
  }
  async stats(pipeline: string): Promise<PipelineStats> {
    const p = this.mustGetPipeline(pipeline);
    const queued = await this.store.count({ pipeline, statuses: ["queued"] });
    const running = this.runningCount.get(pipeline) || 0;
    return { queued, running, concurrency: p.concurrency, paused: this.isPaused(pipeline) };
  }
  async drain(pipeline?: string) {
    if (pipeline) {
      while (true) {
        const s = await this.stats(pipeline);
        if (s.running === 0 && s.queued === 0) return;
        await sleep(50);
      }
    } else {
      const names = [...this.pipelines.keys()];
      while (true) {
        let allIdle = true;
        for (const n of names) {
          const s = await this.stats(n);
          if (!(s.running === 0 && s.queued === 0)) {
            allIdle = false;
            break;
          }
        }
        if (allIdle) return;
        await sleep(50);
      }
    }
  }

  // ---- Private runner loop

  private mustGetPipeline(name: string) {
    const p = this.pipelines.get(name);
    if (!p) throw new Error(`unknown pipeline: ${name}`);
    return p;
  }

  private _schedule(pipeline: string) {
    setImmediate(() => this._tick(pipeline));
  }

  private async _tick(pipeline: string) {
    const p = this.mustGetPipeline(pipeline);
    if (this.paused.has(pipeline)) return;

    const running = this.runningCount.get(pipeline) || 0;
    telemetry.gauge("pipeline_queued_jobs").set(await this.store.count({ pipeline, statuses: ["queued"] }), {
      pipeline,
    });

    if (running >= p.concurrency) return;

    // fetch next highest-priority job
    const next = await this.store.nextQueued(pipeline);
    if (!next) return;

    // preflight (drop/skip) if provided
    if (p.preflight) {
      const verdict = await p.preflight(next);
      if (verdict === "drop") {
        next.status = "canceled";
        next.logs.push(`dropped by preflight at ${new Date().toISOString()}`);
        await this.store.update(next);
        this.emit("canceled", { pipeline, job: next });
        this._schedule(pipeline);
        return;
      }
      if (verdict === "skip") {
        // push to the end by lowering priority
        next.priority = (next.priority || 0) - 1;
        await this.store.update(next);
        this._schedule(pipeline);
        return;
      }
    }

    // start
    this.runningCount.set(pipeline, running + 1);
    next.status = "running";
    next.startedAt = Date.now();
    await this.store.update(next);

    const endTimer = telemetry
      .histogram("pipeline_job_latency_ms", "latencyMs", { labelNames: ["pipeline", "status"] })
      .startTimer({ pipeline, status: "running" });
    telemetry.gauge("pipeline_running_jobs").inc(1, { pipeline });
    this.emit("start", { pipeline, job: stripInput(next) });

    const ctx: PipelineContext = {
      log: async (line: string) => {
        const entry = `[${new Date().toISOString()}] ${line}`;
        next.logs.push(entry);
        await this.store.appendLog(next.id, entry);
        this.emit("log", { pipeline, id: next.id, line: entry });
      },
      heartbeat: () => this.emit("heartbeat", { pipeline, id: next.id, ts: Date.now() }),
      isCanceled: () => !!next.cancelRequested,
      setProgress: async (p: number) => {
        next.progress = clamp01(p);
        await this.store.update(next);
        this.emit("progress", { pipeline, id: next.id, progress: next.progress });
      },
      timer: () =>
        telemetry.histogram("pipeline_section_latency_ms", "latencyMs", {
          labelNames: ["pipeline", "section"],
        }).startTimer({ pipeline, section: "custom" }),
    };

    try {
      next.tries += 1;
      await this.store.update(next);

      const result = await this.pipelines.get(pipeline)!.handler(next, ctx);
      next.result = result;
      next.status = "done";
      next.finishedAt = Date.now();
      await this.store.update(next);

      endTimer();
      telemetry.counter("pipeline_job_done_total").inc(1, { pipeline });
      this.emit("done", { pipeline, job: stripInput(next) });
      await this.pipelines.get(pipeline)!.onSuccess?.(next as any);
    } catch (e: any) {
      next.error = String(e?.message || e);
      next.status = next.cancelRequested ? "canceled" : "error";
      next.finishedAt = Date.now();
      await this.store.update(next);

      endTimer();
      if (next.status === "canceled") {
        telemetry.counter("pipeline_job_canceled_total").inc(1, { pipeline });
        this.emit("canceled", { pipeline, job: stripInput(next) });
      } else {
        telemetry.counter("pipeline_job_error_total").inc(1, { pipeline });
        this.emit("error", { pipeline, job: stripInput(next) });
        // retry with backoff if allowed
        if (!next.cancelRequested && next.tries <= next.maxRetries) {
          await sleep(backoffMs(next.tries, { min: 250, max: 10_000, jitter: 0.25 }));
          next.status = "queued";
          next.startedAt = undefined;
          next.finishedAt = undefined;
          next.logs.push(`retrying (${next.tries}/${next.maxRetries})…`);
          await this.store.update(next);
          telemetry.counter("pipeline_job_retry_total").inc(1, { pipeline });
          this.emit("retry", { pipeline, job: stripInput(next) });
        }
      }
    } finally {
      telemetry.gauge("pipeline_running_jobs").dec(1, { pipeline });
      this.runningCount.set(pipeline, Math.max(0, (this.runningCount.get(pipeline) || 1) - 1));
      // schedule more work
      this._schedule(pipeline);
    }
  }
}

// ---- Helpers

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripInput(j: PipelineJob): PipelineJob {
  // reduce event payload size when broadcasting
  const { input, ...rest } = j as any;
  return rest as any;
}

// default singleton for convenience
export const pipelineManager = new PipelineManager();
