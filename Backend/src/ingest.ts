import fs from "fs/promises";
import { q } from "./db";

// tokens that indicate supplier / procurement intake pages
const TOKENS = [
  "become a supplier","supplier registration","vendor registration",
  "suppliers","supplier","vendors","vendor",
  "procurement","sourcing","rfq","rfi","request for quote","bid"
];

// fetch HTML with timeout
async function getHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function mkUrls(domain: string): string[] {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const bases = [`https://${d}`, `http://${d}`];
  const paths = ["", "/suppliers", "/supplier", "/vendors", "/vendor", "/procurement", "/sourcing", "/rfq", "/rfi", "/bid"];
  const out: string[] = [];
  for (const b of bases) for (const p of paths) out.push((b + p).replace(/\/+$/, ""));
  return Array.from(new Set(out));
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m?.[1]?.trim() || null;
}

function pickSnippet(html: string): string {
  const low = html.toLowerCase();
  for (const t of TOKENS) {
    const i = low.indexOf(t);
    if (i >= 0) {
      const start = Math.max(0, i - 100);
      const end = Math.min(html.length, i + 140);
      return html.slice(start, end).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

async function scanDomain(domain: string) {
  const urls = mkUrls(domain);
  const hits: { url: string; title: string; snippet: string }[] = [];
  for (const u of urls) {
    const html = await getHtml(u);
    if (!html) continue;
    const low = html.toLowerCase();
    const found = TOKENS.some(t => low.includes(t));
    if (!found) continue;
    hits.push({
      url: u,
      title: pickTitle(html) || "Supplier / Vendor intake",
      snippet: pickSnippet(html) || "Vendor / procurement intake detected"
    });
    if (hits.length >= 2) break; // keep it light per domain
  }
  return hits;
}

async function loadBuyerDomains(): Promise<string[]> {
  const p = process.env.BRANDS_FILE || process.env.BUYERS_FILE || "";
  if (!p) return [];
  try {
    const txt = await fs.readFile(p, "utf8");
    return Array.from(new Set(
      txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    ));
  } catch {
    return [];
  }
}

export async function runIngest(source: string) {
  const s = String(source || "brandintake").toLowerCase();

  // we only wire up brandintake on NF; other sources are no-ops here
  if (s !== "brandintake" && s !== "all") return { ok: true, did: "noop" as const };

  const domains = await loadBuyerDomains();
  if (!domains.length) return { ok: true, did: "brandintake", scanned: 0, created: 0, note: "buyers file empty or not mounted" };

  let scanned = 0, created = 0;

  for (const d of domains.slice(0, 250)) { // cap per run
    scanned++;
    const hits = await scanDomain(d);
    for (const h of hits) {
      try {
        await q(
          `INSERT INTO lead_pool(platform, source_url, title, snippet, cat, kw, heat, created_at)
           VALUES('supplier_page',$1,$2,$3,'intake',ARRAY['supplier','procurement'],70, now())
           ON CONFLICT (source_url) DO NOTHING`,
          [h.url, h.title, h.snippet]
        );
        created++;
      } catch { /* ignore single-row failures */ }
    }
  }

  return { ok: true, did: "brandintake", scanned, created };
}
