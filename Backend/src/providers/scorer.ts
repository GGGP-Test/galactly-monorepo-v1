import { Candidate, FindBuyersInput, normalizeHost } from "./index";

// Lightweight scoring to classify HOT vs WARM.
// Signals used (no external keys):
//  - site reachable (GET "/")
//  - contact page reachable ("/contact" or "/contact-us")
//  - region/TLD alignment (.ca for CA, .us/.com for US)
//  - supplier keyword affinity (host contains inferred keyword)
//  - domain quality heuristics (not an aggregator/news-only host)

type Reason = { k: string; v?: string | number };

export async function scoreCandidates(
  input: FindBuyersInput,
  candidates: Candidate[]
): Promise<Candidate[]> {
  const supplierHost = normalizeHost(input.supplier);
  const key = inferKeywordFromHost(supplierHost);
  const wantCA = input.region.includes("ca");
  const wantUS = input.region.includes("us");

  // Don’t over-fetch. Cap quick checks to first 20.
  const MAX_CHECKS = 20;
  const toCheck = candidates.slice(0, MAX_CHECKS);

  const checks = await Promise.all(toCheck.map(c => quickCheck(c.host)));

  const enriched: Candidate[] = candidates.map((c, i) => {
    const chk = i < checks.length ? checks[i] : { okRoot: false, okContact: false };
    const scoreParts: Reason[] = [];
    let score = 0;

    if (chk.okRoot)    { score += 40; scoreParts.push({ k: "root" }); }
    if (chk.okContact) { score += 20; scoreParts.push({ k: "contact" }); }

    // region/TLD affinity
    if (wantCA && c.host.endsWith(".ca")) { score += 10; scoreParts.push({ k: "ca" }); }
    if (wantUS && (c.host.endsWith(".com") || c.host.endsWith(".us"))) {
      score += 10; scoreParts.push({ k: "us" });
    }

    // supplier keyword affinity
    if (key && c.host.includes(key)) { score += 10; scoreParts.push({ k: "kw", v: key }); }

    // penalize obvious aggregators
    if (isAggregator(c.host)) { score -= 30; scoreParts.push({ k: "agg" }); }

    const temp = score >= 60 ? "hot" : "warm";
    const whyBits = [
      ...(c.why ? [c.why] : []),
      ...(scoreParts.map(p => p.k === "kw" ? `keyword:${p.v}` : p.k))
    ];

    return {
      ...c,
      temp,
      why: whyBits.join(", ")
    };
  });

  return enriched;
}

function inferKeywordFromHost(host: string): string {
  const name = host.split(".")[0];
  if (name.includes("pack")) return "pack";
  if (name.includes("film")) return "film";
  if (name.includes("label")) return "label";
  return name.replace(/\d+/g, "").slice(0, 12);
}

function isAggregator(host: string): boolean {
  return AGG.some(a => host.endsWith(a) || host === a || host.includes(a));
}

const AGG = [
  "newswire.com","prnewswire.com","globenewswire.com","businesswire.com","yahoo.com",
  "bing.com","microsoft.com","google.com","apple.news","apnews.com","reuters.com",
  "medium.com","wikipedia.org","linkedin.com","twitter.com","facebook.com","youtube.com"
];

async function quickCheck(host: string): Promise<{ okRoot: boolean; okContact: boolean }> {
  const [okRoot, okContact] = await Promise.all([
    fast200("https://" + host + "/"),
    any200(["/contact","/contact-us","/contacts"].map(p => "https://" + host + p))
  ]);
  return { okRoot, okContact };
}

async function any200(urls: string[]): Promise<boolean> {
  for (const u of urls) {
    if (await fast200(u)) return true;
  }
  return false;
}

async function fast200(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal as any });
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
}