// Backend/src/lib/platform.ts
import type { IncomingHttpHeaders } from "http";

export type Platform =
  | "shopify"
  | "woocommerce"
  | "bigcommerce"
  | "squarespace"
  | "wix"
  | "webflow"
  | "custom"
  | "unknown";

export function detectPlatform({
  url,
  html,
  headers,
}: {
  url: string;
  html: string;
  headers?: IncomingHttpHeaders;
}): Platform {
  const h = html || "";

  // Shopify
  if (
    /cdn\.shopify\.com|x-shopify|Shopify\.theme|Shopify\.routes/i.test(h) ||
    /\/cart\.js|\/collections\/all/i.test(h)
  ) return "shopify";

  // WooCommerce (WordPress)
  if (
    /woocommerce|wp-content\/plugins\/woocommerce|wc-add-to-cart/i.test(h) ||
    /<meta name="generator" content="WordPress/i.test(h)
  ) return "woocommerce";

  // BigCommerce
  if (/cdn\.bcapp|stencil-bootstrap|bigcommerce/i.test(h)) return "bigcommerce";

  // Squarespace
  if (/squarespace|Static\.sqs-assets|meta name="generator" content="Squarespace/i.test(h))
    return "squarespace";

  // Wix
  if (/wix-code|wix-static|wix\.apps|wixBiSession/i.test(h)) return "wix";

  // Webflow
  if (/webflow\.io|webflow\.js|data-wf-site/i.test(h)) return "webflow";

  // Fallback
  return "unknown";
}
