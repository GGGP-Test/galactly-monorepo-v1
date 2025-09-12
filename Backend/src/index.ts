/* backend/src/index.ts */
import express, { type Express } from 'express';
import cors from 'cors';

// NOTE: make morgan optional so TypeScript doesn't require its types.
// This also avoids "Cannot find module 'morgan'" at compile time.
let morganFn: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  morganFn = require('morgan');
} catch {
  morganFn = null;
}

export type App = Express;

export const app: App = express();
app.use(cors());
app.use(express.json());

if (morganFn) {
  app.use(morganFn('dev'));
} else {
  // Tiny fallback logger if morgan isn't installed.
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });
}

/** Mount helpers (imported below) register their own routes on the app */
import { mountFind } from './routes/find';
import { mountBuyers } from './routes/buyers';
import { mountWebscout } from './routes/webscout';
import { mountLeads } from './routes/leads';

mountFind(app);
mountBuyers(app);
mountWebscout(app);
mountLeads(app); // keep whatever you already had under /api/v1/leads

// Healthz for platform checks
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Export default for server bootstrap or tests
export default app;
