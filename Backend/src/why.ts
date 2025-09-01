/**
 * why.ts
 * Compose user-facing bullets that explain “why this lead”.
 * Adds a reviews-based bullet when we have signals.
 */

import { buildScorecard } from "./scorecard";

export type WhyOutput = {
  bullets: string[];
  debug?: any;
};

export async function whyForLead(domain: string): Promise<WhyOutput> {
  const sc = await buildScorecard(domain);
  const bullets: string[] = [];

  // — Existing bullets (spend, timing, product signals, etc.) live above/below —

  // Reviews bullet (only if we have something meaningful)
  if (sc.review && (sc.review.rating != null || sc.review.pkgMentions != null)) {
    const parts: string[] = [];
    if (sc.review.rating != null) parts.push(`avg rating ~${sc.review.rating.toFixed(1)}/5`);
    if (sc.review.count != null) parts.push(`${sc.review.count.toLocaleString()} total reviews`);
    if (sc.review.pkgMentions) parts.push(`${sc.review.pkgMentions} packaging/damage mentions`);

    const tail = sc.review.needScore!=null
      ? `→ packaging-need score ${sc.review.needScore}%`
      : "";

    bullets.push(
      `Public reviews indicate real packaging friction (${parts.join(" · ")}). ${tail}.`
    );

    // Optional “what to say” nudge (kept short for your UI)
    bullets.push(
      `Angle: reference recent damage/pack complaints and offer a pilot pack spec or improved case-of-N—low lift, fast win.`
    );
  }

  return { bullets, debug: { scorecard: sc } };
}
