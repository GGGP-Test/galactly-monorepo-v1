import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------
// Minimal, DB-optional API server
// Matches Northflank free plan. Adds routes:
//   GET  /healthz
//   GET  /__routes
//   GET  /api/v1/status
//   POST /api/v1/presence/beat
//   GET  /api/v1/presence/online
//   GET  /api/v1/leads
//   GET  /api/v1/debug/peek
//   GET  /api/v1/admin/poll-now  (x-admin-token or ?token=)
// ---------------------------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// CORS (GitHub Pages, NF routes, etc.)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// attach user id if provided
app.use((req, _res, next) => {
  (req as any).userId = req.header('x-galactly-user') || null;
  next();
});

// ---------------------------
// Health
// ---------------------------
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------------------------
// Route index (helps sanity checks)
// ---------------------------
function listRoutes() {
  const out: { path: string; methods: string[] }[] = [];
  (app as any)._router?.stack?.forEach((r: any) => {
    if (r.route && r.route.path) {
      out.push({ path: r.route.path, methods: Object.keys(r.route.methods || {}) });
    }
  });
  // Stable order
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
app.get('/__routes', (_req, res) => res.json(listRoutes()));

// ---------------------------
// Presence (soft online count)
// ---------------------------
const pings = new Map<string, number>();
const ttlMs = 30_000;
function sweepPings() {
  const now = Date.now();
  for (const [k, t] of pings) if (now - t > ttlMs) pings.delete(k);
}
setInterval(sweepPings, 5_000);

app.post('/api/v1/presence/beat', (req, res) => {
  const id = (req as any).userId || 'anon';
  pings.set(String(id), Date.now());
  res.json({ ok: true });
});

app.get('/api/v1/presence/online', (_req, res) => {
  sweepPings();
  res.json({ ok: true, total: pings.size, displayed: Math.max(1, pings.size) });
});

// ---------------------------
// Status
// ---------------------------
app.get('/api/v1/status', (req, res) => {
  const userId = (req as any).userId || 'anon';
  const fp = String(userId).split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 1000;
  res.json({ ok: true, fp, cooldownSec: 0, priority: 1 });
});

// ---------------------------
// Leads (DB-optional stub)
// If you have a DB service, we will switch to it later.
// For now, return an in-memory/demo list so the UI never breaks.
// ---------------------------
export type Lead = {
  id: number;
  platform: string;
  source_url: string;
  title: string;
  snippet: string;
  created_at: string;
};

const demoLeads: Lead[] = Array.from({ length: 8 }).map((_, i) => ({
  id: i + 1,
  platform: 'demo',
  source_url: 'https://example.com/demo/' + (i + 1),
  title: 'Sample lead #' + (i + 1),
  snippet: 'Demo card while ingest warms up',
  created_at: new Date(Date.now() - i * 60_000).toISOString(),
}));

app.get('/api/v1/leads', (_req, res) => {
  const nextRefreshSec = 15;
  res.json({ ok: true, leads: demoLeads, nextRefreshSec });
});

// ---------------------------
// Debug peek (env flags only)
// ---------------------------
app.get('/api/v1/debug/peek', (_req, res) => {
  const env = {
    GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
    GOOGLE_CX_COUNT: Object.keys(process.env).filter((k) => k.startsWith('GOOGLE_CX_') && (process.env[k] || '').length > 0).length,
    FEEDS_NATIVE_FILE: !!process.env.FEEDS_NATIVE_FILE,
    RSSHUB_FEEDS_FILE: !!process.env.RSSHUB_FEEDS_FILE,
  };
  res.json({ ok: true, env });
});

// ---------------------------
// Admin: trigger ingest (stub)
// ---------------------------
function isAdmin(req: Request) {
  const token = (req.query.token as string) || req.header('x-admin-token') || '';
  return ADMIN_TOKEN && token === ADMIN_TOKEN;
}

app.get('/api/v1/admin/poll-now', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const source = (req.query.source as string) || 'all';
  // no-op stub — real collector lives in a separate worker or future step
  res.json({ ok: true, started: true, source });
});

// ---------------------------
// Error handler
// ---------------------------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: 'internal_error' });
});

// ---------------------------
// Start
// ---------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`galactly-api listening on :${PORT}`);
});
