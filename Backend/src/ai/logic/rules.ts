// src/ai/logic/rules.ts
import { z } from "zod";

export type PlanTier = "free" | "pro" | "sales";

export interface Rule<T = any> {
  id: string;
  title: string;
  desc: string;
  appliesTo: PlanTier | "both";
  weight: number;                 // contributes to score if test passes
  test: (candidate: T) => boolean; // pure, no side effects
}

export const ruleSchema = z.object({
  id: z.string(),
  title: z.string(),
  desc: z.string(),
  appliesTo: z.enum(["free", "pro", "sales", "both"]),
  weight: z.number().min(0),
});

export const RULES: Rule[] = [
  {
    id: "no-mega-suppliers",
    title: "Skip enterprise packaging suppliers",
    desc: "Filter out companies that are packaging suppliers with est. revenue > $50M.",
    appliesTo: "both",
    weight: 1,
    test: (c: any) => !(c.isSupplier === true && (c.revenue || 0) > 50_000_000),
  },
  {
    id: "buyer-only",
    title: "End users only",
    desc: "We only want buyers/end-users of packaging, not distributors or brokers.",
    appliesTo: "both",
    weight: 1,
    test: (c: any) => c.role !== "supplier" && c.role !== "distributor" && c.role !== "broker",
  },
  {
    id: "region-nj-tristate",
    title: "Within NJ + nearby",
    desc: "Prefer (score) NJ/NY/PA for this seed batch.",
    appliesTo: "both",
    weight: 1,
    test: (c: any) => /NJ|New Jersey|NY|New York|PA|Pennsylvania/i.test(c.region || ""),
  },
  {
    id: "active-signal",
    title: "Recent activity",
    desc: "Hiring, facility expansion, or operations news in the past 180 days.",
    appliesTo: "both",
    weight: 2,
    test: (c: any) => Boolean(c.signalRecent),
  },
  {
    id: "shipping-ops",
    title: "Ships weekly",
    desc: "Company ships physical goods weekly (ecom/3PL/manufacturing/co-pack).",
    appliesTo: "both",
    weight: 2,
    test: (c: any) => Boolean(c.shipsWeekly),
  },
];

export function applyRules<T>(candidate: T, plan: PlanTier) {
  let ok = true;
  let score = 0;

  for (const r of RULES) {
    if (r.appliesTo === "both" || r.appliesTo === plan) {
      const pass = r.test(candidate);
      if (!pass) ok = false;
      if (pass) score += r.weight;
    }
  }

  return { ok, score };
}

export default RULES;
