import { pollSamGov } from './connectors/samGov.js';
import { pollReddit } from './connectors/reddit.js';
import { pollRss } from './connectors/rss.js';
import { pollSocialFeeds } from './connectors/socialFirehose.js';

function safeRun<T>(p: Promise<T>, tag: string) {
  p.catch(e => console.error(`[scheduler] ${tag} failed`, e));
}

export function startSchedulers() {
  // initial warm (don’t crash if any fails)
  safeRun((async () => {
    await pollSamGov();
    await pollReddit();
    await pollRss();
    await pollSocialFeeds();
  })(), 'warmup');

  // repeaters (all errors are caught)
  setInterval(() => safeRun(pollSamGov(), 'samGov'), 15 * 60 * 1000);
  setInterval(() => safeRun(pollReddit(), 'reddit'), 2 * 60 * 1000);
  setInterval(() => safeRun(pollRss(), 'rss'), 20 * 60 * 1000);
  setInterval(() => safeRun(pollSocialFeeds(), 'social'), 5 * 60 * 1000);
}
