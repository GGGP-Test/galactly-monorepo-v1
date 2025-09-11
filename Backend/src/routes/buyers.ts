/* backend/src/routes/buyers.ts */
import type { Express } from 'express';
import { z } from 'zod';
import { inferPersonaAndTargets, scoreAndLabelCandidates } from '../ai/webscout';

const bodySchema = z.object({
  supplierDomain: z.string().min(3),
  region: z.string().optional(),       // "us", "ca", "us-ca", "San Francisco, CA"
  radiusMiles: z.number().int().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export function mountBuyers(app: Express) {
  app.post('/api/v1/leads/find-buyers', async (req, res) => {
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'bad_request', details: parse.error.flatten() });

    const { supplierDomain, region, radiusMiles, limit } = parse.data;

    // 1) derive persona/targets
    const persona = await inferPersonaAndTargets({ supplierDomain });

    // 2) web scout (real-time) — placeholder adapter here; replace with your fetchers
    // For now we use seeds + heuristics inside scoreAndLabelCandidates() to keep endpoint working.
    const rawRows: Array<{ host: string; title?: string }> = []; // plug WebScout adapters here

    const labeled = await scoreAndLabelCandidates({
      supplierDomain,
      persona,
      regionHint: region ?? 'us/ca',
      radiusMiles: radiusMiles ?? 50,
      rows: rawRows,
      max: limit ?? 50,
    });

    res.json({
      ok: true,
      supplierDomain,
      persona,
      count: labeled.length,
      candidates: labeled,
    });
  });
}

export default { mountBuyers };
