import seeds from "../../data/seed-buyers.json";
import type { Candidate, Persona, Seed } from "../types";
import { hostOf } from "../util";
import { scoreWithPersona } from "../score";
import { wantsUS, wantsCA } from "../util";

// filter by user region intent
function regionFilter(userRegion?: string) {
  const wUS = wantsUS(userRegion);
  const wCA = wantsCA(userRegion);
  return (s: Seed) => {
    if (!userRegion) return true;
    const hasUS = s.regions.some((x) => x.includes("us"));
    const hasCA = s.regions.some((x) => x.includes("ca"));
    if (wUS && wCA) return hasUS || hasCA;
    if (wUS) return hasUS;
    if (wCA) return hasCA;
    return true;
  };
}

export function fromSeeds(opts: { persona?: Persona; region?: string }): Candidate[] {
  const filtered = (seeds as Seed[]).filter(regionFilter(opts.region));

  return filtered.map((s) => {
    const { score, why } = scoreWithPersona(
      [...s.tags, ...s.titles],
      opts.persona
    );
    const wantTitles = (opts.persona?.titles || "").toLowerCase();
    const matchedTitle =
      s.titles.find((t) => wantTitles.includes(t.toLowerCase())) ||
      s.titles[0] ||
      "Buyer";

    return {
      id: s.id,
      company: s.company,
      website: s.website,
      host: hostOf(s.website),
      title: matchedTitle,
      score,
      why
    };
  });
}