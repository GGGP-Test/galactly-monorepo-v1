// ---------- helpers (safe to place near top of file) ----------
const ROOT = (h: string) =>
  (h || '').toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0];

const INTENT_PATH_RX = /(\/|^)(suppliers?|vendor|vendors|procurement|purchas(?:e|ing)|sourcing|supply\-chain|rfi|rfq|rfp|supplier\-registration|become\-a\-supplier)(\/|$)/i;

const MEGABRAND: Set<string> = new Set([
  // CPG / retail conglomerates & household mega-brands (illustrative, extendable)
  'unilever.com','loreal.com','nestle.com','pepsico.com','coca-cola.com','p-g.com','pg.com',
  'walmart.com','target.com','costco.com','amazon.com','kroger.com','albertsons.com','tesco.com','aldi.us','lidl.com',
  'loblaw.ca','metro.ca','wba.com','7-eleven.com','lowes.com','homedepot.com','ikea.com','macys.com','nike.com',
  // tech megas (sometimes false positives on “supplier code” pages)
  'apple.com','google.com','microsoft.com','meta.com','amazonaws.com'
]);

function scoreCandidate(c: Candidate, supplierRoot: string, region?: string): number {
  // Base
  let s = 0;

  // Prefer pages that look like procurement/vendor entry points
  if (INTENT_PATH_RX.test(c.title) || INTENT_PATH_RX.test(c.why)) s += 5;

  // Light boost if the why/title mentions packaging explicitly
  if (/\bpackag(?:e|ing|er|es)\b/i.test(c.title) || /\bpackag(?:e|ing)\b/i.test(c.why)) s += 3;

  // Region hint (very light; your upstream already scopes)
  if (region) {
    if (new RegExp(region.split('/')[0], 'i').test(c.why)) s += 1;
  }

  // Slight penalty if the root is suspiciously generic or matches supplier
  const root = ROOT(c.host);
  if (!root || root === supplierRoot) s -= 10;

  return s;
}

function dedupeByHostTitle(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of list) {
    const key = ROOT(c.host) + '|' + (c.title || '').trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function filterBySizeHint(list: Candidate[], size: 'mid'|'any'|'giant'): Candidate[] {
  if (size === 'any') return list;
  if (size === 'giant') return list.filter(c => MEGABRAND.has(ROOT(c.host)));
  // default 'mid': exclude megabrands; if that empties, fall back to any
  const mid = list.filter(c => !MEGABRAND.has(ROOT(c.host)));
  return mid.length ? mid : list;
}
// --------------------------------------------------------------


// ---------- POST-process & reply (place this where you currently finalize the response) ----------
// inputs from query (keep your existing parsing)
const supplierHost = (req.query.host as string) || '';
const supplierRoot = ROOT(supplierHost);
const region = (req.query.region as string) || '';
const sizeHint = ((req.query.size as string) || 'mid').toLowerCase() as 'mid'|'any'|'giant';

// 1) drop obvious self/empty
let filtered = (candidates || []).filter(c => {
  const root = ROOT(c.host);
  return root && root !== supplierRoot;
});

// 2) strict de-dupe (host+title)
filtered = dedupeByHostTitle(filtered);

// 3) apply size hint (defaults to mid-market)
filtered = filterBySizeHint(filtered, sizeHint);

// 4) score & sort (stable, descending)
filtered = filtered
  .map(c => ({ ...c, score: scoreCandidate(c, supplierRoot, region) }))
  .sort((a, b) => (b.score! - a.score!));

// 5) final cap to something reasonable for the panel
const MAX = Math.min(Number(req.query.limit ?? 20), 50);
const top = filtered.slice(0, MAX);

// 6) if nothing, return the current compact 404 your panel expects
if (!top.length) {
  return res.status(404).json({ error: 'no match' });
}

// 7) respond
return res.json(top);