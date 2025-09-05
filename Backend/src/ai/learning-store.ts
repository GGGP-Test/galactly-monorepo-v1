// src/ai/learning-store.ts
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

// --- Types

export type LearnablePlan = "free" | "pro";

export type LearningEventType =
  | "LEAD_ACCEPTED"
  | "LEAD_REJECTED"
  | "LEAD_CONTACTED"
  | "REPLY_POSITIVE"
  | "REPLY_NEGATIVE"
  | "MEETING_SET"
  | "WIN"
  | "LOSS"
  | "MODEL_RESPONSE_RATED"
  | "CLICK"
  | "OPEN";

export interface LearningEvent {
  id: string;
  ts: number;
  tenantId: string;
  userId: string;
  plan: LearnablePlan;
  type: LearningEventType;
  entity?: { kind: "lead" | "message" | "campaign" | "model" | "search"; id: string };
  // sparse features captured at the time of event
  features?: Record<string, number>;
  // rating in [-1,1] where applicable
  label?: number;
  meta?: Record<string, unknown>;
}

export interface UserWeights {
  tenantId: string;
  userId: string;
  version: number;
  updatedAt: number;
  // Linear model weights over sparse feature keys
  weights: Record<string, number>;
  // bias term
  bias: number;
  // counts for online learning
  seen: number;
}

export interface LearningStore {
  record(ev: LearningEvent): Promise<void>;
  latest(n?: number, filter?: Partial<Pick<LearningEvent, "tenantId" | "userId" | "type">>): Promise<LearningEvent[]>;
  getUserWeights(tenantId: string, userId: string): Promise<UserWeights>;
  setUserWeights(w: UserWeights): Promise<void>;
  // online update (logistic regression style)
  updateFromEvent(ev: LearningEvent, lr?: number, l2?: number): Promise<UserWeights>;
  score(features: Record<string, number>, w: UserWeights): number;
  personalize(baseScore: number, features: Record<string, number>, w: UserWeights): number;
  export(tenantId: string): Promise<{ events: LearningEvent[]; weights: UserWeights[] }>;
  import(payload: { events: LearningEvent[]; weights: UserWeights[] }): Promise<void>;
}

// --- Utilities

function now() {
  return Date.now();
}
function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function dot(a: Record<string, number>, b: Record<string, number>) {
  let s = 0;
  for (const k in a) if (b[k] !== undefined) s += a[k] * b[k];
  return s;
}
function sigmoid(x: number) {
  if (x > 20) return 1.0;
  if (x < -20) return 0.0;
  return 1 / (1 + Math.exp(-x));
}
function clipLabel(y?: number) {
  // map [-1,1] -> [0,1] where -1 => 0, +1 => 1, undefined => 0.5 neutral
  if (y === undefined || Number.isNaN(y)) return 0.5;
  return Math.max(0, Math.min(1, (y + 1) / 2));
}
function prune(features: Record<string, number>, max = 512) {
  // keep largest magnitude features up to max
  const entries = Object.entries(features);
  if (entries.length <= max) return features;
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return Object.fromEntries(entries.slice(0, max));
}

const DEFAULT_WEIGHTS: UserWeights = {
  tenantId: "default",
  userId: "default",
  version: 1,
  updatedAt: 0,
  weights: {},
  bias: 0,
  seen: 0,
};

// --- Memory implementation

export class MemoryLearningStore implements LearningStore {
  private events: LearningEvent[] = [];
  private weights = new Map<string, UserWeights>(); // key tenant:user

  private key(t: string, u: string) {
    return `${t}:${u}`;
  }

  async record(ev: LearningEvent): Promise<void> {
    // Do not learn from free plan beyond anonymous analytics
    this.events.push({ ...ev, id: ev.id || id(), ts: ev.ts || now() });
  }

  async latest(n = 100, filter?: Partial<Pick<LearningEvent, "tenantId" | "userId" | "type">>): Promise<LearningEvent[]> {
    let arr = this.events.slice();
    if (filter?.tenantId) arr = arr.filter((e) => e.tenantId === filter.tenantId);
    if (filter?.userId) arr = arr.filter((e) => e.userId === filter.userId);
    if (filter?.type) arr = arr.filter((e) => e.type === filter.type);
    return arr.slice(-n);
  }

  async getUserWeights(tenantId: string, userId: string): Promise<UserWeights> {
    return this.weights.get(this.key(tenantId, userId)) || { ...DEFAULT_WEIGHTS, tenantId, userId };
  }

  async setUserWeights(w: UserWeights): Promise<void> {
    this.weights.set(this.key(w.tenantId, w.userId), w);
  }

