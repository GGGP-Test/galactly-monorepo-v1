// Free advertiser discovery (no Apify).
// Layer 1: pixel detection on buyer sites (Meta Pixel / Google Ads).
// Layer 2 (optional): headless confirmers for Meta Ad Library + Google Ads Transparency.
//
// Enable headless confirmers by setting env PLAYWRIGHT=1 (and adding Playwright to your image).
// Return shape: { domain, source, proofUrl, evidence[], lastSeen }

type Advertiser = {
  domain: string;
  source: 'meta_pixel' | 'google_ads' | 'meta_adlib' | 'google_adstrans';
  proofUrl?: string;
  evidence: string[];
  lastSeen: string; // ISO
};

const UA = process.env.BRANDINTAKE_USERAGENT ||
  'GalactlyBot/0.1 (+https://example.com; free-mode)';

const fetchText = async (url: string, timeoutMs = 12000): Promise<string | null> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: ctrl.signal } as any);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
};

const normDomain = (d: string) =>
  d.toLowerCase()
   .replace(/^https?:\/\//, '')
   .replace(/\/.*$/, '')
   .replace(/^www\./, '');

const hasMetaPixel = (html: string) => {
  const h = html.toLowerCase();
  return h.includes('fbevents.js') || /fbq\(\s*['"]init['"]\s*,\s*['"]\d+['"]\s*\)/i.test(h);
};

const hasGoogleAds = (html: string) => {
  const h = html.toLowerCase();
  // Google Ads conv tag or gtag AW- config (NOT Adsense).
  return h.includes('googleadservices.com/pagead/conversion') ||
         /gtag\(\s*['"]config['"]\s*,\s*['"]aw-\d+['"]\s*\)/i.test(h);
};

// ---------- Layer 1: pixel scan ----------
export async function findAdvertisersPixels(domains: string[]): Promise<Advertiser[]> {
  const out: Advertiser[] = [];
  const seen = new Set<string>();
  for (const raw of domains) {
    const d = normDomain(raw);
    if (seen.has(d)) continue;
    seen.add(d);

    const html = await fetchText(`https://${d}/`);
    if (!html) continue;

    const now = new Date().toISOString();
    if (hasMetaPixel(html)) {
      out.push({
        domain: d,
        source: 'meta_pixel',
        proofUrl: `https://${d}/`,
        evidence: ['fb pixel detected'],
        lastSeen: now
      });
    }
    if (hasGoogleAds(html)) {
      out.push({
        domain: d,
        source: 'google_ads',
        proofUrl: `https://${d}/`,
        evidence: ['google ads tag detected'],
        lastSeen: now
      });
    }
  }
  return out;
}

// ---------- Layer 2: optional headless confirmers (Playwright) ----------
async function withPlaywright<T>(fn: (p: any) => Promise<T>): Promise<T | null> {
  try {
    if (process.env.PLAYWRIGHT !== '1') return null;
    // dynamic import to avoid build-time dependency if you don’t use it
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    try {
      const res = await fn(page);
      await ctx.close(); await browser.close();
      return res;
    } catch (e) {
      await ctx.close(); await browser.close();
      return null;
    }
  } catch {
    return null;
  }
}

// Meta Ad Library: search by brand/domain and look for result count / “No ads to show”.
async function checkMetaAdLibrary(domain: string): Promise<Advertiser | null> {
  return await withPlaywright<Advertiser | null>(async (page) => {
    const q = encodeURIComponent(domain);
    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${q}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Try to accept cookies if visible (best-effort; ignore failures)
    try {
      await page.getByRole('button', { name: /accept|allow|ok/i }).first().click({ timeout: 3000 });
    } catch {}

    // Wait a bit for results to render
    await page.waitForTimeout(3000);
    const html = await page.content();
    const text = (await page.textContent('body')) || '';

    const noAds = /no ads to show/i.test(text);
    const hasResults = /ads/i.test(text) && !noAds;

    if (hasResults) {
      return {
        domain: normDomain(domain),
        source: 'meta_adlib',
        proofUrl: url,
        evidence: ['ad library shows results'],
        lastSeen: new Date().toISOString()
      };
    }
    return null;
  });
}

// Google Ads Transparency Center: search, follow advertiser page link.
async function checkGoogleAdsTransparency(domain: string): Promise<Advertiser | null> {
  return await withPlaywright<Advertiser | null>(async (page) => {
    const q = encodeURIComponent(domain);
    const searchUrl = `https://adstransparency.google.com/?query=${q}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Try to click the first advertiser card link (contains "/advertiser/")
    const anchors = await page.$$eval('a', as => as.map(a => (a as HTMLAnchorElement).href));
    const adv = anchors.find(h => /\/advertiser\/\d+/.test(h));
    if (!adv) return null;

    await page.goto(adv, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    const text = (await page.textContent('body')) || '';

    // Heuristic: advertiser page usually contains "Ads" and some counts.
    const looksValid = /ads|creatives|impressions/i.test(text);
    if (!looksValid) return null;

    return {
      domain: normDomain(domain),
      source: 'google_adstrans',
      proofUrl: adv,
      evidence: ['ads transparency page found'],
      lastSeen: new Date().toISOString()
    };
  });
}

export async function findAdvertisersFree(domains: string[]): Promise<Advertiser[]> {
  const base = await findAdvertisersPixels(domains);
  const wantConfirm = (process.env.PLAYWRIGHT === '1');

  if (!wantConfirm) return base;

  const out: Advertiser[] = [...base];
  for (const d of domains) {
    const nd = normDomain(d);
    // confirmers are best-effort & slow; wrap individually
    try {
      const meta = await checkMetaAdLibrary(nd);
      if (meta) out.push(meta);
    } catch {}
    try {
      const g = await checkGoogleAdsTransparency(nd);
      if (g) out.push(g);
    } catch {}
  }
  return out;
}
