// Backend/src/providers/seeds.ts

import type { Candidate, FindBuyersInput } from "./types";
import { normalizeHost } from "./shared";

const DEFAULT_TITLE = "Purchasing Manager";

// Mirrors the kind of demo items you saw; safe to swap later.
const SEED_HOSTS_NA = [
  "blueboxretail.com",
  "acmefoods.com",
  "nwpallets.ca",
  "logiship.com",
  "freshgrocer.com",
  "peakoutdoors.ca",
  "maplefoods.ca",
  "packoutdoors.com",
  "coastalproduce.com",
  "fairwaydistribution.com",
  "urbanmercantile.com",
  "harborhomegoods.com",
  "sundialbrands.com",
  "evergreenmarkets.com"
];

export function seedCandidates(input: FindBuyersInput): Candidate[] {
  const supplier = normalizeHost(input.supplier);
  const region = (input.region || "").toLowerCase();
  const base = (region.includes("us") || region.includes("ca")) ? SEED_HOSTS_NA : SEED_HOSTS_NA;

  return base
    .filter(h => h !== supplier)
    .map(host => ({
      host,
      platform: "news",
      title: DEFAULT_TITLE,
      why: "Seed backfill (network-thin); replace via real discovery"
    }));
}