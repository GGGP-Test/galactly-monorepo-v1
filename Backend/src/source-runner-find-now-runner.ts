// Backend/src/source-runner-find-now-runner.ts
// Minimal background runner that feeds Preview (metrics) + Leads into a Task.

import {
  Task,
  emitPreview,
  emitLead,
  finishTask,
  parseSeedDomains,
  type Lead as LeadType,
} from './source-tasks';

type Profile = {
  website?: string;
  regions?: string;
  industries?: string;
  seed_buyers?: string;
  notes?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mkLead(domain: string, i: number, profile: Profile): LeadType {
  const STATES = ['GA', 'CA', 'TX', 'NC', 'OH', 'PA', 'IL', 'WA'];
  const INTENTS = ['corrugated boxes', 'stretch wrap pallets', 'custom mailers (kraft)', 'labels (unit)'];
  const intent = INTENTS[i % INTENTS.length];
  return {
    title: `Lead — ${domain}`,
    domain,
    state: STATES[i % STATES.length],
    channel: ['Email', 'LinkedIn DM', 'Call'][i % 3],
    intent,
    reason: `Matched to ${profile.website || 'your focus'} via ${profile.industries || 'sector'} & recent mentions of ${intent}.`,
    source: 'aggregated',
  };
}

/** Orchestrates a single run and fills the task queues incrementally. */
export async function startFindNow(profile: Profile, task: Task): Promise<void> {
  try {
    // 1) Initial universe counts so the UI shows denominators immediately
    emitPreview(task, { type: 'counts', counts: { free: 16, pro: 1126 } });

    // 2) Narrative metrics across Free + Pro lanes (ids must match panel)
    const steps: Array<[id: string, freeScore: number, proScore: number, text?: string]> = [
      ['demand', 36, 78, profile.industries ? `${profile.industries} paid reach` : 'paid reach hints'],
      ['buysigs', 22, 64, 'mentions & ad proofs'],
      ['rfps', 18, 54, 'supplier intake present'],
      ['retail', 28, 62, 'PDP cadence'],
      ['hiring', 14, 40, 'ops / shift adds'],
      ['ops', 20, 58, 'stack signals'],
      ['budget', 24, 52, 'posture'],
    ];

    for (const [id, f, p, t] of steps) {
      emitPreview(task, { type: 'metric', metric: id, tier: 'free', score: f, text: t });
      await sleep(140);
      emitPreview(task, { type: 'metric', metric: id, tier: 'pro', score: p, text: t });
      await sleep(140);
    }

    // 3) Seeded leads (or fallback demo domains). Trickle them in.
    const seeds = parseSeedDomains(profile.seed_buyers);
    const sample = seeds.length
      ? seeds
      : ['riverbendsnacks.com', 'peakoutfitters.com', 'marathonlabs.com', 'oakcrestfoods.com', 'northshorecandle.com'];

    for (let i = 0; i < Math.min(sample.length, 6); i++) {
      await sleep(320);
      emitLead(task, mkLead(sample[i], i, profile));
    }
  } catch {
    // swallow; keep task drainable even if a step fails
  } finally {
    await sleep(300);
    finishTask(task);
  }
}
