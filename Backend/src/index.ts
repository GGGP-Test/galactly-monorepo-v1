/* Minimal HTTP server (no external deps).
 * Ports:
 *   - Default: 8787 (matches your Northflank health check)
 * Routes:
 *   - GET  /healthz                      -> "ok"
 *   - POST /api/v1/leads                 -> JSON { candidates: Candidate[] }
 *   - GET  /api/v1/leads?supplier=...    -> same as POST (debug/manual)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import crawlBuyers, { type Persona } from './crawl';

const PORT = Number(process.env.PORT || 8787);

// ---- utils ----

function sendJson(res: ServerResponse, code: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

function sendText(res: ServerResponse, code: number, text: string) {
  res.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*'
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        // 1 MB guard
        req.destroy();
        reject(new Error('payload_too_large'));
      }
    });
    req.on('end', () => resolve(data || ''));
    req.on('error', reject);
  });
}

function safeParse<T = any>(s: string): T | null {
  try {
    return s ? (JSON.parse(s) as T) : (null as any);
  } catch {
    return null;
  }
}

function log(...args: any[]) {
  // light logging; avoid noisy stack traces
  try {
    console.log(new Date().toISOString(), ...args);
  } catch {
    /* noop */
  }
}

// ---- router ----

async function handleLeadsGET(req: IncomingMessage, res: ServerResponse) {
  const url = parseUrl(req.url || '', true);
  const supplierRaw = (url.query.supplier || url.query.host || url.query.domain || '') as string;
  const supplierHost = (supplierRaw || '').toString().trim();
  const country = ((url.query.country || url.query.gl || 'US') as string).toUpperCase() as 'US' | 'CA';
  const radiusMi = Number(url.query.radiusMi || url.query.radius || 50);

  if (!supplierHost) {
    return sendJson(res, 400, { error: 'missing_supplier', message: 'Provide ?supplier=example.com' });
  }

  return leadWorkflow({ supplierHost, country, radiusMi, res });
}

async function handleLeadsPOST(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  const body = safeParse<{
    supplier?: string;
    supplierHost?: string;
    host?: string;
    domain?: string;
    country?: 'US' | 'CA' | string;
    radiusMi?: number | string;
    persona?: Persona;
  }>(raw);

  const supplierHost =
    (body?.supplierHost ||
      body?.supplier ||
      body?.host ||
      body?.domain ||
      '').toString().trim();

  const country = ((body?.country || 'US') as string).toUpperCase() as 'US' | 'CA';
  const radiusMi = Number(body?.radiusMi ?? 50);
  const persona = body?.persona;

  if (!supplierHost) {
    return sendJson(res, 400, { error: 'missing_supplier', message: 'Body must include supplierHost' });
  }

  return leadWorkflow({ supplierHost, country, radiusMi, persona, res });
}

async function leadWorkflow(params: {
  supplierHost: string;
  country: 'US' | 'CA';
  radiusMi: number;
  persona?: Persona;
  res: ServerResponse;
}) {
  const { supplierHost, country, radiusMi, persona, res } = params;

  // Hard timeout guard so requests never hang
  const TIMEOUT_MS = Number(process.env.LEADS_TIMEOUT_MS || 28_000);

  const work = crawlBuyers({ supplierHost, country, radiusMi, persona })
    .then((candidates) => ({ ok: true, candidates }))
    .catch((err) => {
      log('crawl_error', { supplierHost, country, radiusMi, err: String(err?.message || err) });
      return { ok: false, candidates: [] as any[], error: 'crawl_failed' };
    });

  const timeout = new Promise<{ ok: false; candidates: any[]; error: string }>((resolve) =>
    setTimeout(() => resolve({ ok: false, candidates: [], error: 'timeout' }), TIMEOUT_MS)
  );

  const result = await Promise.race([work, timeout]);

  // Always 200 so the UI can display "0 candidates" gracefully
  return sendJson(res, 200, {
    supplierHost,
    country,
    radiusMi,
    count: (result as any).candidates?.length ?? 0,
    ...result
  });
}

// ---- server ----

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization, x-token',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-max-age': '600'
    });
    return res.end();
  }

  const url = parseUrl(req.url || '', true);
  const path = (url.pathname || '').replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && path === '/healthz') {
    return sendText(res, 200, 'ok');
  }

  if (path === '/api/v1/leads') {
    if (req.method === 'GET') return handleLeadsGET(req, res);
    if (req.method === 'POST') return handleLeadsPOST(req, res);
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  return sendJson(res, 404, { error: 'not_found', path });
});

server.listen(PORT, () => {
  log(`server_listening`, { port: PORT, health: '/healthz', leads: '/api/v1/leads' });
});

// Export for tests (optional)
export default server;
