// src/logic/rules.ts
export type Lead = {
  domain?: string;
  employees?: number | null;
  revenueUsd?: number | null;
  postingVelocity90d?: number | null;
  hasWarehouse?: boolean | null;
  region?: string | null;
};

export type RuleContext = {
  lead: Lead;
  now?: Date;
};

export type RuleResult = {
  id: string;
  passed: boolean;
  scoreDelta?: number;   // add to intent
  weightDelta?: number;  // add to weightness
  note?: string;
};

export type Rule = {
  id: string;
  test: (ctx: RuleContext) => boolean;
  scoreDelta?: number;
  weightDelta?: number;
  note?: string;
};

export const defaultRules: Rule[] = [
  {
    id: "rev-midmarket",
    test: ({ lead }) => (lead.revenueUsd ?? 0) >= 1_000_000 && (lead.revenueUsd ?? 0) <= 50_000_000,
    scoreDelta: 6,
    weightDelta: 2,
    note: "Sweet-spot revenue"
  },
  {
    id: "headcount-sme",
    test: ({ lead }) => (lead.employees ?? 0) >= 5 && (lead.employees ?? 0) <= 250,
    scoreDelta: 4
  },
  {
    id: "ops-active-posting",
    test: ({ lead }) => (lead.postingVelocity90d ?? 0) >= 5,
    scoreDelta: 5,
    note: "Hiring / posting suggests activity"
  },
  {
    id: "has-warehouse",
    test: ({ lead }) => !!lead.hasWarehouse,
    scoreDelta: 7,
    weightDelta: 3
  }
];

export function runRules(ctx: RuleContext, rules: Rule[] = defaultRules): RuleResult[] {
  return rules.map(r => {
    const passed = safeTest(r.test, ctx);
    return {
      id: r.id,
      passed,
      scoreDelta: passed ? r.scoreDelta ?? 0 : 0,
      weightDelta: passed ? r.weightDelta ?? 0 : 0,
      note: r.note
    };
  });
}

function safeTest(fn: (c: RuleContext) => boolean, c: RuleContext): boolean {
  try { return !!fn(c); } catch { return false; }
}