  async updateFromEvent(ev: LearningEvent, lr = 0.1, l2 = 1e-4): Promise<UserWeights> {
    // Only learn for paid plans
    if (ev.plan !== "pro") return this.getUserWeights(ev.tenantId, ev.userId);

    const features = prune(ev.features || {});
    if (Object.keys(features).length === 0) return this.getUserWeights(ev.tenantId, ev.userId);

    const w = { ...(await this.getUserWeights(ev.tenantId, ev.userId)) };
    const y = clipLabel(ev.label);
    const pred = sigmoid(w.bias + dot(features, w.weights));
    const err = y - pred; // gradient for logistic loss

    // L2 regularization & SGD update
    for (const k of Object.keys(features)) {
      const g = -err * features[k] + l2 * (w.weights[k] || 0);
      const nw = (w.weights[k] || 0) - lr * g;
      // keep weights bounded for stability
      w.weights[k] = Math.max(-5, Math.min(5, nw));
    }
    w.bias = Math.max(-3, Math.min(3, w.bias - lr * (-err)));
    w.seen += 1;
    w.updatedAt = now();
    await this.setUserWeights(w);
    return w;
  }

  score(features: Record<string, number>, w: UserWeights): number {
    if (!features) return w.bias;
    return w.bias + dot(features, w.weights);
  }

  personalize(baseScore: number, features: Record<string, number>, w: UserWeights): number {
    const p = sigmoid(this.score(prune(features || {}), w));
    // blend: if weights are immature, lean more on base
    const alpha = Math.min(0.8, w.seen / 50); // 0..0.8
    return (1 - alpha) * baseScore + alpha * p;
  }

  async export(tenantId: string) {
    const events = this.events.filter((e) => e.tenantId === tenantId);
    const weights: UserWeights[] = [];
    for (const [key, w] of this.weights) if (key.startsWith(`${tenantId}:`)) weights.push(w);
    return { events, weights };
  }

  async import(payload: { events: LearningEvent[]; weights: UserWeights[] }) {
    this.events.push(...payload.events);
    payload.weights.forEach((w) => this.setUserWeights(w));
  }
}

// --- File-backed (append-only JSONL) implementation

export class FileLearningStore extends MemoryLearningStore {
  constructor(private filePath: string, private weightsPath = filePath + ".weights.json") {
    super();
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(filePath)) writeFileSync(filePath, "");
    if (existsSync(weightsPath)) {
      try {
        const json = JSON.parse(readFileSync(weightsPath, "utf8"));
        if (Array.isArray(json)) json.forEach((w) => this.setUserWeights(w));
      } catch {
        /* ignore */
      }
    }
  }

  override async record(ev: LearningEvent): Promise<void> {
    await super.record(ev);
    appendFileSync(this.filePath, JSON.stringify(ev) + "\n", "utf8");
  }

  override async setUserWeights(w: UserWeights): Promise<void> {
    await super.setUserWeights(w);
    // Persist all weights snapshot (small)
    const exportWeights = JSON.parse(readFileSync(this.weightsPath, "utf8" as any) || "[]");
    const map: Record<string, UserWeights> = {};
    if (Array.isArray(exportWeights)) {
      for (const item of exportWeights) map[`${item.tenantId}:${item.userId}`] = item;
    }
    map[`${w.tenantId}:${w.userId}`] = w;
    writeFileSync(this.weightsPath, JSON.stringify(Object.values(map)));
  }
}

// --- Helper: construct learning features for common events

export function makeLeadOutcomeEvent(args: {
  tenantId: string;
  userId: string;
  plan: LearnablePlan;
  leadId: string;
  vertical?: string;
  region?: string;
  dealSizeUSD?: number;
  responseMinutes?: number;
  source?: string;
  tags?: string[];
  label: -1 | 0 | 1; // -1 loss, 0 neutral, 1 win
  type?: Extract<LearningEventType, "WIN" | "LOSS" | "LEAD_ACCEPTED" | "LEAD_REJECTED">;
}): LearningEvent {
  const features: Record<string, number> = {};
  if (args.vertical) features[`vertical:${args.vertical}`] = 1;
  if (args.region) features[`region:${args.region}`] = 1;
  if (args.source) features[`source:${args.source}`] = 1;
  if (args.tags) args.tags.forEach((t) => (features[`tag:${t}`] = 1));
  if (typeof args.dealSizeUSD === "number") features["deal:size:bucket"] = Math.log(1 + Math.max(0, args.dealSizeUSD)) / 10;
  if (typeof args.responseMinutes === "number")
    features["response:bucket"] = Math.log(1 + Math.max(1, args.responseMinutes)) / 5;

  return {
    id: "",
    ts: 0,
    tenantId: args.tenantId,
    userId: args.userId,
    plan: args.plan,
    type: args.type || (args.label > 0 ? "WIN" : args.label < 0 ? "LOSS" : "LEAD_ACCEPTED"),
    entity: { kind: "lead", id: args.leadId },
    features,
    label: args.label,
  };
}
