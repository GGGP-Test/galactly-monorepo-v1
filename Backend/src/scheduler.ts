import { pollSamGov } from './connectors/samGov.js';
import { pollReddit } from './connectors/reddit.js';
import { pollRss } from './connectors/rss.js';
import { pollYouTube } from './connectors/youtube.js';

export function startSchedulers(){
  // initial warm
  pollSamGov(); pollReddit(); pollRss(); pollYouTube();
  // repeaters
  setInterval(pollSamGov, 15*60*1000); // every 15m
  setInterval(pollReddit, 2*60*1000);  // every 2m
  setInterval(pollRss, 20*60*1000);    // every 20m
  setInterval(pollYouTube, 10*60*1000); // every 10m
}
