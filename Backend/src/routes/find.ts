/* backend/src/routes/find.ts */
import type { App } from '../index';
import { inferPersonaAndTargets } from '../ai/webscout';

export function mountFind(app: App) {
  // POST /api/v1/leads/find   – kick off a real-time scout for buyers
  app.post('/api/v1/leads/find', async (req, res) => {
    try {
      const supplier = String(req.body?.supplier || req.body?.domain || '').trim();
      const region = String(req.body?.region || '').trim() || undefined;
      const radiusMi = Number(req.body?.radiusMi || 50);

      if (!supplier) {
        return res.status(400).json({ ok: false, error: 'supplier (domain) required' });
      }

      // v0: return persona/targets immediately to prove value; next step wires fetchers.
      const { persona, targets } = await inferPersonaAndTargets(supplier, { region, radiusMi });

      // NOTE: In the next iteration, call your fetchers to produce hot/warm candidates.
      return res.json({
        ok: true,
        supplier,
        persona,
        targets,
        candidates: [],
        note: 'WebScout v0: persona/targets returned; real-time fetchers to be wired next.',
      });
    } catch (err: any) {
      console.error('leads/find error', err);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
