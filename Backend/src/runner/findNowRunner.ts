import { Task, addLine, addItem } from '../tasks';

type Profile = {
  website: string;
  regions: string;
  industries: string;
  seeds: string;
  notes: string;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function startFindNow(
  profile: Profile,
  tasks: { previewTask: Task; leadsTask: Task }
) {
  const p = tasks.previewTask;
  const l = tasks.leadsTask;
  p.status = 'running';
  l.status = 'running';

  // narrative preview
  addLine(p, `Parsed site: ${profile.website.toLowerCase()}`);
  addLine(p, `Regions: ${profile.regions || '—'}`);
  addLine(p, `Industries: ${profile.industries || '—'}`);
  await sleep(300);
  addLine(p, '• Probing public feeds…');
  await sleep(300);
  addLine(p, '• Reading procurement + RFPs…');
  await sleep(300);
  addLine(p, '• Scanning retailer pages…');
  await sleep(300);
  addLine(p, '• Extracting quantities & materials…');
  await sleep(300);
  addLine(p, '• Cross-checking signals…');
  await sleep(300);
  addLine(p, '• Ranking by fit…');

  // basic free vs pro sections (front-end renders as a report)
  addLine(p, 'Demand (FREE): —');
  addLine(p, 'Demand (Pro): locked');
  addLine(p, 'Buy signals (FREE): —');
  addLine(p, 'Buy signals (Pro): locked');
  addLine(p, 'Channels (FREE): —');
  addLine(p, 'Channels (Pro): locked');
  addLine(p, 'Confidence (FREE): —');
  addLine(p, 'Confidence (Pro): locked');

  // lead trickle (seed domains preferred)
  const seeds = profile.seeds
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const fallback = ['riverbendsnacks.com', 'peakoutfitters.com', 'marathonlabs.com'];
  const domains = (seeds.length ? seeds : fallback).slice(0, 6);

  const states = ['GA', 'VT', 'MD', 'PA', 'TX', 'CA', 'NC', 'OH'];
  const intents = [
    'corrugated boxes',
    'stretch wrap pallets',
    'custom mailers (kraft)',
    '16oz cartons (retail)',
  ];

  domains.forEach(async (d, i) => {
    await sleep(350 * (i + 1));
    const intent = intents[i % intents.length];
    addItem(l, {
      title: `Lead — ${d}`,
      buyer: d,
      state: states[i % states.length],
      channel: ['Email', 'LinkedIn DM', 'Call'][i % 3],
      intent,
      why: `Matched to ${profile.website} through ${profile.industries || 'sector'} + recent mentions of ${intent}.`,
      source: 'aggregated',
    });
  });

  await sleep(350 * (domains.length + 1));
  p.status = 'done';
  l.status = 'done';
}
