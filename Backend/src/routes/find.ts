/* backend/src/routes/find.ts */
import type { Express } from 'express';
import { z } from 'zod';
import { inferPersonaAndTargets } from '../ai/webscout';

const bodySchema = z.object({
  supplierDomain: z.string().min(3),
  region: z.string().optional(),    // e.g. "us" | "ca" | "San Francisco, CA"
  radiusMiles: z.number().int().min(1).max(500).optional(),
});

export function mountFind(app: Express) {
  app.post('/api/v1/leads/find', async (req, res) => {
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'bad_request', details: parse.error.flatten() });

    const { supplierDomain, region, radiusMiles } = parse.data;

    // 1) persona + targets from supplier
    const persona = await inferPersonaAndTargets({ supplierDomain });

    // 2) return a stubbed list (the panel expects structure). Real-time web scout hooks in buyers route.
    res.json({
      ok: true,
      persona,
      // empty result set here by design; panel refreshes from /find-buyers which actually collects candidates
      candidates: [],
      region: region ?? 'us/ca',
      radiusMiles: radiusMiles ?? 50,
    });
  });
}

export default { mountFind };
