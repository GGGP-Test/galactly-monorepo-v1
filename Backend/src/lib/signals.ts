// Backend/src/lib/signals.ts

export type AdSignal =
  | { network: "google-ads"; id?: string }
  | { network: "meta-pixel"; id?: string }
  | { network: "tiktok-pixel"; id?: string }
  | { network: "linkedin-insight"; id?: string };

export function detectAdSignals(html: string): AdSignal[] {
  const h = html || "";
  const out: AdSignal[] = [];

  const gads = /AW-(\d{6,})/i.exec(h);
  if (/gtag\(.+?googleads\.g\.doubleclick\.net|AW-\d/i.test(h)) {
    out.push({ network: "google-ads", id: gads?.[1] });
  }
  const meta = /fbq\(['"]init['"]\s*,\s*['"](\d{8,})['"]\)/i.exec(h);
  if (/facebook\.net\/en_US\/fbevents\.js|fbq\(/i.test(h)) {
    out.push({ network: "meta-pixel", id: meta?.[1] });
  }
  const tt = /ttq\.load\(['"](\w{6,})['"]\)/i.exec(h);
  if (/tiktok\.com\/i18n\/pixel/i.test(h) || /ttq\.track/i.test(h)) {
    out.push({ network: "tiktok-pixel", id: tt?.[1] });
  }
  if (/snap\.licdn\.com\/li_lms|linkedin/i.test(h)) {
    out.push({ network: "linkedin-insight" });
  }
  return out;
}

export function intentKeywords(text: string): { keywords: string[]; score: number } {
  // Hot intent terms
  const terms = ["rfp", "rfq", "tender", "request for proposal", "request for quote", "packaging supplier", "co-packer", "3pl"];
  const hits = terms.filter(t => new RegExp(`\\b${t.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
  const score = Math.min(1, hits.length * 0.25);
  return { keywords: hits, score };
}
