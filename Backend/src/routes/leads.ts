// src/routes/leads.ts
import { Router, Request, Response } from 'express';

// Import the memStore loosely to avoid type friction if its exports change.
import * as store from '../shared/memStore';
const Store: any = store as any;

type Persona = {
  offer?: string;
  solves?: string;
  titles?: string[] | string;
};

function normHost(h: unknown): string {
  const s = String(h ?? '').trim().toLowerCase();
  if (!s) return '';
  try {
    // Strip scheme/path if user pasted a URL
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return s.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  }
}

function readInput(req: Request) {
  const src: any = req.method === 'GET' ? req.query : (req.body ?? {});
  const host =
    normHost(
      src.host ??
      src.supplier ??
      src.domain ??
      src.website ??
      src.q
    );
  const region = String(src.region ?? src.country ?? 'US/CA');
  const radius = Number(src.radius ?? src.r ?? 50);
  const persona: Persona = {
    offer: src.persona?.offer ?? src.offer,
    solves: src.persona?.solves ?? src.solves,
    titles: src.persona?.titles ?? src.titles,
  };
  return { host, region, radius, persona };
}

function makeLead(host: string) {
  // Build a minimal lead object the panel can display.
  // If memStore has helpers, use them; otherwise synthesize.
  const ts = new Date().toISOString();
  const base = {
    id: host,
    host,
    platform: 'web',
    title: 'Potential buyer',
    created: ts,
    temp: 'warm',
    whyText: `Seeded lead for ${host}`,
  };

  // If store has get/save, try to persist/fetch
  try {
    const existing = Store.getByHost?.(host);
    if (existing) return existing;
    Store.saveByHost?.(host, base);
  } catch { /* no-op */ }

  return base;
}

async function findOneHandler(req: Request, res: Response) {
  const { host } = readInput(req);
  if (!host) return res.status(400).json({ ok: false, error: 'host is required' });

  // Prefer store if it can produce/enrich; fall back to synth
  let item: any;
  try {
    item = Store.getByHost?.(host);
  } catch { /* ignore */ }
  if (!item) item = makeLead(host);

  return res.json({ ok: true, item });
}

async function findManyHandler(req: Request, res: Response) {
  const { host } = readInput(req);
  if (!host) return res.status(400).json({ ok: false, error: 'host is required' });

  // Simple strategy: one primary + any warm/hot neighbors if store exposes buckets
  const items: any[] = [];
  try {
    const primary = Store.getByHost?.(host);
    if (primary) items.push(primary);
  } catch { /* ignore */ }

  if (!items.length) items.push(makeLead(host));

  // Try to add a couple of “similar” entries from store if available
  try {
    const all = Store.buckets?.() ?? [];
    const extra = Array.isArray(all)
      ? all
          .flatMap((b: any) => b?.items ?? b ?? [])
          .filter((x: any) => x?.host && x.host !== host)
          .slice(0, 3)
      : [];
    for (const x of extra) items.push(x);
  } catch { /* ignore */ }

  return res.json({ ok: true, items });
}

export const leadsRouter = Router();

// Aliases for maximum compatibility with the panel’s auto-probe
// /leads/*
leadsRouter.get('/find-buyers', findManyHandler);
leadsRouter.post('/find-buyers', findManyHandler);
leadsRouter.get('/find-one', findOneHandler);
leadsRouter.post('/find-one', findOneHandler);
leadsRouter.get('/find', findOneHandler);
leadsRouter.post('/find', findOneHandler);

// /buyers/* (aliases)
leadsRouter.get('/buyers/find-buyers', findManyHandler);
leadsRouter.post('/buyers/find-buyers', findManyHandler);
leadsRouter.get('/buyers/find-one', findOneHandler);
leadsRouter.post('/buyers/find-one', findOneHandler);
leadsRouter.get('/buyers/find', findOneHandler);
leadsRouter.post('/buyers/find', findOneHandler);