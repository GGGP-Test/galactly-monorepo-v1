// src/routes/ingest.ts
import { Router, Request, Response } from 'express';
import { saveByHost } from '../shared/memStore';

const r = Router();

/** ---------- helpers ---------- */
function hostFrom(urlLike?: string): string | undefined {
  if (!urlLike) return;
  try {
    const u = urlLike.includes('://') ? new URL(urlLike) : new URL(`https://${urlLike}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return; }
}
function domainFromText(txt?: string): string | undefined {
  if (!txt) return;
  const m = txt.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  if (!m) return;
  const h = m[1].toLowerCase();
  if (h.endsWith('github.com')) return;
  return h;
}
function nowISO() { return new Date().toISOString(); }

/** ---------- POST /api/ingest/github ----------
 * Accepts either a single item or {items:[...]}.
 * Each item: { homepage, owner, name, description, topics, temp }
 * Saves into warm bucket so /leads/warm shows them immediately.
 */
r.post(['/ingest/github', '/leads/ingest/github'], async (req: Request, res: Response) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : Array.isArray(req.body) ? req.body : [req.body];

  const saved = [];
  for (const it of rawItems) {
    const hp = String(it?.homepage || '').trim();
    let host = hostFrom(hp) || domainFromText(String(it?.description || '')) || (it?.owner ? `${String(it.owner).toLowerCase()}.github.io` : '');
    if (!host) continue;

    const title = it?.title
      || (it?.name ? `Repo ${it.name} — possible buyer @ ${host}` : `Possible buyer @ ${host}`);

    const why = it?.whyText || '(from GitHub live sweep)';
    const created = nowISO();

    const rec = saveByHost(host, {
      title,
      platform: 'web',
      created,
      temperature: (it?.temp === 'hot' ? 'hot' : 'warm'),
      why,
      saved: true,
    });
    saved.push({
      host: rec.host,
      platform: rec.platform || 'web',
      title: rec.title,
      created: rec.created,
      temp: rec.temperature,
      whyText: rec.why || '',
    });
  }

  return res.json({ ok: true, saved: saved.length, items: saved });
});

/** ---------- POST /api/leads/deepen ----------
 * Live sweep of Zie619 → normalize → save to warm → return count.
 * Uses GH_PAT_PUBLIC if present to increase rate limit.
 */
r.post(['/leads/deepen', '/deepen'], async (_req: Request, res: Response) => {
  const token = process.env.GH_PAT_PUBLIC || '';
  const headers: Record<string,string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'buyers-api',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // 1) fetch repos
  const url = 'https://api.github.com/users/zie619/repos?per_page=100&sort=updated';
  const r1 = await fetch(url, { headers } as any);
  if (!r1.ok) return res.status(502).json({ ok: false, error: `github ${r1.status}` });
  const repos = await r1.json();

  // 2) normalize + persist
  let saved = 0;
  for (const r of repos) {
    const homepage = r?.homepage || '';
    const desc = r?.description || '';
    const owner = r?.owner?.login || 'zie619';
    const name = r?.name || '';

    const host = hostFrom(homepage) || domainFromText(desc) || `${owner.toLowerCase()}.github.io`;
    if (!host) continue;

    const title = `Repo ${name} — possible buyer @ ${host}`;
    saveByHost(host, {
      title,
      platform: 'web',
      created: nowISO(),
      temperature: 'warm',
      why: '(from GitHub live sweep)',
      saved: true,
    });
    saved++;
  }

  return res.json({ ok: true, saved });
});

export default r;