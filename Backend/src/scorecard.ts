/**
 * scorecard.ts
 * Central place to compose per-lead “why” metrics from many signals.
 * Now includes review-derived “packaging friction” → boosts hotness.
 */

import { q } from "./db";

export type ScoreCard = {
  domain?: string;
  spendPerMonth?: number;          // from spend.ts (if available)
  review?: {
    rating?: number;               // 0..5
    count?: number;
    pkgMentions?: number;
    needScore?: number;            // 0..100 higher = more packaging opportunity
  };
  // ...other sections you already return
};

/** Pull cached review signals (if any). */
async function getReviewCache(domain: string){
  const r = await q<{rating:number|null,count:number|null,pkg_mentions:number|null}>(
    `SELECT rating, count, pkg_mentions
       FROM review_cache
      WHERE domain=$1
      ORDER BY last_checked DESC
      LIMIT 1`,
    [domain]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    rating: row.rating ?? undefined,
    count: row.count ?? undefined,
    pkgMentions: row.pkg_mentions ?? undefined
  };
}

/** Convert review metrics → “needScore” (0..100). */
function computeReviewNeed(rating?: number, pkgMentions?: number): number|undefined {
  if (rating == null && pkgMentions == null) return undefined;
  const r = rating == null ? 4.3 : rating;
  const neg = Math.max(0, (4.2 - r));     // below ~4.2 starts to suggest friction
  const pkg = Math.min(1, Math.log10(1 + (pkgMentions||0)) / 1.2); // 0..~1
  // blend: more weight on packaging-specific friction
  const score01 = Math.max(0, Math.min(1, 0.35*neg + 0.65*pkg));
  return Math.round(score01 * 100);
}

/** Public: build scorecard for a given lead (by domain). */
export async function buildScorecard(domain?: string): Promise<ScoreCard> {
  const out: ScoreCard = {};
  if (domain) out.domain = domain;

  // Reviews
  if (domain) {
    const rc = await getReviewCache(domain);
    if (rc) {
      out.review = {
        rating: rc.rating,
        count: rc.count,
        pkgMentions: rc.pkgMentions,
        needScore: computeReviewNeed(rc.rating, rc.pkgMentions)
      };
    }
  }

  return out;
}
