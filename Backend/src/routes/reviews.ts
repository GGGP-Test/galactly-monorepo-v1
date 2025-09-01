/**
 * routes/reviews.ts
 * Optional API route to refresh/read review cache for a domain.
 * Mount with:  app.use('/api/v1/reviews', reviewsRouter)
 * (You said not to modify index.ts right now — keep this ready.)
 */
import express from "express";
import { q } from "../db";
import { fetchReviewSignals } from "../connectors/reviews";

export const reviewsRouter = express.Router();

reviewsRouter.get("/:domain", async (req, res) => {
  const domain = String(req.params.domain||"").toLowerCase();
  const r = await q(`SELECT domain, rating, count, pkg_mentions, last_checked, source
                       FROM review_cache WHERE domain=$1
                       ORDER BY last_checked DESC LIMIT 1`, [domain]);
  res.json({ ok:true, cached:r.rows[0] || null });
});

reviewsRouter.post("/refresh", async (req, res) => {
  const domain = String(req.body?.domain||"").toLowerCase();
  if (!domain) return res.status(400).json({ ok:false, error:"missing domain" });
  const sig = await fetchReviewSignals(domain).catch(()=>null);
  if (!sig) return res.json({ ok:true, updated:false });

  await q(
    `INSERT INTO review_cache(domain, rating, count, pkg_mentions, last_checked, source)
     VALUES ($1,$2,$3,$4,now(),$5)
     ON CONFLICT (domain) DO UPDATE
       SET rating=EXCLUDED.rating,
           count=EXCLUDED.count,
           pkg_mentions=EXCLUDED.pkg_mentions,
           last_checked=now(),
           source=EXCLUDED.source`,
    [domain, sig.rating ?? null, sig.count ?? null, sig.pkgMentions ?? null, JSON.stringify(sig.sources)]
  );
  res.json({ ok:true, updated:true, summary: { rating: sig.rating, count: sig.count, pkgMentions: sig.pkgMentions }});
});
