/* eslint-disable @typescript-eslint/no-explicit-any */
// ... [previous imports and bleedStore implementation unchanged] ...

function buildQueries(archetypes: Archetype[], region?: string): string[] {
  const base = archetypes.map(a => 
    `(${a.leadQuery}) (USA OR Canada OR "North America")`
  );
  const loc = region ? `${region} (site:.com | site:.ca | site:.us)` : "site:.com | site:.ca | site:.us";
  return [...new Set([
    ...base,
    `packaging distributor ${loc}`,
    `corrugated box supplier ${loc}`,
    `protective packaging company ${loc}`
  ])].slice(0, 4);
}

function scoreLead(title: string, url: string, latents: DiscoveryOutput["latents"]): number {
  const t = title.toLowerCase();
  const u = url.toLowerCase();
  let s = 0.4;
  
  // Domain boosters
  if (u.includes('.ca') || u.includes('.us')) s += 0.15;
  if (/(distributor|supplier)/.test(t)) s += 0.1;
  
  // Product keywords
  const productBoost = ['corrugated', 'stretch film', 'shrink wrap', 'void fill', 'cold chain']
    .filter(kw => t.includes(kw)).length * 0.08;
  s += productBoost;

  // Location indicators
  const locationBoost = ['usa', 'canada', 'north america', ' ontario', ' california']
    .filter(kw => t.includes(kw)).length * 0.07;
  s += locationBoost;

  // Latent multipliers
  s += (latents.ColdChainSensitivity ?? 0) * 0.15;
  s += (latents.FragilityRisk ?? 0) * 0.1;

  return Math.min(1, s);
}

// ... [rest of file unchanged except scoreLead calls now pass URL] ...