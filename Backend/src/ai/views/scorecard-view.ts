// src/ai/views/scorecard-view.ts
// Headless scorecard assembler + minimal HTML/JSON renderers for lead fit & intent.
// No external deps. Works in both Node and browser.

export type DimensionKey =
  | "intent"
  | "fit"
  | "timing"
  | "goodwill"
  | "channel"
  | "risk";

export interface ScoreInput {
  leadId: string;
  leadName?: string;
  // 0..1 raw signals (already normalized upstream), optional
  signals?: Partial<Record<DimensionKey, number>>;
  // explanations for transparency
  notes?: Partial<Record<DimensionKey, string[]>>;
  // comparable past scores for trend arrows
  previous?: Partial<Record<DimensionKey, number>>;
  // user- or org-chosen weights; default inside
  weights?: Partial<Record<DimensionKey, number>>;
  // optional tags for UI
  tags?: string[];
}

export interface ScoreBreakdown {
  key: DimensionKey;
  score: number; // 0..100
  grade: "A" | "B" | "C" | "D" | "F";
  delta?: number; // vs previous, in points
  rationale?: string[];
}

export interface Scorecard {
  leadId: string;
  leadName?: string;
  overall: number; // 0..100
  grade: ScoreBreakdown["grade"];
  dims: ScoreBreakdown[];
  tags?: string[];
  createdAt: number;
  weightModel: Record<DimensionKey, number>;
}

const DEFAULT_WEIGHTS: Record<DimensionKey, number> = {
  intent: 0.34,
  fit: 0.22,
  timing: 0.18,
  goodwill: 0.08,
  channel: 0.12,
  risk: -0.14, // negative weight: higher risk lowers overall
};

const ORDER: DimensionKey[] = ["intent", "fit", "timing", "channel", "goodwill", "risk"];

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const toPct = (x: number) => Math.round(clamp(x) * 100);
const grade = (p: number): ScoreBreakdown["grade"] =>
  p >= 90 ? "A" : p >= 80 ? "B" : p >= 70 ? "C" : p >= 60 ? "D" : "F";

function normalizeWeights(w: Partial<Record<DimensionKey, number>> | undefined): Record<DimensionKey, number> {
  const merged: Record<DimensionKey, number> = { ...DEFAULT_WEIGHTS, ...(w ?? {}) } as any;
  // separate positive & negative bands to preserve "risk" subtractive semantics
  const posKeys = ORDER.filter(k => (merged[k] ?? 0) > 0);
  const negKeys = ORDER.filter(k => (merged[k] ?? 0) < 0);
  let posSum = posKeys.reduce((s, k) => s + (merged[k] ?? 0), 0);
  let negSum = Math.abs(negKeys.reduce((s, k) => s + (merged[k] ?? 0), 0));
  if (posSum <= 0) posSum = 1;
  if (negSum <= 0) negSum = 1;
  const norm: Record<DimensionKey, number> = merged as any;
  for (const k of posKeys) norm[k] = (merged[k] as number) / posSum;
  for (const k of negKeys) norm[k] = (merged[k] as number) / negSum; // remains negative magnitude normalized
  return norm;
}

export function buildScorecard(input: ScoreInput): Scorecard {
  const weights = normalizeWeights(input.weights);
  const dims: ScoreBreakdown[] = ORDER.map((key) => {
    // default conservative values if missing:
    const base = key === "risk" ? 0.2 : 0.5;
    const raw = input.signals?.[key] ?? base;
    const prev = input.previous?.[key];
    const score = toPct(raw);
    const delta = prev === undefined ? undefined : score - toPct(prev);
    return {
      key,
      score,
      grade: grade(score),
      delta,
      rationale: input.notes?.[key],
    };
  });

  // weighted sum with subtractive risk
  let pos = 0;
  let neg = 0;
  for (const d of dims) {
    const w = weights[d.key];
    if (w >= 0) pos += d.score * w;
    else neg += d.score * Math.abs(w);
  }
  // risk subtracts; floor at 0, cap at 100
  const overall = Math.max(0, Math.min(100, Math.round(pos - neg)));
  const sc: Scorecard = {
    leadId: input.leadId,
    leadName: input.leadName,
    overall,
    grade: grade(overall),
    dims,
    tags: input.tags,
    createdAt: Date.now(),
    weightModel: weights,
  };
  return sc;
}

