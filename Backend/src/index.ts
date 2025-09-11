/* backend/src/index.ts */
import express, { type Express } from 'express';
import cors from 'cors';

// Optional logger without forcing dependency:
// - avoids build errors if 'morgan' isn't installed
function tryMorgan() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('morgan'); // typed via stub; present or not, build won't fail
    return typeof m === 'function' ? m : (m?.default ?? null);
  } catch {
    return null;
  }
}

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  const morgan = tryMorgan();
  if (morgan) {
    app.use(morgan('tiny'));
  }

  // mount routes
  const { mountRoutes } = require('./routes'); // avoid circular types
  mountRoutes(app);

  // health
  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

  return app;
}

// If we're executed directly, start a server (for local / dev)
if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT ? Number(process.env.PORT) : 8787;
  app.listen(port, () => {
    console.log(`[server] listening on http://0.0.0.0:${port}`);
  });
}

export default createApp;
