// src/ai/agent-coordinator.ts
/**
 * AgentCoordinator — orchestrates specialized AI agents for:
 * - "intent": infer purchase intent from site + context
 * - "enrich": augment lead with structured attributes (vertical, size, stack)
 * - "contacts": pull contacts using third-party APIs (delegates to contacts-resolver)
 * - "channel": recommend best-first outreach channel and copy angle
 * - "explain": generate seller-facing rationale & suggested next steps
 *
 * Each agent consumes messages and returns a normalized result.
 */

import { makeOrchestrator } from "./llm-orchestrator";
import { type LeadSignals } from "../signals";
import { type ExtractedProfile } from "../classify-extract";
import { resolveContacts, type ContactResolveConfig } from "../integrations/contacts-resolver";
import { defaultCostTracker } from "../ops/cost-tracker";
import { auditLog } from "../security/audit-log";

export type AgentKind = "intent" | "enrich" | "contacts" | "channel" | "explain";

export interface AgentContext {
  tenantId: string;
  requestId?: string;
  tier: "free" | "pro";
  locale?: string;
  costCapHintUSD?: number;
}

export interface AgentTask<TKind extends AgentKind = AgentKind> {
  kind: TKind;
  website?: string;
  domain?: string;
  companyName?: string;
  signals?: LeadSignals;
  extracted?: ExtractedProfile;
  userOffering?: string; // what the seller provides (e.g., "custom corrugate boxes, NJ")
  contactsCfg?: ContactResolveConfig;
  freeform?: Record<string, any>;
}

export interface AgentResult {
  kind: AgentKind;
  model: string;
  provider: string;
  cost_usd?: number;
  usage?: any;
  content?: string; // raw LLM answer when relevant
  data?: any;       // normalized output
}

type OrchestratorRun = ReturnType<typeof makeOrchestrator>["run"];

function ensureReqId() {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
}

export class AgentCoordinator {
  constructor(private runLLM?: OrchestratorRun) {}

  private orchestration() {
    return this.runLLM ?? makeOrchestrator().run;
  }

