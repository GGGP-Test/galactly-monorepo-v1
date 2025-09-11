/* backend/src/routes/webscout.ts */
import type { Express } from 'express';
import { z } from 'zod';
import { inferPersonaAndTargets } from '../ai/webscout';

const bodySchema = z.object({
  supplierDomain: z.string().min(3),
});

export function mountWebscout(app: Express) {
  app.post('/api/v1/webscout', async (req, res) => {
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'bad_request', details: parse.error.flatten() });

    const persona = await inferPersonaAndTargets({ supplierDomain: parse.data.supplierDomain });
    res.json({ ok: true, persona });
  });
}

export default { mountWebscout };
