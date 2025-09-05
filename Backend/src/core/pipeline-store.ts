// src/core/pipeline-store.ts
/**
 * PipelineStore: persistence abstraction for jobs. Includes an in-memory implementation.
 * You can add a Redis, Postgres, or SQLite implementation behind this interface later.
 */
import type { JobStatus, PipelineJob } from "./pipeline-manager";

export interface ListQuery {
  pipeline?: string;
  statuses?: JobStatus[];
  limit?: number;
}

export interface CountQuery {
  pipeline?: string;
  statuses?: JobStatus[];
}

export interface PipelineStore {
  insert(job: PipelineJob): Promise<void>;
  update(job: PipelineJob): Promise<void>;
  appendLog(id: string, line: string): Promise<void>;
  get(id: string): Promise<PipelineJob | undefined>;
  list(q?: ListQuery): Promise<PipelineJob[]>;
  nextQueued(pipeline: string): Promise<PipelineJob | undefined>;
  count(q?: CountQuery): Promise<number>;
  remove(id: string): Promise<void>;
  clearPipeline(pipeline: string): Promise<void>;
}

type IndexKey = string; // `${pipeline}|${status}`

export class InMemoryPipelineStore implements PipelineStore {
  private jobs = new Map<string, PipelineJob>();
  private byKey = new Map<IndexKey, string[]>(); // job ids sorted by priority desc, createdAt asc

  async insert(job: PipelineJob): Promise<void> {
    this.jobs.set(job.id, { ...job });
    this.addToIndex(job);
  }

  async update(job: PipelineJob): Promise<void> {
    const prev = this.jobs.get(job.id);
    if (prev) {
      // if status changed or priority changed, reindex
      const statusChanged = prev.status !== job.status || prev.priority !== job.priority;
      this.jobs.set(job.id, { ...job });
      if (statusChanged) {
        this.removeFromIndex(prev);
        this.addToIndex(job);
      } else {
        // keep sort stable if createdAt changed
        this.resort(job.pipeline, job.status);
      }
    } else {
      this.jobs.set(job.id, { ...job });
      this.addToIndex(job);
    }
  }

  async appendLog(id: string, line: string): Promise<void> {
    const j = this.jobs.get(id);
    if (!j) return;
    j.logs.push(line);
  }

  async get(id: string): Promise<PipelineJob | undefined> {
    const j = this.jobs.get(id);
    return j ? { ...j, logs: [...j.logs] } : undefined;
  }

  async list(q?: ListQuery): Promise<PipelineJob[]> {
    const items = [...this.jobs.values()].filter((j) => {
      if (q?.pipeline && j.pipeline !== q.pipeline) return false;
      if (q?.statuses && !q.statuses.includes(j.status)) return false;
      return true;
    });
    // sort by createdAt asc as default
    items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return q?.limit ? items.slice(0, q.limit) : items;
  }

  async nextQueued(pipeline: string): Promise<PipelineJob | undefined> {
    const key = idxKey(pipeline, "queued");
    const ids = this.byKey.get(key) || [];
    const id = ids.shift(); // highest priority kept at start
    if (!id) return undefined;
    const job = this.jobs.get(id);
    // Note: don't mutate status here; manager will update to "running"
    // Keep index list popped
    this.byKey.set(key, ids);
    return job ? { ...job, logs: [...job.logs] } : undefined;
  }

  async count(q?: CountQuery): Promise<number> {
    return (await this.list({ pipeline: q?.pipeline, statuses: q?.statuses }))?.length || 0;
  }

  async remove(id: string): Promise<void> {
    const j = this.jobs.get(id);
    if (j) this.removeFromIndex(j);
    this.jobs.delete(id);
  }

  async clearPipeline(pipeline: string): Promise<void> {
    for (const j of [...this.jobs.values()]) {
      if (j.pipeline === pipeline) {
        await this.remove(j.id);
      }
    }
  }

  // ---- indexing helpers

  private addToIndex(job: PipelineJob) {
    const key = idxKey(job.pipeline, job.status);
    const arr = this.byKey.get(key) || [];
    arr.push(job.id);
    this.byKey.set(key, arr);
    this.resort(job.pipeline, job.status);
  }
  private removeFromIndex(job: PipelineJob) {
    const key = idxKey(job.pipeline, job.status);
    const arr = this.byKey.get(key) || [];
    const idx = arr.indexOf(job.id);
    if (idx >= 0) arr.splice(idx, 1);
    this.byKey.set(key, arr);
  }
  private resort(pipeline: string, status: JobStatus) {
    const key = idxKey(pipeline, status);
    const arr = (this.byKey.get(key) || []).filter((id) => this.jobs.has(id));
    arr.sort((a, b) => {
      const ja = this.jobs.get(a)!;
      const jb = this.jobs.get(b)!;
      // priority desc, createdAt asc, id tiebreaker
      const pa = ja.priority ?? 0;
      const pb = jb.priority ?? 0;
      if (pa !== pb) return pb - pa;
      if (ja.createdAt !== jb.createdAt) return (ja.createdAt || 0) - (jb.createdAt || 0);
      return a.localeCompare(b);
    });
    this.byKey.set(key, arr);
  }
}

function idxKey(p: string, s: JobStatus): IndexKey {
  return `${p}|${s}`;
}
