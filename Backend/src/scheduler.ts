import { pollSamGov } from './connectors/samGov.js';
import { pollReddit } from './connectors/reddit.js';
import { pollRss } from './connectors/rss.js';

export function startSchedulers(){
  // initial warm
  pollSamGov(); pollReddit(); pollRss();
  // repeaters
  setInterval(pollSamGov, 15*60*1000); // every 15m
  setInterval(pollReddit, 2*60*1000);  // every 2m
  setInterval(pollRss, 20*60*1000);    // every 20m
}
