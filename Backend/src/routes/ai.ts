// Backend/src/routes/ai.ts
import { Router } from 'express';
import { reasonsForLead } from '../ai/orchestrator';

export const aiRouter = Router();

aiRouter.get('/reasons', async (req, res) => {
  try {
    const url = String(req.query.url || '');
    if (!url) return res.status(400).json({ ok:false, error:'missing url' });
    const title = String(req.query.title || '');
    const snippet = String(req.query.snippet || '');
    const source = String(req.query.source || 'web') as any;

    const out = await reasonsForLead({ url, title, snippet, source });
    res.json({ ok:true, ...out });
  } catch (e:any) {
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

export default aiRouter;
