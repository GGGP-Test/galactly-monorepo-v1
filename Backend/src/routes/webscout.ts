/* backend/src/routes/webscout.ts */
import type { App } from '../index';
import { inferPersonaAndTargets } from '../ai/webscout';

export function mountWebscout(app: App) {
  // POST /api/v1/webscout/persona
  app.post('/api/v1/webscout/persona', async (req, res) => {
    try {
      const supplierDomain = String(req.body?.domain || '').trim();
      const region = String(req.body?.region || '').trim() || undefined;
      const radiusMi = Number(req.body?.radiusMi || 50);

      if (!supplierDomain) {
        return res.status(400).json({ ok: false, error: 'domain required' });
      }

      const data = await inferPersonaAndTargets(supplierDomain, { region, radiusMi });
      return res.json({ ok: true, supplierDomain, ...data });
    } catch (err: any) {
      console.error('webscout/persona error', err);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
