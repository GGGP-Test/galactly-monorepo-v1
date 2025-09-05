// src/core/pipeline-manager.ts
/**
 * PipelineManager: job orchestration with concurrency, retries, and hooks.
 * Integrates with telemetry and emits lifecycle events for routes to consume.
 */
import { EventEmitter } from "events";
import { telemetry } from "../ops/telemetry";

export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface PipelineJob<I = any, O = any> {
  id: string;
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
  cancelRequested?: boolean;
}

export interface Pipeline<I = any, O = any> {
  name: string;
  concurrency: number;
  handler: (job: PipelineJob<I, O>, ctx: {
    log: (msg: string) => void;
    heartbeat: () => void;
    isCanceled: () => boolean;
    timer: () => () => void;
  }) => Promise<O>;
  onSuccess?: (job: PipelineJob<I, O>) => Promise<void> | void;
  onError?: (job: PipelineJob<I, O>) => Promise<void> | void;
}

export class PipelineManager extends EventEmitter {
  private queues = new Map<string, PipelineJob<any, any>[]>();
  private running = new Map<string, number>();
  private pipelines = new Map<string, Pipeline<any, any>>();

  constructor() {
    super();
    telemetry.gauge("pipeline_running_jobs", { help: "Number of running jobs", labelNames: ["pipeline"] });
    telemetry.gauge("pipeline_queued_jobs", { help: "Number of queued jobs", labelNames: ["pipeline"] });
    telemetry.histogram("pipeline_job_latency_ms", "latencyMs", { labelNames: ["pipeline", "status"] });
  }

  register<I, O>(pipe: Pipeline<I, O>) {
    if (this.pipelines.has(pipe.name)) throw new Error(`pipeline already registered: ${pipe.name}`);
    this.pipelines.set(pipe.name, pipe);
    this.queues.set(pipe.name, []);
    this.running.set(pipe.name, 0);
    return this;
  }

  enqueue<I, O>(pipeline: string, input: I, opts?: { maxRetries?: number; id?: string }) {
    const p = this.pipelines.get(pipeline);
    if (!p) throw new Error(`unknown pipeline: ${pipeline}`);
    const job: PipelineJob<I, O> = {
      id: opts?.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      input,
      status: "queued",
      tries: 0,
      maxRetries: opts?.maxRetries ?? 2,
      createdAt: Date.now(),
      logs: [],
    };
    this.queues.get(pipeline)!.push(job as any);
    this.emit("enqueue", { pipeline, job });
    telemetry.counter("pipeline_enqueue_total", { labelNames: ["pipeline"] }).inc(1, { pipeline });
    this.schedule(pipeline);
    return job.id;
  }

  cancel(pipeline: string, id: string) {
    const q = this.queues.get(pipeline) || [];
    const inQueue = q.find((j) => j.id === id);
    if (inQueue) {
      inQueue.status = "canceled";
      inQueue.cancelRequested = true;
      this.emit("cancel", { pipeline, job: inQueue });
      return true;
    }
    // If it's running, flag cancelRequested; handler should observe and stop
    this.emit("cancel-requested", { pipeline, id });
    return true;
  }

  getJob(pipeline: string, id: string): PipelineJob | undefined {
    const q = this.queues.get(pipeline) || [];
    const j = q.find((x) => x.id === id);
    return j;
  }

  private schedule(pipeline: string) {
    setImmediate(() => this.tick(pipeline));
  }

  private async tick(pipeline: string) {
    const p = this.pipelines.get(pipeline);
    if (!p) return;

    const running = this.running.get(pipeline) || 0;
    const q = this.queues.get(pipeline)!;

    telemetry.gauge("pipeline_queued_jobs").set(q.filter((j) => j.status === "queued").length, { pipeline });

    if (running >= p.concurrency) return;

    const next = q.find((j) => j.status === "queued");
    if (!next) return;

    // start
    this.running.set(pipeline, running + 1);
    next.status = "running";
    next.startedAt = Date.now();
    next.logs.push(`start ${new Date().toISOString()}`);
    const stopTimer = telemetry.histogram("pipeline_job_latency_ms", "latencyMs", {
      labelNames: ["pipeline", "status"],
    }).startTimer({ pipeline, status: "running" });
    telemetry.gauge("pipeline_running_jobs").inc(1, { pipeline });

    const log = (m: string) => next.logs.push(`[${new Date().toISOString()}] ${m}`);
    const heartbeat = () => this.emit("heartbeat", { pipeline, id: next.id, ts: Date.now() });
    const isCanceled = () => !!next.cancelRequested;
    const endTimer = stopTimer;

    try {
      next.tries += 1;
      const result = await p.handler(next as any, { log, heartbeat, isCanceled, timer: () => stopTimer });
      next.result = result;
      next.status = "done";
      next.finishedAt = Date.now();
      endTimer();
      telemetry.counter("pipeline_job_done_total", { labelNames: ["pipeline"] }).inc(1, { pipeline });
      this.emit("done", { pipeline, job: next });
      await p.onSuccess?.(next as any);
    } catch (e: any) {
      next.error = String(e?.message || e);
      next.status = next.cancelRequested ? "canceled" : "error";
      next.finishedAt = Date.now();
      endTimer();
      telemetry.counter("pipeline_job_error_total", { labelNames: ["pipeline"] }).inc(1, { pipeline });
      this.emit("error", { pipeline, job: next });

      // retry if allowed
      if (!next.cancelRequested && next.tries <= next.maxRetries) {
        next.status = "queued";
        next.logs.push(`retrying (${next.tries}/${next.maxRetries})…`);
      }
    } finally {
      telemetry.gauge("pipeline_running_jobs").dec(1, { pipeline });
      this.running.set(pipeline, (this.running.get(pipeline) || 1) - 1);
      // remove completed jobs to keep queue small
      const keep = (j: PipelineJob) => ["queued", "running"].includes(j.status);
      if (this.queues.get(pipeline)!.length > 500) {
        this.queues.set(
          pipeline,
          this.queues.get(pipeline)!.filter(keep)
        );
      }
      // schedule next
      this.schedule(pipeline);
    }
  }
}

// --- Example: default manager + tiny demo pipeline (you can replace in app bootstrap)

export const pipelineManager = new PipelineManager();

// Example registration (no external deps)
pipelineManager.register({
  name: "discovery",
  concurrency: 3,
  async handler(job, { log, isCanceled, heartbeat }) {
    const max = (job.input?.max || 10) as number;
    const leads: any[] = [];
    for (let i = 0; i < max; i++) {
      if (isCanceled()) throw new Error("canceled");
      await sleep(50 + Math.random() * 50);
      heartbeat();
      leads.push({ id: `L${i}`, company: `Co ${i}`, domain: `co${i}.example.com` });
      log(`found ${leads[i].domain}`);
    }
    return { leads };
  },
  onSuccess(job) {
    // no-op
  },
  onError(job) {
    // no-op
  },
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
