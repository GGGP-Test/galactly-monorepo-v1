/* backend/src/routes/index.ts */
import type { Express } from 'express';
import { mountFind } from './find';
import { mountBuyers } from './buyers';
import { mountWebscout } from './webscout';

export function mountRoutes(app: Express) {
  // consolidated API surface
  mountFind(app);       // POST /api/v1/leads/find
  mountBuyers(app);     // POST /api/v1/leads/find-buyers
  mountWebscout(app);   // POST /api/v1/webscout (optional debugging / preview)
}

export default { mountRoutes };
