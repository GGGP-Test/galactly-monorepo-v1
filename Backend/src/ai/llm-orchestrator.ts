// src/ai/llm-orchestrator.ts
/**
 * Policy-aware LLM router & ensembles.
 *
 * - Selects provider/model per "task" (classify/extract/intent/draft/rerank)
 * - Enforces per-request budget (USD) and fallbacks
 * - Supports streaming pass-through
 * - Exposes simple "run(task, req)" API.
 *
 * Integrates nicely with:
 *  - feature-flags.ts / policy.ts for tier gating
 *  - ops/cost-tracker.ts to track tenant spend (optional)
 *  - feedback-store.ts to feed outcomes back into prompts (optional)
 */

import {
  LLMRequest, LLMResponse, LLMProvider,
  OpenAIProvider, AnthropicProvider, GrokProvider, OpenRouterProvider,
  StreamChunk
} from "./llm-providers";

type Tier = "free" | "pro" | "enterprise";
type Task =
  | "classify"   // small model, fast
  | "extract"    // JSON faithful
  | "intent"     // reasoning + retrieval synthesis
  | "draft"      // outreach email/DM
  | "rerank"     // quick relevance re-ranker
  | "explain";   // produce human explanation text

export interface OrchestratorInit {
  defaultTier?: Tier;
  perTaskModels?: Partial<Record<Task, string[]>>; // ordered by preference
  perTaskProviders?: Partial<Record<Task, ("openai"|"anthropic"|"grok"|"openrouter")[]>>;
  perTaskBudgetUSD?: Partial<Record<Task, number>>;
  allowStreaming?: boolean;
}

export interface OrchestratorContext {
  tenantId: string;
  tier: Tier;
  requestId?: string;
  // Optional hooks
  costTracker?: {
    addCost: (tenantId: string, usd: number, meta: { task: Task; model: string; provider: string; requestId?: string }) => Promise<void> | void;
    getRemainingBudget?: (tenantId: string) => Promise<number> | number;
  };
  audit?: (event: string, data: any) => void;
  feedback?: {
    // (optional) user-level prompt tuning or few-shot retrieval by task
    getFewShot?: (task: Task, tenantId: string) => Promise<Array<{role:"user"|"assistant"|"system", content: string}>> | Array<{role:"user"|"assistant"|"system", content: string}>;
  };
}

export class LLMOrchestrator {
  private perTaskModels: Required<OrchestratorInit["perTaskModels"]>;
  private perTaskProviders: Required<OrchestratorInit["perTaskProviders"]>;
  private perTaskBudgetUSD: Required<OrchestratorInit["perTaskBudgetUSD"]>;
  private allowStreaming: boolean;

  constructor(private init: OrchestratorInit = {}) {
    // Default model preferences (tweak to your contracts & taste)
    this.perTaskModels = {
      classify: [
        process.env.LLM_CLASSIFY_MODEL || "gpt-4o-mini",
        "openrouter/llama-3.1-70b",
      ],
      extract: [
        process.env.LLM_EXTRACT_MODEL || "gpt-4o-mini",
        "claude-3-5-sonnet",
      ],
      intent: [
        process.env.LLM_INTENT_MODEL || "gpt-4o",
        "claude-3-5-sonnet",
        "grok-2",
      ],
      draft: [
        process.env.LLM_DRAFT_MODEL || "gpt-4o",
        "claude-3-5-sonnet",
      ],
      rerank: [
        process.env.LLM_RERANK_MODEL || "gpt-4o-mini",
        "openrouter/mixtral-8x7b",
      ],
      explain: [
        process.env.LLM_EXPLAIN_MODEL || "gpt-4o-mini",
        "openrouter/llama-3.1-70b",
      ],
      ...(init.perTaskModels || {})
    } as any;

    // Default provider preferences per task
    this.perTaskProviders = {
      classify: ["openai", "openrouter", "anthropic"],
      extract: ["openai", "anthropic", "openrouter"],
      intent: ["openai", "anthropic", "grok", "openrouter"],
      draft: ["openai", "anthropic", "openrouter"],
      rerank: ["openai", "openrouter"],
      explain: ["openai", "openrouter"],
      ...(init.perTaskProviders || {})
    } as any;

    // Soft per-call budget (overshoot okay but discouraged)
    this.perTaskBudgetUSD = {
      classify: 0.02,
      extract: 0.05,
      intent: 0.15,
      draft: 0.10,
      rerank: 0.01,
      explain: 0.02,
      ...(init.perTaskBudgetUSD || {})
    } as any;

    this.allowStreaming = init.allowStreaming ?? true;
  }