  /** Execute a single agent with budget guard + audit. */
  async run(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const requestId = ctx.requestId || ensureReqId();
    const tenantId = ctx.tenantId || "anon";
    const runLLM = this.orchestration();

    const baseAudit = (ev: string, data?: any) =>
      auditLog.log(`agent.${ev}`, data, { tenantId, requestId });

    await baseAudit("start", { kind: task.kind, website: task.website, domain: task.domain });

    switch (task.kind) {
      case "contacts": {
        const out = await resolveContacts(
          task.domain || task.website || "",
          task.companyName || "",
          task.contactsCfg || {},
          { tenantId, requestId }
        );
        await baseAudit("contacts.done", { found: out.candidates?.length || 0 });
        return {
          kind: "contacts",
          model: "api",
          provider: "contacts-resolver",
          data: out,
        };
      }

      case "enrich": {
        // Convert signals + extracted to concise enrichment prompt
        const messages = [
          {
            role: "user" as const,
            content: [
              "You are a B2B data enricher for packaging suppliers.",
              "Given raw signals about a company, infer structured attributes:",
              "- industry sub-vertical (packaging-focused)",
              "- company size band (1-10, 11-50, 51-200, 201-500, 500+)",
              "- geographic focus (state/region for US/CA)",
              "- primary packaging materials used (top 3)",
              "- purchase frequency (weekly/monthly/quarterly)",
              "- likely procurement roles (titles)",
              "- risk flags (gov-only, giant enterprise, reseller-only, etc.)",
              "",
              `COMPANY: ${task.companyName || "(n/a)"} (${task.domain || task.website || ""})`,
              `OFFERING: ${task.userOffering || "(unspecified)"}`,
              `SIGNALS: ${JSON.stringify(task.signals || {}).slice(0, 3000)}`,
              `EXTRACTED: ${JSON.stringify(task.extracted || {}).slice(0, 3000)}`,
              "",
              "Return JSON with keys: { vertical, sizeBand, region, materials, purchaseCadence, roles, risk }.",
            ].join("\n"),
          },
        ];

        const resp = await runLLM("enrich", { messages }, {
          tenantId,
          tier: ctx.tier,
          requestId,
          costTracker: {
            addCost: defaultCostTracker.addCost.bind(defaultCostTracker),
            getRemainingBudget: defaultCostTracker.getRemainingBudget.bind(defaultCostTracker),
          },
          audit: (ev, data) => baseAudit(`llm.${ev}`, data),
        });

        await baseAudit("enrich.done", { model: resp.model, provider: resp.provider });
        let data: any = undefined;
        try { data = JSON.parse(resp.content); } catch { /* keep raw */ }
        return { kind: "enrich", model: resp.model, provider: resp.provider, cost_usd: resp.cost_usd, usage: resp.usage, content: resp.content, data };
      }

      case "intent": {
        const messages = [
          {
            role: "user" as const,
            content: [
              "You are a packaging-buying intent detector.",
              "From signals+profile, rate near-term purchase likelihood for the seller's offering:",
              "- 0-100 score (SCORE: N)",
              "- key drivers (+) and blockers (-)",
              "- 3 immediate actions for sales",
              "",
              `OFFERING: ${task.userOffering || "(unspecified)"}`,
              `COMPANY: ${task.companyName || "(n/a)"} (${task.domain || task.website || ""})`,
              `SIGNALS: ${JSON.stringify(task.signals || {}).slice(0, 3000)}`,
              `PROFILE: ${JSON.stringify(task.extracted || {}).slice(0, 3000)}`,
            ].join("\n"),
          },
        ];

        const resp = await runLLM("intent", { messages }, {
          tenantId,
          tier: ctx.tier,
          requestId,
          costTracker: {
            addCost: defaultCostTracker.addCost.bind(defaultCostTracker),
            getRemainingBudget: defaultCostTracker.getRemainingBudget.bind(defaultCostTracker),
          },
          audit: (ev, data) => baseAudit(`llm.${ev}`, data),
        });

        const m = resp.content.match(/SCORE:\s*([0-9]{1,3})/i);
        const score = m ? Math.max(0, Math.min(100, parseInt(m[1], 10))) : undefined;
        await baseAudit("intent.done", { score });
        return {
          kind: "intent",
          model: resp.model,
          provider: resp.provider,
          content: resp.content,
          data: { score },
          cost_usd: resp.cost_usd,
          usage: resp.usage,
        };
      }

      case "channel": {
        const messages = [
          {
            role: "user" as const,
            content: [
              "You are a channel strategist for B2B packaging sales.",
              "Recommend best-first channel and a 3-step sequence:",
              "- Choose one: {email, phone, linkedin, form, partner}",
              "- Give subject/hook and first message (<=120 words)",
              "- Explain why this channel fits the buyer",
              "",
              `OFFERING: ${task.userOffering || "(unspecified)"}`,
              `COMPANY: ${task.companyName || "(n/a)"} (${task.domain || task.website || ""})`,
              `SIGNALS: ${JSON.stringify(task.signals || {}).slice(0, 2000)}`,
              `PROFILE: ${JSON.stringify(task.extracted || {}).slice(0, 2000)}`,
            ].join("\n"),
          },
        ];
        const resp = await runLLM("channel", { messages }, {
          tenantId,
          tier: ctx.tier,
          requestId,
          costTracker: {
            addCost: defaultCostTracker.addCost.bind(defaultCostTracker),
            getRemainingBudget: defaultCostTracker.getRemainingBudget.bind(defaultCostTracker),
          },
          audit: (ev, data) => baseAudit(`llm.${ev}`, data),
        });
        await baseAudit("channel.done", { model: resp.model });
        return { kind: "channel", model: resp.model, provider: resp.provider, content: resp.content, cost_usd: resp.cost_usd, usage: resp.usage };
      }

      case "explain": {
        const messages = [
          {
            role: "user" as const,
            content: [
              "You are a succinct deal coach.",
              "Write a brief rationale (<=120 words) translating signals to business value for the seller.",
              `CONTEXT: ${JSON.stringify(task.freeform || {}).slice(0, 3000)}`,
            ].join("\n"),
          },
        ];
        const resp = await runLLM("explain", { messages }, {
          tenantId,
          tier: ctx.tier,
          requestId,
          costTracker: {
            addCost: defaultCostTracker.addCost.bind(defaultCostTracker),
            getRemainingBudget: defaultCostTracker.getRemainingBudget.bind(defaultCostTracker),
          },
          audit: (ev, data) => baseAudit(`llm.${ev}`, data),
        });
        await baseAudit("explain.done", {});
        return { kind: "explain", model: resp.model, provider: resp.provider, content: resp.content, cost_usd: resp.cost_usd, usage: resp.usage };
      }

      default:
        await baseAudit("error", { message: `Unknown kind ${task.kind}` });
        throw new Error(`Unknown kind ${task.kind}`);
    }
  }

  /** Run multiple agents and gather results. */
  async runAll(tasks: AgentTask[], ctx: AgentContext): Promise<Record<AgentKind, AgentResult | undefined>> {
    const out: Partial<Record<AgentKind, AgentResult>> = {};
    for (const t of tasks) {
      try {
        const r = await this.run(t, ctx);
        out[t.kind] = r;
      } catch (e) {
        await auditLog.log("agent.failed", { kind: t.kind, err: (e as any)?.message }, { tenantId: ctx.tenantId, requestId: ctx.requestId }, "error");
        out[t.kind] = undefined;
      }
    }
    return out as Record<AgentKind, AgentResult | undefined>;
  }
}

export function makeAgentCoordinator() {
  return new AgentCoordinator();
}
