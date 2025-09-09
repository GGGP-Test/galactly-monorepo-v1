import { Router } from 'express';

function getBuildInfo() {
  // Values you can set in Northflank env or ignore (defaults shown)
  const commit = process.env.NF_COMMIT || process.env.COMMIT_SHA || 'unknown';
  const version = process.env.APP_VERSION || '0.1.0';
  return { version, commit };
}

export default function makeHealthRouter() {
  const r = Router();

  // Liveness probe – "is the process up?"
  r.get('/livez', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // Readiness probe – "is the app ready to serve?"
  // Keep this simple for now; later you can add checks (db, cache, external APIs)
  r.get('/readyz', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // Legacy/common name
  r.get('/healthz', (_req, res) => {
    const { version, commit } = getBuildInfo();
    res.json({
      ok: true,
      time: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      version,
      commit
    });
  });

  return r;
}
