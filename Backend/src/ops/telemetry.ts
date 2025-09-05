// src/ops/telemetry.ts
/**
 * Lightweight Telemetry hub (counters, gauges, histograms, timers) with pluggable sinks.
 * Zero external deps. Optional Prometheus-style text exposition.
 */
import { EventEmitter } from "events";

// --- Types

export type Labels = Record<string, string | number | boolean | undefined>;

export interface MetricSnapshot {
  name: string;
  kind: "counter" | "gauge" | "histogram";
  help?: string;
  labels: string[]; // label keys
  values:
    | { value: number; labels: Labels }[] // counter/gauge
    | {
        labels: Labels;
        count: number;
        sum: number;
        buckets: { le: number; count: number }[];
      }[]; // histogram
}

export interface TelemetrySink {
  onSnapshot(snaps: MetricSnapshot[], meta?: { ts: number }): void;
}

export interface MetricOptions {
  help?: string;
  labelNames?: string[];
}

type BucketConfig = number[] | "latencyMs";

const DEFAULT_LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10].map((s) => s * 1000);

// --- Utilities

const PII_LABELS = new Set(["email", "phone", "ssn", "address", "name"]);
function scrubLabels(labels: Labels | undefined): Labels {
  if (!labels) return {};
  const out: Labels = {};
  for (const k of Object.keys(labels)) {
    if (PII_LABELS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else {
      const v = labels[k];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v as any;
      else out[k] = String(v);
    }
  }
  return out;
}
function hashLabelKey(lbls: Labels, keys: string[]) {
  return keys.map((k) => `${k}=${lbls[k] ?? ""}`).join("|");
}

function now() {
  return Date.now();
}
export function hrtimeMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

// --- Metric base

abstract class MetricBase {
  constructor(
    public name: string,
    public kind: "counter" | "gauge" | "histogram",
    public help?: string,
    public labelNames: string[] = []
  ) {}
}

// --- Counter

class Counter extends MetricBase {
  private map = new Map<string, number>();
  constructor(name: string, opts?: MetricOptions) {
    super(name, "counter", opts?.help, opts?.labelNames ?? []);
  }
  inc(by = 1, labels?: Labels) {
    const clean = scrubLabels(labels);
    const key = hashLabelKey(clean, this.labelNames);
    const cur = this.map.get(key) || 0;
    this.map.set(key, cur + by);
  }
  snapshot(): MetricSnapshot {
    const values: { value: number; labels: Labels }[] = [];
    for (const [k, v] of this.map.entries()) {
      const labels: Labels = {};
      k.split("|").forEach((pair, i) => {
        const [kk, vv] = pair.split("=");
        labels[this.labelNames[i]] = vv === undefined ? "" : (isNaN(Number(vv)) ? vv : Number(vv));
        if (kk === "" && vv === undefined) {
          // no-op
        }
      });
      values.push({ value: v, labels });
    }
    return { name: this.name, kind: "counter", help: this.help, labels: this.labelNames, values };
  }
}

// --- Gauge

class Gauge extends MetricBase {
  private map = new Map<string, number>();
  constructor(name: string, opts?: MetricOptions) {
    super(name, "gauge", opts?.help, opts?.labelNames ?? []);
  }
  set(value: number, labels?: Labels) {
    const clean = scrubLabels(labels);
    const key = hashLabelKey(clean, this.labelNames);
    this.map.set(key, value);
  }
  inc(by = 1, labels?: Labels) {
    const clean = scrubLabels(labels);
    const key = hashLabelKey(clean, this.labelNames);
    const cur = this.map.get(key) || 0;
    this.map.set(key, cur + by);
  }
  dec(by = 1, labels?: Labels) {
    this.inc(-by, labels);
  }
  snapshot(): MetricSnapshot {
    const values: { value: number; labels: Labels }[] = [];
    for (const [k, v] of this.map.entries()) {
      const labels: Labels = {};
      const parts = k.split("|");
      parts.forEach((pair, i) => {
        const [kk, vv] = pair.split("=");
        labels[this.labelNames[i]] = vv === undefined ? "" : (isNaN(Number(vv)) ? vv : Number(vv));
      });
      values.push({ value: v, labels });
    }
    return { name: this.name, kind: "gauge", help: this.help, labels: this.labelNames, values };
  }
}

// --- Histogram

class Histogram extends MetricBase {
  private buckets: number[];
  private map = new Map<
    string,
    {
      count: number;
      sum: number;
      buckets: number[]; // cumulative
    }
  >();

  constructor(name: string, bucketConfig: BucketConfig = "latencyMs", opts?: MetricOptions) {
    super(name, "histogram", opts?.help, opts?.labelNames ?? []);
    this.buckets = Array.isArray(bucketConfig) ? bucketConfig.slice().sort((a, b) => a - b) : DEFAULT_LATENCY_BUCKETS;
  }
  observe(value: number, labels?: Labels) {
    const clean = scrubLabels(labels);
    const key = hashLabelKey(clean, this.labelNames);
    const entry =
      this.map.get(key) ||
      ({
        count: 0,
        sum: 0,
        buckets: new Array(this.buckets.length).fill(0),
      } as any);
    entry.count += 1;
    entry.sum += value;
    for (let i = 0; i < this.buckets.length; i++) if (value <= this.buckets[i]) entry.buckets[i] += 1;
    this.map.set(key, entry);
  }
  startTimer(labels?: Labels) {
    const t0 = hrtimeMs();
    return () => this.observe(hrtimeMs() - t0, labels);
  }
  snapshot(): MetricSnapshot {
    const out: MetricSnapshot["values"] = [];
    for (const [k, v] of this.map.entries()) {
      const labels: Labels = {};
      k.split("|").forEach((pair, i) => {
        const [kk, vv] = pair.split("=");
        labels[this.labelNames[i]] = vv === undefined ? "" : (isNaN(Number(vv)) ? vv : Number(vv));
      });
      const buckets = this.buckets.map((le, idx) => ({ le, count: v.buckets[idx] }));
      out.push({ labels, count: v.count, sum: v.sum, buckets });
    }
    return { name: this.name, kind: "histogram", help: this.help, labels: this.labelNames, values: out };
  }
}

// --- Telemetry Hub

export class Telemetry extends EventEmitter {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();
  private sinks: TelemetrySink[] = [];
  private interval?: NodeJS.Timeout;

  counter(name: string, opts?: MetricOptions) {
    if (!this.counters.has(name)) this.counters.set(name, new Counter(name, opts));
    return this.counters.get(name)!;
  }
  gauge(name: string, opts?: MetricOptions) {
    if (!this.gauges.has(name)) this.gauges.set(name, new Gauge(name, opts));
    return this.gauges.get(name)!;
  }
  histogram(name: string, buckets?: BucketConfig, opts?: MetricOptions) {
    if (!this.histograms.has(name)) this.histograms.set(name, new Histogram(name, buckets, opts));
    return this.histograms.get(name)!;
  }

  use(sink: TelemetrySink) {
    this.sinks.push(sink);
    return this;
  }

  snapshot(): MetricSnapshot[] {
    return [
      ...[...this.counters.values()].map((m) => m.snapshot()),
      ...[...this.gauges.values()].map((m) => m.snapshot()),
      ...[...this.histograms.values()].map((m) => m.snapshot()),
    ];
  }

  flush() {
    const snaps = this.snapshot();
    const meta = { ts: now() };
    for (const s of this.sinks) {
      try {
        s.onSnapshot(snaps, meta);
      } catch (e) {
        // avoid throwing from sinks
      }
    }
    this.emit("flush", snaps);
  }

  autoFlush(everyMs = 10000) {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.flush(), everyMs);
    return this;
  }

  // opinionated helpers
  trackLatency(name: string, labels?: MetricOptions & { labelValues?: Labels }) {
    const h = this.histogram(name, "latencyMs", { help: labels?.help, labelNames: labels?.labelNames });
    return h.startTimer(labels?.labelValues);
  }

  // Process self-metrics (optional)
  enableProcessMetrics(prefix = "proc") {
    const rss = this.gauge(`${prefix}_rss_bytes`);
    const heap = this.gauge(`${prefix}_heap_used_bytes`);
    const evtLoop = this.histogram(`${prefix}_event_loop_delay_ms`, [1, 5, 10, 20, 50, 100, 200, 500]);

    let last = hrtimeMs();
    setInterval(() => {
      const m = process.memoryUsage();
      rss.set(m.rss);
      heap.set(m.heapUsed);
      const nowMs = hrtimeMs();
      const delay = nowMs - last - 1000;
      if (delay > 0) evtLoop.observe(delay);
      last = nowMs;
    }, 1000);
  }
}

