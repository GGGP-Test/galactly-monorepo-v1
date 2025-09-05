// Lightweight, legal detectors from public HTML.
// DO: respect robots.txt and rate-limit in your fetcher.

import * as cheerio from "cheerio";
import { TechSignals, DemandSignals } from "./lead-features";

export function detectTechAndDemand(html: string): { tech: TechSignals; demand: Partial<DemandSignals> } {
  const $ = cheerio.load(html);

  const scripts = $("script[src]").map((_, el) => String($(el).attr("src"))).get();
  const inlines = $("script:not([src])").map((_, el) => String($(el).html())).get();

  const has = (frag: RegExp) => scripts.some(s => frag.test(s)) || inlines.some(s => frag.test(s));

  const tech: TechSignals = {
    platform: has(/cdn\.shopify\.com|myshopify\.com/i) ? "shopify" :
              has(/static\.magento|mage\/cookies|Magento\//i) ? "magento" :
              has(/bigcommerce\.com\/cdn|stencil-utils/i) ? "bigcommerce" :
              has(/woocommerce|wp-content\/plugins\/woocommerce/i) ? "woocommerce" :
              "custom",
    analyticsTags: [
      has(/gtag\/js|googletagmanager\.com\/gtm\.js|gtm\./i) ? "ga4" : null,
      has(/connect\.facebook\.net\/.*fbevents\.js/i) ? "meta_pixel" : null,
      has(/static\.tiktok\.com\/.*sdk/i) ? "tiktok_pixel" : null,
    ].filter(Boolean) as string[],
    shippingStack: [
      has(/shipstation|easyship|aftership/i) ? "ship_shipstation_or_similar" : null,
    ].filter(Boolean) as string[],
    marketingStack: [
      has(/klaviyo|chimpstatic|mailchimp/i) ? "email_marketing" : null,
    ].filter(Boolean) as string[],
  };

  const demand: Partial<DemandSignals> = {
    checkoutDetected: !!$("a[href*='checkout'], form[action*='checkout']").length
      || has(/\/checkout|ShopifyCheckout|\/cart\.js/i),
    adsActive: has(/fbevents|doubleclick|googleadservices|tiktok_pixel/i),
  };

  return { tech, demand };
}
