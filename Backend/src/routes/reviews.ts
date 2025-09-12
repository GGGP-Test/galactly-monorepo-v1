import { Application, Request, Response } from "express";

/**
 * Keep it type-safe and independent of connector shapes.
 * Returns an empty summary for now so TS doesn't complain about unknown fields.
 */
export function mountReviews(app: Application) {
  app.get("/api/reviews/summary", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      summary: {
        rating: null,
        count: 0,
        pkgMentions: 0,
        sources: []
      }
    });
  });
}

export default mountReviews;