// --- Sinks

export class ConsoleSink implements TelemetrySink {
  constructor(private opts: { compact?: boolean } = {}) {}
  onSnapshot(snaps: MetricSnapshot[]) {
    const ts = new Date().toISOString();
    if (this.opts.compact) {
      console.log(`[${ts}] telemetry`, snaps.length, "metrics");
      return;
    }
    console.log(`[${ts}] telemetry snapshot:\n`, JSON.stringify(snaps, null, 2));
  }
}

export class PrometheusTextSink implements TelemetrySink {
  // capture latest text exposition; expose via .text()
  private textBlob = "";
  onSnapshot(snaps: MetricSnapshot[]) {
    const lines: string[] = [];
    for (const s of snaps) {
      if (s.help) lines.push(`# HELP ${s.name} ${s.help}`);
      lines.push(`# TYPE ${s.name} ${s.kind}`);
      if (s.kind === "histogram") {
        for (const v of s.values as any) {
          const base = `${s.name}_bucket`;
          for (const b of v.buckets) {
            const lbl = formatLabels({ ...(v.labels || {}), le: b.le });
            lines.push(`${base}${lbl} ${b.count}`);
          }
          lines.push(`${s.name}_bucket${formatLabels({ ...(v.labels || {}), le: "+Inf" })} ${v.count}`);
          lines.push(`${s.name}_count${formatLabels(v.labels || {})} ${v.count}`);
          lines.push(`${s.name}_sum${formatLabels(v.labels || {})} ${v.sum}`);
        }
      } else {
        for (const v of s.values as any) {
          lines.push(`${s.name}${formatLabels(v.labels || {})} ${v.value}`);
        }
      }
    }
    this.textBlob = lines.join("\n");
  }
  text() {
    return this.textBlob;
  }
}

function formatLabels(lbls: Labels) {
  const keys = Object.keys(lbls);
  if (keys.length === 0) return "";
  const esc = (v: any) =>
    `"${String(v).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"')}"`;
  const pairs = keys.map((k) => `${k}=${esc(lbls[k])}`);
  return `{${pairs.join(",")}}`;
}

// --- Singleton

export const telemetry = new Telemetry();
telemetry.use(new ConsoleSink({ compact: true })).autoFlush(15000);
