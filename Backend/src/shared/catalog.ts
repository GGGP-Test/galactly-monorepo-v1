// src/shared/catalog.ts
import fs from "node:fs";

export type Buyer = {
  host: string;
  name?: string;
  tiers: ("A"|"B"|"C")[];          // who buys packaging at this scale
  segments: string[];              // e.g. ["food","beverage","beauty","industrial"]
  tags?: string[];                 // packaging hints: ["tin","shrink","glass","mailer"]
  cityTags?: string[];             // ["los angeles","nj","bay area","dallas", ...]
  vendorPaths?: string[];          // known supplier/vendor URLs to probe
};

export type BuyersCatalog = { version: number; buyers: Buyer[] };

function decodeMaybeBase64(raw: string) {
  // accept minified JSON, pretty JSON, or base64-encoded JSON
  const trimmed = raw.trim();
  const looksB64 = /^[A-Za-z0-9+/=]+$/.test(trimmed) && !trimmed.includes("{");
  try {
    const txt = looksB64 ? Buffer.from(trimmed, "base64").toString("utf8") : trimmed;
    return txt;
  } catch {
    return trimmed;
  }
}

export function loadBuyersCatalog(): BuyersCatalog {
  const fromEnv = process.env.BUYERS_CATALOG_JSON;
  const fromPath = process.env.BUYERS_CATALOG_PATH; // optional file path fallback

  if (fromEnv && fromEnv.trim()) {
    const txt = decodeMaybeBase64(fromEnv);
    return JSON.parse(txt);
  }
  if (fromPath && fs.existsSync(fromPath)) {
    return JSON.parse(fs.readFileSync(fromPath, "utf8"));
  }
  // last-resort minimal seed so the API still works
  return {
    version: 1,
    buyers: [
      {
        host: "generalmills.com",
        name: "General Mills",
        tiers: ["A"],
        segments: ["food","cpg"],
        tags: ["carton","pouch","film"],
        cityTags: ["minneapolis","mn","midwest"],
        vendorPaths: ["/suppliers","/vendors","/supplier-info"]
      },
      {
        host: "sallybeauty.com",
        name: "Sally Beauty",
        tiers: ["B"],
        segments: ["beauty","retail"],
        tags: ["bottle","jar","label","carton"],
        cityTags: ["denton","tx","dallas","north texas"],
        vendorPaths: ["/suppliers","/vendor","/supplier"]
      },
      {
        host: "kindsnacks.com",
        name: "KIND Snacks",
        tiers: ["B"],
        segments: ["food","snack","cpg"],
        tags: ["film","pouch","carton"],
        cityTags: ["new york","nyc","ny","manhattan"],
        vendorPaths: ["/suppliers","/vendor"]
      },
      {
        host: "califiafarms.com",
        name: "Califia Farms",
        tiers: ["B","C"],
        segments: ["beverage","cpg"],
        tags: ["bottle","label","shrink"],
        cityTags: ["los angeles","la","southern california","so cal"],
        vendorPaths: ["/suppliers","/supplier","/vendor"]
      },
      {
        host: "perfectsnacks.com",
        name: "Perfect Snacks",
        tiers: ["C"],
        segments: ["food","snack","cpg"],
        tags: ["film","pouch","case"],
        cityTags: ["san diego","sd","southern california"],
        vendorPaths: ["/suppliers","/vendor"]
      }
    ]
  };
}