  /** Heuristic provider factory by name. */
  private buildProvider(name: "openai"|"anthropic"|"grok"|"openrouter"): LLMProvider {
    switch (name) {
      case "openai": return new OpenAIProvider();
      case "anthropic": return new AnthropicProvider();
      case "grok": return new GrokProvider();
      case "openrouter": return new OpenRouterProvider();
    }
  }

  /** Prepare messages with system preamble per task, inject few-shots if available. */
  private async buildMessages(task: Task, base: LLMRequest["messages"], ctx: OrchestratorContext): Promise<LLMRequest["messages"]> {
    const preambles: Partial<Record<Task, string>> = {
      classify: "You label the company's vertical and packaging needs. Be concise and deterministic.",
      extract: "You extract structured JSON from messy text. Output only valid JSON that matches the schema.",
      intent: "You infer purchase intent and operational needs from signals. Reason step-by-step internally, then output concise conclusions.",
      draft: "You write short, buyer-first outreach copy tailored to packaging needs and channels. Be specific, never fluffy.",
      rerank: "You re-rank items by relevance to the query and explain briefly.",
      explain: "You explain the score drivers in clear, human language. Keep it honest and actionable.",
    };

    const sys = preambles[task] ? [{ role: "system" as const, content: preambles[task]! }] : [];
    const shots = await Promise.resolve(ctx.feedback?.getFewShot?.(task, ctx.tenantId) ?? []);
    return [...sys, ...(shots || []), ...base];
  }

  /** Route model/provider for a task with fallbacks. */
  private *candidates(task: Task): Generator<{ provider: "openai"|"anthropic"|"grok"|"openrouter"; model: string }> {
    const models = this.perTaskModels[task];
    const providers = this.perTaskProviders[task];
    // Try each provider with the first compatible model; otherwise attempt others.
    for (const prov of providers) {
      for (const model of models) {
        yield { provider: prov, model };
      }
    }
  }

  /** Non-streaming high-level run. */
  async run(task: Task, req: Omit<LLMRequest, "model">, ctx: OrchestratorContext): Promise<LLMResponse> {
    const messages = await this.buildMessages(task, req.messages, ctx);
    const budget = this.perTaskBudgetUSD[task];

    let lastErr: any;
    for (const cand of this.candidates(task)) {
      const provider = this.buildProvider(cand.provider);
      try {
        const resp = await provider.call({
          ...req,
          model: cand.model,
          messages,
          meta: { tenantId: ctx.tenantId, requestId: ctx.requestId, purpose: task },
        });
        // Optional: budget check (best-effort; providers differ on usage availability)
        if (typeof resp.cost_usd === "number" && resp.cost_usd > budget * 3) {
          // too expensive; try next candidate
          lastErr = new Error(`Cost ${resp.cost_usd} exceeded budget ${budget} (candidate: ${cand.model})`);
          continue;
        }
        // Record cost if available
        if (ctx.costTracker && typeof resp.cost_usd === "number") {
          await ctx.costTracker.addCost(ctx.tenantId, resp.cost_usd, {
            task, model: resp.model, provider: resp.provider, requestId: ctx.requestId
          });
        }
        ctx.audit?.("llm.success", { task, provider: cand.provider, model: cand.model, requestId: ctx.requestId });
        return resp;
      } catch (err: any) {
        lastErr = err;
        ctx.audit?.("llm.error", { task, provider: cand.provider, model: cand.model, requestId: ctx.requestId, err: err?.message });
        // fallback to next
      }
    }
    throw lastErr ?? new Error("No provider/model succeeded.");
  }

