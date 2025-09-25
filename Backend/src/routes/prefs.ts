import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  Prefs,
  PrefsInput,
  DEFAULT_PREFS,
  normalizePrefs,
} from '../shared/prefs';

const router = Router();

/* ----------------------------------------------------------------------------
 * Lightweight store (memory) + optional JSON persistence
 * --------------------------------------------------------------------------*/

type Store = Record<string, Prefs>;
let MEM: Store = Object.create(null);

const PREFS_FILE = process.env.PREFS_FILE; // e.g., "/data/prefs.json"

function safeLoadFromDisk(): void {
  if (!PREFS_FILE) return;
  try {
    if (fs.existsSync(PREFS_FILE)) {
      const raw = fs.readFileSync(PREFS_FILE, 'utf8');
      const json = JSON.parse(raw);
      if (json && typeof json === 'object') {
        MEM = json as Store;
        // eslint-disable-next-line no-console
        console.log('[prefs] loaded from', PREFS_FILE, 'keys=', Object.keys(MEM).length);
      }
    } else {
      // ensure directory exists
      fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
      fs.writeFileSync(PREFS_FILE, JSON.stringify(MEM), 'utf8');
      // eslint-disable-next-line no-console
      console.log('[prefs] created empty store at', PREFS_FILE);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[prefs] load failed:', err);
  }
}

function safeSaveToDisk(): void {
  if (!PREFS_FILE) return;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(MEM), 'utf8');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[prefs] save failed:', err);
  }
}

// Initialize once.
safeLoadFromDisk();

/* ----------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------*/

function keyFrom(req: Request): string {
  // prefer explicit host in query/body; fallback to "default"
  const hostQ = (req.query.host as string | undefined)?.trim();
  const hostB = (req.body?.host as string | undefined)?.trim();
  return (hostQ || hostB || 'default').toLowerCase();
}

function getOrDefault(hostKey: string): Prefs {
  return MEM[hostKey] || { ...DEFAULT_PREFS, host: hostKey, updatedAt: new Date().toISOString() };
}

/* ----------------------------------------------------------------------------
 * Routes
 * --------------------------------------------------------------------------*/

// health (optional)
router.get('/prefs/healthz', (_req, res) => {
  res.json({
    ok: true,
    keys: Object.keys(MEM).length,
    persisted: Boolean(PREFS_FILE),
  });
});

router.get('/api/prefs/defaults', (_req, res) => {
  res.json({ prefs: DEFAULT_PREFS });
});

router.get('/api/prefs', (req: Request, res: Response) => {
  const hostKey = keyFrom(req);
  const prefs = getOrDefault(hostKey);
  res.json({ host: hostKey, prefs });
});

router.post('/api/prefs/save', (req: Request, res: Response) => {
  try {
    const hostKey = keyFrom(req);
    const incoming: PrefsInput = (req.body?.prefs || {}) as PrefsInput;

    // Normalize + stamp
    const normalized = normalizePrefs(incoming);
    const next: Prefs = {
      ...getOrDefault(hostKey),
      ...normalized,
      host: hostKey,
      updatedAt: new Date().toISOString(),
    };

    MEM[hostKey] = next;
    safeSaveToDisk();

    res.json({ ok: true, host: hostKey, prefs: next });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post('/api/prefs/reset', (req: Request, res: Response) => {
  const hostKey = keyFrom(req);
  const next: Prefs = {
    ...DEFAULT_PREFS,
    host: hostKey,
    updatedAt: new Date().toISOString(),
  };
  MEM[hostKey] = next;
  safeSaveToDisk();
  res.json({ ok: true, host: hostKey, prefs: next });
});

export default router;