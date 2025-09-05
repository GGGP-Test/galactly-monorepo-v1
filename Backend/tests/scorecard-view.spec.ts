// tests/scorecard-view.spec.ts
import { describe, it, expect } from "vitest";
import { buildScorecard, toViewModel, renderScorecardJSON } from "../src/ai/views/scorecard-view";

describe("scorecard-view: core scoring", () => {
  it("builds scorecard with defaults and grades", () => {
    const sc = buildScorecard({ leadId: "L1", leadName: "Acme Co." });
    expect(sc.leadId).toBe("L1");
    expect(sc.dims.length).toBeGreaterThan(0);
    // default baseline around 50, risk baseline 20, overall >=0
    expect(sc.overall).toBeGreaterThanOrEqual(0);
    expect(["A", "B", "C", "D", "F"]).toContain(sc.grade);
  });

  it("applies negative risk weight subtractively", () => {
    // High positives but high risk -> overall should be much lower than positives
    const sc = buildScorecard({
      leadId: "RISKY",
      signals: { intent: 0.9, fit: 0.9, timing: 0.9, risk: 0.8, goodwill: 0.5, channel: 0.5 },
    });
    // With normalized weights, neg risk weight ~ -1 => overall near pos - 80
    expect(sc.overall).toBeLessThan(20);
  });

  it("improves overall when risk is low", () => {
    const safer = buildScorecard({
      leadId: "SAFE",
      signals: { intent: 0.9, fit: 0.9, timing: 0.9, risk: 0.1, goodwill: 0.5, channel: 0.5 },
    });
    expect(safer.overall).toBeGreaterThan(60);
  });

  it("computes deltas when previous provided", () => {
    const sc1 = buildScorecard({
      leadId: "D1",
      signals: { intent: 0.6 },
    });
    const sc2 = buildScorecard({
      leadId: "D1",
      signals: { intent: 0.8 },
      previous: { intent: 0.6 },
    });
    const intent2 = sc2.dims.find(d => d.key === "intent");
    expect(intent2?.delta).toBe(20);
  });
});

describe("scorecard-view: views", () => {
  it("creates a stable view model & JSON", () => {
    const sc = buildScorecard({
      leadId: "VM1",
      leadName: "Bravo Ltd",
      signals: { intent: 0.75, fit: 0.66, timing: 0.55, risk: 0.2 },
      notes: { intent: ["Running ads"], fit: ["SKUs overlap"], risk: ["Supplier lock-in low"] },
      tags: ["hot", "retail"],
    });
    const vm = toViewModel(sc);
    expect(vm.title).toBe("Bravo Ltd");
    expect(vm.dims.find(d => d.key === "intent")?.label).toBeDefined();

    const json = renderScorecardJSON(sc);
    expect(json.overall.score).toBe(sc.overall);
    expect(json.weights).toBeDefined();
    expect((json.dimensions || []).length).toBeGreaterThan(0);
  });
});
