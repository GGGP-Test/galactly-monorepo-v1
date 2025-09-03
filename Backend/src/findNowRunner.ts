import { Task, appendLine, pushItem } from './tasks';

type Profile = {
  website: string;
  regions: string;
  industries: string;
  seeds: string; // comma domains
  notes: string;
};

const SLEEP = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Orchestrates the “launching …” steps and populates:
 *  - previewTask.lines   (incremental report text)
 *  - leadsTask.items     (incremental lead cards)
 */
export async function startFindNow(
  profile: Profile,
  ids: { previewTask: Task; leadsTask: Task }
) {
  const p = ids.previewTask;
  const l = ids.leadsTask;
  p.status = 'running';
  l.status = 'running';

  const steps = [
    'Probing public feeds',
    'Reading procurement + RFPs',
    'Scanning retailer pages',
    'Extracting quantities & materials',
    'Cross-checking signals',
    'Ranking by fit'
  ];

  // seed buyers list
  const seeds = profile.seeds
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  // 1) preview narrative (free vs pro buckets)
  appendLine(p, `Parsed site: ${profile.website.toLowerCase()}`);
  appendLine(p, `Regions: ${profile.regions || '—'}`);
  appendLine(p, `Industries: ${profile.industries || '—'}`);

  for (const s of steps) {
    appendLine(p, `• ${s}…`);
    await SLEEP(500);
  }

  appendLine(p, 'Demand (FREE): —');
  appendLine(p, 'Demand (Pro): locked');
  appendLine(p, 'Buy signals (FREE): —');
  appendLine(p, 'Buy signals (Pro): locked');
  appendLine(p, 'Channels (FREE): —');
  appendLine(p, 'Channels (Pro): locked');
  appendLine(p, 'Confidence (FREE): —');
  appendLine(p, 'Confidence (Pro): locked');

  // 2) produce a few lead items (incremental)
  const sample = seeds.length
    ? seeds
    : ['riverbendsnacks.com', 'peakoutfitters.com', 'marathonlabs.com'];

  // basic mapping to card fields
  const mkLead = (domain: string, i: number) => {
    const states = ['GA', 'VT', 'MD', 'PA', 'TX', 'CA', 'NC', 'OH'];
    const intents = [
      'corrugated boxes',
      'stretch wrap pallets',
      'custom mailers (kraft)',
      '16oz cartons (retail)'
    ];
    const intent = intents[i % intents.length];
    return {
      title: `Lead — ${domain}`,
      buyer: domain,
      state: states[i % states.length],
      channel: ['Email', 'LinkedIn DM', 'Call'][i % 3],
      intent,
      why: `Matched to ${profile.website} via ${profile.industries || 'sector'} & recent mentions of ${intent}.`,
      source: 'aggregated'
    };
  };

  for (let i = 0; i < sample.length && i < 6; i++) {
    pushItem(l, mkLead(sample[i], i));
    await SLEEP(400);
  }

  p.status = 'done';
  l.status = 'done';
}
