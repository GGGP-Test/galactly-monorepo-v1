// backend/src/routes/progress.ts
// Streams the "Signals Preview" report via Server-Sent Events (SSE).
// Shows both Free and Pro lanes per category. Free halts early with an upsell.
// Pro lane is streamed as `locked:true` for Free users (teases method without monetizable detail).

import { Router, Request, Response } from "express";

const router = Router();

/** --- Categories (report sections) --- */
const CATEGORIES = [
  "Demand",
  "Product",
  "Procurement",
  "Retail",
  "Wholesale",
  "Ops",
  "Events",
  "Reviews",
  "Timing",
] as const;
type Category = typeof CATEGORIES[number];
type Lane = "free" | "pro";

type Tick = {
  category: Category;
  lane: Lane;
  chain: string[];      // Probe → Filter → Evidence → Conclusion
  done: number;         // processed so far in this lane
  total: number;        // total planned
  locked?: boolean;     // true when plan=free but showing Pro lane preview
};

function randInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function randPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function money(n: number) {
  return "$" + Math.round(n).toLocaleString();
}

/** Dynamic chain builders to keep content feeling “live” while still free. */
function chainsFor(cat: Category) {
  // Some shared randoms to keep lines coherent per tick
  const spend = randInt(4800, 9800);
  const orders = randInt(22, 64);
  const units = randInt(300, 1200);
  const queueDays = randInt(7, 14);
  const promoDepth = randPick(["-10%", "-20%", "-30%"]);
  const surgeDays = randInt(7, 21);

  const FREE: Record<Category, string[]> = {
    Demand: [
      "Probe: ad-library creatives",
      "Filter: geo burst",
      "Evidence: ~reach only",
      "Conclusion: warming demand (monitor)",
    ],
    Product: [
      "Probe: PDP deltas",
      "Filter: new sizes/flavors",
      "Evidence: SKU growth",
      "Conclusion: packaging impact possible",
    ],
    Procurement: [
      "Probe: supplier portal",
      "Filter: intake present",
      "Evidence: form changes",
      "Conclusion: live vendor search",
    ],
    Retail: [
      "Probe: PDP price promos",
      "Filter: cadence",
      "Evidence: uplift hint",
      "Conclusion: promo-dependent demand",
    ],
    Wholesale: [
      "Probe: case-pack/MOQ mentions",
      "Filter: B2B pages",
      "Evidence: MOQ shifts",
      "Conclusion: early stocking",
    ],
    Ops: [
      "Probe: job posts",
      "Filter: shift adds",
      "Evidence: schedule growth",
      "Conclusion: ops expansion",
    ],
    Events: [
      "Probe: public calendars",
      "Filter: openings",
      "Evidence: booth presence",
      "Conclusion: post-event follow-up",
    ],
    Reviews: [
      "Probe: public reviews",
      "Filter: packaging lexicon",
      "Evidence: complaint hits",
      "Conclusion: monitor for switch",
    ],
    Timing: [
      "Probe: post-launch weeks",
      "Filter: weekend promo",
      "Evidence: basic cadence",
      "Conclusion: generic window",
    ],
  };

  const PRO: Record<Category, string[]> = {
    Demand: [
      "Probe: ad spend split (geo/creative)",
      "Filter: multi-touch visit blend",
      `Evidence: ~${money(spend)}/mo → ~${orders} orders`,
      `Conclusion: ~${units} stretch-wrap rolls/mo (queue ${queueDays}d)`,
    ],
    Product: [
      "Probe: PDP + spec inference",
      "Filter: case-of-N mapping",
      "Evidence: units → cartons/pallets",
      "Conclusion: SKU-level packaging demand",
    ],
    Procurement: [
      "Probe: portal cadence",
      "Filter: field diffs",
      "Evidence: vendor rotation",
      "Conclusion: active buy-cycle timing",
    ],
    Retail: [
      "Probe: retailer feed monitors",
      "Filter: planogram hints",
      `Evidence: promo depth ${promoDepth} uplift`,
      "Conclusion: units forecast → packaging",
    ],
    Wholesale: [
      "Probe: distributor velocity",
      "Filter: import/trade map",
      "Evidence: stock-out risk",
      "Conclusion: replen pack demand window",
    ],
    Ops: [
      "Probe: shift pattern deltas",
      "Filter: fulfillment stress",
      "Evidence: SLA risk",
      "Conclusion: best hour/day to contact",
    ],
    Events: [
      "Probe: booth spend",
      "Filter: regional hires",
      "Evidence: surge likelihood",
      "Conclusion: near-certain replenishment",
    ],
    Reviews: [
      "Probe: surge + geo map",
      "Filter: product linkage",
      `Evidence: “box crushed” surge (${surgeDays}d)`,
      "Conclusion: switching window soon",
    ],
    Timing: [
      "Probe: cross-signal blend",
      "Filter: decay/seasonality",
      "Evidence: queue window score",
      `Conclusion: best ${queueDays} days from now`,
    ],
  };

  return { free: FREE[cat], pro: PRO[cat] };
}

/** SSE endpoint */
router.get("/progress.sse", (req: Request, res: Response) => {
  // Read plan from user (set by upstream middleware in Index.ts)
  const plan: "free" | "pro" = (req as any).user?.plan === "pro" ? "pro" : "free";

  // Long-lived response
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2500\n\n"); // client reconnection backoff

  // Universe size and pacing
  const TOTAL = 1126; // always show a concrete denominator
  // Free halts early with upsell (between 50 and 80 items)
  const FREE_HALTS_AT = 50 + Math.floor(Math.random() * 31);
  const TICK_MS = 1000; // 1s per line → slow readable stream

  let freeDone = 0;
  let proDone = 0;

  // Cycle through categories in a round-robin way
  let catIdx = 0;
  function nextCategory(): Category {
    const c = CATEGORIES[catIdx % CATEGORIES.length];
    catIdx++;
    return c;
  }

  function emit(event: string, data: any) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Heartbeat keeps some proxies happy
  const heartbeat = setInterval(() => emit("ping", { t: Date.now() }), 15000);

  const timer = setInterval(() => {
    // Decide which lane to emit first (we still try to alternate feel)
    const lane: Lane = Math.random() < 0.55 ? "free" : "pro";
    const cat = nextCategory();
    const { free, pro } = chainsFor(cat);

    // --- FREE lane ---
    if (lane === "free") {
      if (freeDone < FREE_HALTS_AT) {
        freeDone++;
        const tick: Tick = {
          category: cat,
          lane: "free",
          chain: free,
          done: freeDone,
          total: TOTAL,
        };
        emit("tick", tick);

        if (freeDone === FREE_HALTS_AT) {
          emit("halt", {
            freeDone,
            total: TOTAL,
            checkout: "/checkout/stripe?plan=pro",
          });
        }
      }
    }

    // --- PRO lane ---
    if (lane === "pro") {
      proDone++;
      const isLocked = plan !== "pro";
      const tick: Tick = {
        category: cat,
        lane: "pro",
        chain: pro,      // exact steps shown; client adds 🔒 when locked
        done: proDone,
        total: TOTAL,
        locked: isLocked || undefined,
      };
      emit("tick", tick);
    }

    // End the stream after ~100–140 ticks total to stay in the 60–120s window
    const emittedBudget = Math.max(freeDone, FREE_HALTS_AT) + proDone;
    if (emittedBudget > 120) {
      clearInterval(timer);
      clearInterval(heartbeat);
      emit("done", { ok: true });
      res.end();
    }
  }, TICK_MS);

  // Client disconnected
  req.on("close", () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  });
});

export default router;
