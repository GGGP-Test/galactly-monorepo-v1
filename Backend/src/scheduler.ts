// Backend/src/scheduler.ts
import { pollSamGov } from './connectors/samGov.js';
import { pollReddit } from './connectors/reddit.js';
import { pollRss } from './connectors/rss.js';
import { pollSocialFeeds } from './connectors/socialFirehose.js';

const DISABLED = process.env.DISABLE_SCHEDULER === '1';
const CYCLE_MS = Number(process.env.SCHEDULER_CYCLE_MS || 10 * 60 * 1000); // 10m
const STEP_DELAY_MS = Number(process.env.SCHEDULER_STEP_DELAY_MS || 1500);

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

let running = false;

async function cycle() {
  if (running) return;
  running = true;
  try {
    await pollSamGov();        await sleep(STEP_DELAY_MS);
    await pollReddit();        await sleep(STEP_DELAY_MS);
    await pollRss();           await sleep(STEP_DELAY_MS);
    await pollSocialFeeds();   // returns count only
  } catch (e) {
    // swallow; keep service alive
  } finally {
    running = false;
  }
}

export function startSchedulers() {
  if (DISABLED) { console.log('[scheduler] disabled via DISABLE_SCHEDULER=1'); return; }
  // kick once, then on a timer
  cycle().catch(()=>{});
  setInterval(() => cycle().catch(()=>{}), CYCLE_MS);
}
