import { nowISO, normalizeHost } from "./shared";
import type { BuyerCandidate, DiscoveryArgs } from "./types";

/** Deterministic seeds so the Free Panel always shows results. */
const SEED_HOSTS: Array<[string, string]> = [
  ["blueboxretail.com", "Purchasing Manager"],
  ["acmefoods.com", "Procurement Lead"],
  ["nwpallets.ca", "Buyer"],
  ["logiship.com", "Head of Ops"],
];

export async function seedsProvider(_args?: DiscoveryArgs): Promise<BuyerCandidate[]> {
  return SEED_HOSTS.map(([host, title]) => ({
    host: normalizeHost(host),
    platform: "news",
    title,
    source: "seeds",
    createdAt: nowISO(),
    proof: "seed",
  }));
}

export default seedsProvider;