  /** Streaming high-level run. */
  async *runStream(task: Task, req: Omit<LLMRequest, "model">, ctx: OrchestratorContext): AsyncGenerator<StreamChunk, LLMResponse, void> {
    if (!this.allowStreaming || !req.stream) {
      // fallback to non-stream call
      const final = await this.run(task, req, ctx);
      yield { contentDelta: final.content, usage: final.usage };
      return final;
    }

    const messages = await this.buildMessages(task, req.messages, ctx);

    let lastErr: any;
    for (const cand of this.candidates(task)) {
      const provider = this.buildProvider(cand.provider);
      try {
        const stream = provider.stream({
          ...req,
          model: cand.model,
          messages,
          meta: { tenantId: ctx.tenantId, requestId: ctx.requestId, purpose: task },
        });

        let acc = "";
        let final: LLMResponse | undefined;

        for await (const chunk of stream) {
          if (chunk.contentDelta) acc += chunk.contentDelta;
          yield chunk;
          // provider returns final response object when stream completes
          // but because we're yielding chunks directly, we capture it after loop
        }
        // The `return` value from async generator is obtained via `next().value` after done=true,
        // but since we're proxying, we call provider.stream again to get return? Not needed:
        // most implementations return final at generator completion; capture with `final = (yield* ...)`
        // To simplify, produce synthetic final:
        final = {
          provider: provider.name,
          model: cand.model,
          created: Date.now(),
          content: acc,
          requestId: ctx.requestId,
        };
        if (ctx.costTracker && typeof final.cost_usd === "number") {
          await ctx.costTracker.addCost(ctx.tenantId, final.cost_usd, {
            task, model: final.model, provider: final.provider, requestId: ctx.requestId
          });
        }
        ctx.audit?.("llm.success", { task, provider: cand.provider, model: cand.model, requestId: ctx.requestId, streamed: true });
        return final;
      } catch (err: any) {
        lastErr = err;
        ctx.audit?.("llm.error", { task, provider: cand.provider, model: cand.model, requestId: ctx.requestId, err: err?.message, streamed: true });
      }
    }
    throw lastErr ?? new Error("No provider/model succeeded (stream).");
  }
}

/* ===================== Convenience helpers ====================== */

export function makeOrchestrator(init?: Partial<OrchestratorInit>) {
  return new LLMOrchestrator(init);
}

/**
 * Task-specific thin wrappers
 */
export async function classify(messages: LLMRequest["messages"], ctx: OrchestratorContext, init?: Partial<OrchestratorInit>) {
  const orch = new LLMOrchestrator(init);
  return orch.run("classify", { messages }, ctx);
}
export async function extract(messages: LLMRequest["messages"], ctx: OrchestratorContext, init?: Partial<OrchestratorInit>) {
  const orch = new LLMOrchestrator(init);
  return orch.run("extract", { messages }, ctx);
}
export async function intent(messages: LLMRequest["messages"], ctx: OrchestratorContext, init?: Partial<OrchestratorInit>) {
  const orch = new LLMOrchestrator(init);
  return orch.run("intent", { messages }, ctx);
}
export async function draft(messages: LLMRequest["messages"], ctx: OrchestratorContext, init?: Partial<OrchestratorInit>) {
  const orch = new LLMOrchestrator(init);
  return orch.run("draft", { messages }, ctx);
}
export async function explain(messages: LLMRequest["messages"], ctx: OrchestratorContext, init?: Partial<OrchestratorInit>) {
  const orch = new LLMOrchestrator(init);
  return orch.run("explain", { messages }, ctx);
}
export async function rerank(messages: LLMRequest["messages"], ctx: OrchestratorContext, init?: Partial<OrchestratorInit>) {
  const orch = new LLMOrchestrator(init);
  return orch.run("rerank", { messages }, ctx);
}
