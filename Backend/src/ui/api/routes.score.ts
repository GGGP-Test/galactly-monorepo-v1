// src/ui/api/routes.score.ts
/**
 * Minimal HTTP route for scoring a lead request.
 * Framework-agnostic: accepts any app with .post(path, handler).
 *
 * Expects JSON body:
 *  {
 *    tenantId?: string,
 *    website?: string,
 *    query?: string,        // free-text description of what the user sells
 *    context?: Record<string, any> // optional additional signals
 *  }
 *
 * Responds:
 *  {
 *    summary: string,
 *    score?: number,
 *    model: string,
 *    provider: string,
 *    requestId?: string,
 *    extras?: any
 *  }
 */

import { makeOrchestrator } from "../../ai/llm-orchestrator";
import { defaultCostTracker } from "../../ops/cost-tracker";
import { auditLog } from "../../security/audit-log";

type App = {
  post: (path: string, handler: (req: any, res: any) => void | Promise<void>) => void;
};

function safeText(s?: string) {
  return (s || "").slice(0, 10_000);
}

export function registerScoreRoutes(app: App) {
  app.post("/api/score", async (req, res) => {
    const tenantId = (req.headers?.["x-tenant-id"] as string) || req.body?.tenantId || "anon";
    const website = safeText(req.body?.website);
    const query = safeText(req.body?.query);
    const context = req.body?.context || {};

    const requestId = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;

    try {
      await auditLog.log("score.request", { website, query, context }, { tenantId, requestId });

      // Build prompt
      const messages = [
        {
          role: "user" as const,
          content: [
            "You are a lead-intelligence analyst for packaging suppliers.",
            "Given the target user's offering and the candidate buyer's website, infer:",
            "- What packaging materials/solutions they likely purchase",
            "- Signals of near-term demand",
            "- A 0-100 intent score (0=not buying; 100=buying now)",
            "- 3 concrete next steps to engage",
            "",
            `Target offering (user): ${query || "(unspecified)"}`,
            website ? `Candidate website: ${website}` : "No website provided.",
            context ? `Context: ${JSON.stringify(context).slice(0, 1500)}` : "",
            "",
            "Return a short summary and the numeric intent score as: SCORE: <number>",
          ].join("\n"),
        },
      ];

      const orch = makeOrchestrator();
      const resp = await orch.run("intent", { messages }, {
        tenantId,
        tier: "pro",
        requestId,
        costTracker: {
          addCost: defaultCostTracker.addCost.bind(defaultCostTracker),
          getRemainingBudget: defaultCostTracker.getRemainingBudget.bind(defaultCostTracker),
        },
        audit: (ev, data) => auditLog.log(ev, data, { tenantId, requestId }),
      });

      // Extract SCORE: N from the model output
      const match = resp.content.match(/SCORE:\s*([0-9]{1,3})/i);
      const score = match ? Math.max(0, Math.min(100, parseInt(match[1], 10))) : undefined;

      await auditLog.log("score.response", { model: resp.model, provider: resp.provider, score }, { tenantId, requestId });

      res.status(200).json({
        summary: resp.content,
        score,
        model: resp.model,
        provider: resp.provider,
        requestId,
        extras: { usage: resp.usage, cost_usd: resp.cost_usd },
      });
    } catch (err: any) {
      await auditLog.log("score.error", { message: err?.message }, { tenantId, requestId }, "error");
      res.status(500).json({ error: "Failed to score", requestId });
    }
  });
}
