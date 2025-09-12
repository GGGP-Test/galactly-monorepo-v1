import type { Request, Response } from 'express';
import type { App } from '../index';

function mountWebscout(app: App) {
  app.post('/api/v1/webscout', async (req: Request, res: Response) => {
    res.json({ ok: true, leads: [] });
  });
}

export default mountWebscout;
