// src/routes/buyers.ts
import { Router, Request, Response } from 'express';
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  buckets,
  watchers as getWatchers,
  type StoredLead,
  type Temp
} from '../shared/memStore';

const router = Router();

/* ----------------------------- helpers ----------------------------- */

type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;
  temp?: 'hot' | 'warm' | 'cold' | string;
  whyText?: string;
};

type ApiOk<T = any> = { ok: true; items?: T; [k: string]: any };
type ApiErr = { ok: false; error: string };

const ok = (res: Response, items?: any, extra: Record<string, any> = {}) =>
  res.json({ ok: true, ...(items !== undefined ? { items } : {}), ...extra } as ApiOk);

const bad = (res: Response, error: string, code = 400) =>
  res.status(code).json({ ok: false, error } as ApiErr);

const normHost = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

const toItem = (lead: StoredLead): LeadItem => ({
  host: lead.host,
  platform: lead.platform || 'web',
  title: lead.title || `Buyer lead for ${lead.host}`,
  created: lead.created,
  temp: lead.temperature,
  whyText: lead.why || 'Compat shim matched'
});

function toCSV(rows: StoredLead[]) {
  const cols = ['host', 'platform', 'title', 'created', 'temp', 'whyText'] as const;
  const head = cols.join(',');
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.host,
      r.platform || 'web',
      r.title || `Buyer lead for ${r.host}`,
      r.created,
      r.temperature,
      r.why || ''
    ].map(esc).join(',')
  );
  return [head, ...lines].join('\r\n');
}

/* --------------------------- core endpoints --------------------------- */

/**
 * Lock a lead as warm/hot and return simple FOMO counters.
 * POST /api/leads/lock  { host, temp: "warm" | "hot" }
 */
router.post('/leads/lock', (req: Request, res: Response) => {
  const host = normHost(req.body?.host);
  const temp: Temp = (req.body?.temp === 'hot' ? 'hot' : req.body?.temp === 'cold' ? 'cold' : 'warm');

  if (!host) return bad(res, 'host is required');

  // Ensure lead exists, then bump temperature
  const lead = replaceHotWarm(host, temp);
  if (!lead.title) lead.title = `Buyer lead for ${host}`;
  if (!lead.platform) lead.platform = 'web';
  if (!lead.why) lead.why = temp === 'hot' ? 'High-signal interest' : 'Compat shim matched';

  // Faux FOMO numbers from mem store (never zero)
  const w = getWatchers(host);
  const fomo = {
    watchers: Math.max(2, w.watchers.length || 0),
    competitors: Math.max(1, w.competitors.length || 0)
  };

  // Save any updates back
  saveByHost(host, lead);

  return ok(res, undefined, { item: toItem(lead), fomo });
});

/**
 * Generate a few deeper variations (placeholder logic).
 * POST /api/leads/deepen  { host, region, radius, topK? }
 */
router.post('/leads/deepen', (req: Request, res: Response) => {
  const host = normHost(req.body?.host);
  if (!host) return bad(res, 'host is required');

  const topK = Math.max(1, Math.min(Number(req.body?.topK ?? 3), 5));

  // base lead
  const base = ensureLeadForHost(host);
  if (!base.platform) base.platform = 'web';
  if (!base.title) base.title = `Buyer lead for ${host}`;
  if (!base.why) base.why = 'Compat shim matched';

  // simple synthetic variants
  const variants: StoredLead[] = Array.from({ length: topK }).map((_, i) => {
    const titles = [
      `Materials Manager @ ${host}`,
      `Purchasing @ ${host}`,
      `Operations @ ${host}`,
      `Sourcing @ ${host}`,
      `Supply Chain @ ${host}`
    ];
    const temps: Temp[] = ['warm', 'warm', 'cold', 'warm', 'hot'];
    return {
      ...base,
      title: titles[i % titles.length],
      temperature: temps[i % temps.length],
      why: i === topK - 1 ? 'Recent activity + firmographic match' : base.why
    };
  });

  return ok(res, variants.map(toItem));
});

/**
 * JSON lists for saved leads
 *   GET /api/leads/warm
 *   GET /api/leads/hot
 *   GET /api/leads/list?temp=warm|hot|cold|all
 */
router.get('/leads/warm', (_req, res) => {
  const b = buckets();
  return ok(res, b.warm.map(toItem));
});
router.get('/leads/hot', (_req, res) => {
  const b = buckets();
  return ok(res, b.hot.map(toItem));
});
router.get('/leads/list', (req, res) => {
  const t = String(req.query?.temp ?? 'warm').toLowerCase();
  const b = buckets();
  let rows: StoredLead[] = [];
  if (t === 'all') rows = [...b.hot, ...b.warm, ...b.cold];
  else if (t === 'hot') rows = b.hot;
  else if (t === 'cold') rows = b.cold;
  else rows = b.warm;
  return ok(res, rows.map(toItem));
});

/**
 * CSV downloads
 *   GET /api/leads/warm.csv
 *   GET /api/leads/hot.csv
 */
router.get('/leads/warm.csv', (_req, res) => {
  const csv = toCSV(buckets().warm);
  res.type('text/csv; charset=utf-8').send(csv);
});
router.get('/leads/hot.csv', (_req, res) => {
  const csv = toCSV(buckets().hot);
  res.type('text/csv; charset=utf-8').send(csv);
});

/* ------------------------ optional compat helpers ------------------------ */
/* If your panel calls /api/find-one as a fallback, answer it here too. */
router.post('/find-one', (req: Request, res: Response) => {
  const host = normHost(req.body?.host);
  if (!host) return bad(res, 'host is required');

  const lead = ensureLeadForHost(host);
  if (!lead.platform) lead.platform = 'web';
  if (!lead.title) lead.title = `Buyer lead for ${host}`;
  if (!lead.why) lead.why = 'Compat shim matched';

  return ok(res, [toItem(lead)]);
});

export default router;