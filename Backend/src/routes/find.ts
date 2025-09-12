import type { Express, Request, Response } from "express";
import { json } from "express";
import type { Lead, Temp } from "./public";

// ----------------------- in-memory store -----------------------

type LeadsStore = { hot: Lead[]; warm: Lead[] };

function getStore(req: Request): LeadsStore {
  const app = req.app;
  if (!app.locals.leadsStore) app.locals.leadsStore = { hot: [], warm: [] } as LeadsStore;
  return app.locals.leadsStore as LeadsStore;
}

function mkId(seed: string, i: number) {
  const base = Buffer.from(`${seed}:${i}`).toString("base64url").slice(0, 8);
  return `L_${Date.now()}_${base}`;
}

// ----------------------- request parsing -----------------------

function readDomain(req: Request): string {
  const b: any = req.body || {};
  return (
    b.domain ||
    b.host ||
    b.supplier ||
    b.website ||
    b.url ||
    ""
  )
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

// ----------------------- simple HTML fetch ---------------------

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; PackleadBot/1.0; +https://example.invalid/bot)",
        accept: "text/html,*/*;q=0.8",
      },
    });
    clearTimeout(t);
    if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function isSocial(host: string) {
  return /(facebook|linkedin|twitter|x\.com|instagram|youtube|tiktok|google|goo\.gl|maps\.google|mailto|tel)/i.test(
    host
  );
}

function toHostname(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost") return null;
    return host;
  } catch {
    return null;
  }
}

function rootHost(host: string): string {
  // simple root extractor: keep last two labels by default
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  // crude ccTLD handling like .co.uk -> keep last 3
  if (tld.length === 2 && (second.length <= 3 || second === "co")) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

// ------------------ discover customers from site ----------------

async function discoverCustomerDomains(supplierHost: string): Promise<string[]> {
  const base = `https://${supplierHost}`;
  const candidates = new Set<string>();

  // Try likely pages that list customers / case studies / industries / partners
  const paths = [
    "/",
    "/customers",
    "/clients",
    "/client-list",
    "/case-studies",
    "/case_studies",
    "/case-studies.html",
    "/our-customers",
    "/industries",
    "/industries-served",
    "/partners",
    "/about",
  ];

  for (const p of paths) {
    const html = await fetchHtml(`${base}${p}`);
    if (!html) continue;

    // Extract anchor hrefs
    const rx = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(html))) {
      const href = m[1];
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        continue;
      }
      const host = toHostname(href, base);
      if (!host) continue;
      const r = rootHost(host);
      if (isSocial(r)) continue;
      // skip self & typical CDNs/assets
      if (r === rootHost(supplierHost)) continue;
      if (/\.(png|jpe?g|svg|webp|gif|pdf|css|js|json)(\?|$)/i.test(href)) continue;
      candidates.add(r);
      if (candidates.size >= 30) break;
    }
    if (candidates.size >= 30) break;
  }

  return Array.from(candidates);
}

// --------------------- express route ---------------------------

export default function mountFind(app: Express) {
  // Caution: keep json() here so req.body is populated (fixes earlier 400)
  app.post("/api/v1/leads/find-buyers", json(), async (req: Request, res: Response) => {
    const domain = readDomain(req);
    const region = (req.body?.region ?? "US/CA").toString().trim();
    const radiusMi = Number(req.body?.radiusMi ?? 50);

    if (!domain) {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    try {
      const store = getStore(req);

      // Discover off-domain customer/company links from the supplier site
      const discovered = await discoverCustomerDomains(domain);

      if (discovered.length === 0) {
        console.log(`[find] no off-domain links found for ${domain}`);
      }

      const now = new Date().toISOString();

      // Turn discovered domains into warm leads; small sample gets "hot"
      const leads: Lead[] = (discovered.length ? discovered : [domain])
        .slice(0, 12)
        .map((host, i) => ({
          id: mkId(host, i),
          host,
          platform: "web",
          title: discovered.length
            ? `Potential buyer @ ${host}`
            : `Prospect ${i + 1} @ ${domain}`,
          createdAt: now,
          temp: (i < 3 ? "hot" : "warm") as Temp,
          why: discovered.length
            ? `Linked from supplier (${domain}); region ${region}; ${radiusMi}mi`
            : `Fallback seed; refine supplier pages`,
          region,
        }));

      for (const l of leads) {
        if (l.temp === "hot") store.hot.unshift(l);
        else store.warm.unshift(l);
      }

      const payload = {
        ok: true,
        created: leads.length,
        hot: store.hot.length,
        warm: store.warm.length,
      };

      console.log(
        `[find] POST /leads/find-buyers -> 200 supplier=${domain} created=${leads.length} (hot=${store.hot.length}, warm=${store.warm.length})`
      );
      return res.status(200).json(payload);
    } catch (err: any) {
      console.error("[find] error:", err?.stack || err);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
}
