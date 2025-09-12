/* backend/src/routes/buyers.ts */
import type { App } from '../index';

export function mountBuyers(app: App) {
  // POST /api/v1/leads/find-buyers – alias for backwards compatibility
  app.post('/api/v1/leads/find-buyers', async (req, res) => {
    // Simply delegate to /api/v1/leads/find for now
    req.url = '/api/v1/leads/find';
    (app as any).handle(req, res);
  });
}
