import type { Express, Request, Response } from "express";
import { json } from "express";
import type { Lead, Temp } from "./public";

/** ----------------- shared in-memory store (unify keys) ----------------- */

type LeadsStore = { hot: Lead[]; warm: Lead[] };

// Keys other routes might be using; we'll keep them all pointing
// at the same object so reads/writes stay consistent.
const STORE_KEYS = ["leads", "leadsStore", "publicLeads", "storeLeads"] as const;

function getUnifiedStore(app: Express["locals"]): LeadsStore {
  // If any key already exists, use that as the canonical object.
  for (const k of STORE_KEYS) {
    const obj = (app as any)[k];
    if (obj && typeof obj === "object" && Array.isArray(obj.hot) && Array.isArray(obj.warm)) {
      // Mirror across all known keys.
      for (const kk of STORE_KEYS) (app as any)[kk] = obj;
      return obj as LeadsStore;
    }
  }
  // Otherwise make a fresh one and alias across all keys.
  const fresh: LeadsStore = { hot: [], warm: [] };
  for (const k of STORE_KEYS) (app as any)[k] = fresh;
  return fresh;
}

function mkId(seed: string, i: number) {
  const base = Buffer.from(`${seed}:${i}`).toString("base64url").slice(0, 8);
  return `L_${Date.now()}_${base}`;
}

/** -------------------------- input parsing -------------------------- */

function readDomain(req: Request): string {
  const b: any = req.body || {};
  return (
    b.domain ?? b.host ?? b.supplier ?? b.website ?? b.url ?? ""
  )
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

/** ------------------- lightweight HTML fetching -------------------- */

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
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function rootHost(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  if (tld.length === 2 && (second.length <= 3 || second === "co")) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/** ------------ discover potential customer domains ---------------- */

async function discoverCustomerDomains(supplierHost: string): Promise<string[]> {
  const base = `https://${supplierHost}`;
  const out = new Set<string>();

  const paths = [
    "/",
    "/customers",
    "/clients",
    "/client-list",
    "/case-studies",
    "/case_studies",
    "/our-customers",
    "/industries",
    "/industries-served",
    "/partners",
    "/about",
    "/about/clients",
    "/about/customers",
    "/customer-list",
  ];

  for (const p of paths) {
    const html = await fetchHtml(`${base}${p}`);
    if (!html) continue;

    const rx = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(html))) {
      const href = m[1];
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;

      const host = toHostname(href, base);
      if (!host) continue;

      const r = rootHost(host);
      if (isSocial(r)) continue;
      if (r === rootHost(supplierHost)) continue;
      if (/\.(png|jpe?g|svg|webp|gif|pdf|css|js|json)(\?|$)/i.test(href)) continue;

      out.add(r);
      if (out.size >= 30) break;
    }
    if (out.size >= 30) break;
  }

  return Array.from(out);
}

/** --------------------------- route ------------------------------- */

export default function mountFind(app: Express) {
  app.post("/api/v1/leads/find-buyers", json(), async (req: Request, res: Response) => {
    const domain = readDomain(req);
    const region = (req.body?.region ?? "US/CA").toString().trim();
    const radiusMi = Number(req.body?.radiusMi ?? 50);

    if (!domain) {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    try {
      const store = getUnifiedStore(req.app.locals);

      const discovered = await discoverCustomerDomains(domain);
      const now = new Date().toISOString();

      const leads: Lead[] = (discovered.length ? discovered : [domain])
        .slice(0, 12)
        .map((host, i) => ({
          id: mkId(host, i),
          host,
          platform: "web",
          title: discovered.length ? `Potential buyer @ ${host}` : `Prospect ${i + 1} @ ${domain}`,
          createdAt: now,
          temp: (i < 3 ? "hot" : "warm") as Temp,
          why: discovered.length
            ? `Linked from supplier (${domain}); region ${region}; ${radiusMi}mi`
            : `Fallback seed; refine supplier pages`,
          region,
        }));

      // Persist into the shared store the /leads route reads from
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
        `[find] POST /leads/find-buyers -> 200 supplier=${domain} created=${leads.length} hot=${payload.hot} warm=${payload.warm}`
      );

      return res.status(200).json(payload);
    } catch (err: any) {
      console.error("[find] error:", err?.stack || err);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
}
