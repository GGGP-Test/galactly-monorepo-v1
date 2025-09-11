// Backend/src/lib/packagingMath.ts

export type PackagingWhy =
  | { label: "They sell physical products"; detail: string; score: number }
  | { label: "Has cart / checkout"; detail: string; score: number }
  | { label: "Shipping & returns policy"; detail: string; score: number }
  | { label: "Product schema detected"; detail: string; score: number }
  | { label: "Recent activity"; detail: string; score: number };

export type PackagingMathResult = {
  score: number;          // 0..1
  parts: PackagingWhy[];  // human-readable pieces
};

export function packagingMath(html: string): PackagingMathResult {
  const h = html || "";

  const parts: PackagingWhy[] = [];

  // Physical product hints
  const sellsGoods =
    /(add to cart|add-to-cart|buy now|subscribe & save|in stock|sku)/i.test(h);
  if (sellsGoods) parts.push({
    label: "They sell physical products",
    detail: "Found phrases like “Add to cart”, “Buy now”, or SKUs.",
    score: 0.25
  });

  // Cart / checkout
  const hasCart = /(\/cart|cart\.js|checkout)/i.test(h);
  if (hasCart) parts.push({
    label: "Has cart / checkout",
    detail: "Cart/checkout endpoints or scripts present.",
    score: 0.2
  });

  // Shipping / returns
  const hasPolicies = /(shipping|delivery|returns|return policy)/i.test(h);
  if (hasPolicies) parts.push({
    label: "Shipping & returns policy",
    detail: "Policy pages or footer items mention shipping/returns.",
    score: 0.2
  });

  // Product schema
  const productSchema = /"@type"\s*:\s*"(Product|Offer)"/i.test(h);
  if (productSchema) parts.push({
    label: "Product schema detected",
    detail: "Structured data shows Product/Offer items.",
    score: 0.2
  });

  // Recent activity
  const hasNewArrivals = /(new arrivals|just in|new collection)/i.test(h);
  if (hasNewArrivals) parts.push({
    label: "Recent activity",
    detail: "Mentions of “New arrivals/Just in”.",
    score: 0.15
  });

  // Aggregate (cap at 1)
  const score = Math.min(1, parts.reduce((s, p) => s + p.score, 0));
  return { score, parts };
}