// ----- View helpers -----

export interface ViewModel {
  title: string;
  subtitle?: string;
  overall: { score: number; grade: ScoreBreakdown["grade"]; bar: string };
  dims: Array<{
    key: DimensionKey;
    label: string;
    score: number;
    grade: ScoreBreakdown["grade"];
    delta?: number;
    arrow?: "up" | "down" | "flat";
    bar: string;
    tooltip?: string;
  }>;
  tags?: string[];
  createdAt: number;
}

const LABELS: Record<DimensionKey, string> = {
  intent: "Buying Intent",
  fit: "Product Fit",
  timing: "Timing",
  goodwill: "Goodwill",
  channel: "Best Channel",
  risk: "Risk",
};

const spark = (p: number, width = 20) => {
  const filled = Math.round((clamp(p / 100, 0, 1)) * width);
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
};

export function toViewModel(sc: Scorecard): ViewModel {
  return {
    title: sc.leadName ?? sc.leadId,
    subtitle: "Lead Scorecard",
    overall: { score: sc.overall, grade: sc.grade, bar: spark(sc.overall) },
    dims: sc.dims.map((d) => ({
      key: d.key,
      label: LABELS[d.key],
      score: d.score,
      grade: d.grade,
      delta: d.delta,
      arrow: d.delta === undefined ? undefined : d.delta > 0 ? "up" : d.delta < 0 ? "down" : "flat",
      bar: spark(d.score),
      tooltip: d.rationale?.join("\n"),
    })),
    tags: sc.tags,
    createdAt: sc.createdAt,
  };
}

export function renderScorecardHTML(sc: Scorecard): string {
  const vm = toViewModel(sc);
  const row = (k: string, s: number, g: string, bar: string, delta?: number) =>
    `<div class="sc-row"><span class="sc-key">${k}</span><span class="sc-bar mono">${bar}</span><span class="sc-score">${s}</span><span class="sc-grade">${g}</span><span class="sc-delta">${delta === undefined ? "" : (delta > 0 ? "▲" : delta < 0 ? "▼" : "•")} ${delta ?? ""}</span></div>`;
  const dims = vm.dims.map(d => row(d.label, d.score, d.grade, d.bar, d.delta)).join("");
  const tags = vm.tags?.map(t => `<span class="tag">${t}</span>`).join(" ") ?? "";
  return `
<div class="scorecard">
  <div class="sc-header">
    <div class="sc-title">${vm.title}</div>
    <div class="sc-sub">${vm.subtitle ?? ""}</div>
  </div>
  <div class="sc-overall">
    <div class="sc-overall-grade">${vm.overall.grade}</div>
    <div class="sc-overall-bar mono">${vm.overall.bar}</div>
    <div class="sc-overall-score">${vm.overall.score}</div>
  </div>
  <div class="sc-dims">${dims}</div>
  <div class="sc-tags">${tags}</div>
</div>
<style>
.scorecard{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border:1px solid #ddd;border-radius:8px;padding:12px;max-width:640px}
.sc-header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
.sc-title{font-weight:600}
.sc-sub{opacity:.7;font-size:12px}
.sc-overall{display:flex;gap:8px;align-items:center;margin:8px 0}
.sc-overall-grade{font-size:20px;font-weight:700}
.sc-overall-bar{flex:1}
.sc-overall-score{width:44px;text-align:right}
.sc-dims{display:grid;grid-template-columns:1fr;gap:6px}
.sc-row{display:grid;grid-template-columns:140px 1fr 44px 24px 48px;gap:6px;align-items:center}
.mono{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
.tag{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:2px 8px;font-size:12px;margin-right:4px}
</style>`;
}

export function renderScorecardJSON(sc: Scorecard) {
  const vm = toViewModel(sc);
  return {
    leadId: sc.leadId,
    leadName: sc.leadName,
    overall: vm.overall,
    dimensions: vm.dims.map(d => ({
      key: d.key,
      label: d.label,
      score: d.score,
      grade: d.grade,
      delta: d.delta,
      trend: d.arrow,
      bar: d.bar, // useful for CLIs/logs
      rationale: sc.dims.find(x => x.key === d.key)?.rationale,
    })),
    tags: vm.tags,
    createdAt: vm.createdAt,
    weights: sc.weightModel,
  };
}
