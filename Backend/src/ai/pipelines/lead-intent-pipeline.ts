// src/ai/pipelines/lead-intent-pipeline.ts
/**
 * LeadIntentPipeline — end-to-end flow:
 *  1) seed candidates (lead-sources)
 *  2) crawl + extract HTML -> signals + extracted profile
 *  3) run AI agents: enrich, intent, channel, explain
 *  4) resolve contacts
 *  5) assemble scorecard result
 *
 *  Storage is pluggable via LeadStore interface.
 */

import { type LeadSourceQuery, enumerateCandidates } from "../../leadgen/lead-sources";
import { crawlOne } from "../../crawl/crawl-worker";
import { extractAllFromHtml, type ExtractedProfile } from "../../classify-extract";
import { buildSignals, type LeadSignals } from "../../signals";
import { DedupeIndex } from "../../leadgen/dedupe-index";
import { resolveContacts } from "../../integrations/contacts-resolver";
import { AgentCoordinator, makeAgentCoordinator } from "../agent-coordinator";
import { auditLog } from "../../security/audit-log";

export type PipelineTier = "free" | "pro";

export interface LeadStore {
  upsert(data: PipelineOutput): Promise<void>;
  existsByDomain?(domain: string): Promise<boolean>;
  tag?(idOrDomain: string, tags: string[]): Promise<void>;
}

export interface PipelineInput {
  tenantId: string;
  tier: PipelineTier;
  offering: string; // what the seller provides
  geography?: string; // optional region bias
  vertical?: string;  // optional vertical bias
  seed: LeadSourceQuery; // initial search query object
  limit?: number; // max candidates to evaluate
}

export interface PipelineOutput {
  domain: string;
  url: string;
  companyName?: string;
  signals: LeadSignals;
  extracted: ExtractedProfile;
  enrich?: any;
  intent?: { score?: number; raw?: string };
  channel?: { recommendation?: string; raw?: string };
  explain?: string;
  contacts?: any;
  // meta
  tier: PipelineTier;
  tenantId: string;
  createdAt: number;
}

export class LeadIntentPipeline {
  private dedupe = new DedupeIndex();
  private agents: AgentCoordinator;

  constructor(agents?: AgentCoordinator) {
    this.agents = agents || makeAgentCoordinator();
  }

  async run(input: PipelineInput, storage?: LeadStore): Promise<PipelineOutput[]> {
    const { tenantId, tier } = input;
    const requestId = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;

    await auditLog.log("pipeline.start", input.seed, { tenantId, requestId });

    // 1) Enumerate candidates from lead sources
    const candidates = await enumerateCandidates(input.seed, {
      limit: input.limit ?? (tier === "free" ? 10 : 40),
      region: input.geography,
    });

    // 2) Crawl, extract, signalize, dedupe
    const batch: PipelineOutput[] = [];
    for (const cand of candidates) {
      const domain = cand.domain || (cand.url ? safeHost(cand.url) : undefined);
      if (!domain) continue;

      const match = this.dedupe.addOrMatch({
        companyName: cand.company || domain,
        domain,
        emails: [],
      });
      if (match.matched) {
        await auditLog.log("pipeline.skip.duplicate", { domain, by: match.matchKind }, { tenantId, requestId });
        continue;
      }

      const html = await crawlOne(cand.url || `https://${domain}`, {
        allowCache: true,
        obeyRobots: true,
        timeoutMs: 12_000,
        maxBytes: tier === "free" ? 400_000 : 1_500_000,
        userAgent: "LeadIntelBot/1.0 (+contact admin)",
      }).catch(() => undefined);

      if (!html?.content) {
        await auditLog.log("pipeline.skip.fetch", { domain }, { tenantId, requestId }, "warn");
        continue;
      }

      const extracted = extractAllFromHtml(html.content, { url: html.url });
      const signals = buildSignals(extracted, { url: html.url });

      // 3) Agents (enrich + intent + channel + explain)
      const ctx = { tenantId, tier, requestId } as const;
      const userOffering = input.offering;

      const results = await this.agents.runAll(
        [
          { kind: "enrich", website: html.url, domain, companyName: cand.company, signals, extracted, userOffering },
          { kind: "intent", website: html.url, domain, companyName: cand.company, signals, extracted, userOffering },
          { kind: "channel", website: html.url, domain, companyName: cand.company, signals, extracted, userOffering },
          { kind: "explain", freeform: { offering: userOffering, domain, signals } },
        ],
        ctx
      );

      // 4) Contacts (pro only by default)
      const contacts = tier === "free"
        ? undefined
        : await resolveContacts(domain, cand.company || "", {}, { tenantId, requestId }).catch(() => undefined);

      const out: PipelineOutput = {
        domain,
        url: html.url || cand.url || `https://${domain}`,
        companyName: cand.company || extracted.company?.name,
        signals,
        extracted,
        enrich: results.enrich?.data ?? tryJson(results.enrich?.content),
        intent: { score: results.intent?.data?.score, raw: results.intent?.content },
        channel: { recommendation: results.channel?.content, raw: results.channel?.content },
        explain: results.explain?.content,
        contacts,
        tier,
        tenantId,
        createdAt: Date.now(),
      };

      batch.push(out);
      if (storage) await storage.upsert(out);
      await auditLog.log("pipeline.item", { domain, score: out.intent?.score }, { tenantId, requestId });
    }

    await auditLog.log("pipeline.done", { count: batch.length }, { tenantId, requestId });
    return batch;
  }
}

/* ---------------- helpers ---------------- */

function tryJson(s?: string | null) {
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}
function safeHost(url?: string) {
  if (!url) return undefined;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return undefined; }
}

export function makeLeadIntentPipeline() {
  return new LeadIntentPipeline();
}
