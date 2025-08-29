// Backend/scripts/update-weights.ts
// Recomputes platform weights from last 7 days and updates model_state('global')

import { pool, q } from '../src/db';

function norm(x: number, min: number, max: number, fallback = 0.5) {
  if (!Number.isFinite(x)) return fallback;
  if (max <= min) return fallback;
  const v = (x - min) / (max - min);
  return Math.max(0, Math.min(1, v));
}

async function main() {
  // Per-platform conversion (own / total) over the last 7 days
  const rows = (await q<any>(`
    WITH recent AS (
      SELECT l.id, COALESCE(l.platform,'') AS platform
      FROM lead_pool l
      WHERE l.created_at > now() - interval '7 days'
    ),
    outcome AS (
      SELECT e.lead_id, COUNT(*) AS owns
      FROM event_log e
      WHERE e.event_type = 'own'
        AND e.created_at > now() - interval '7 days'
      GROUP BY e.lead_id
    )
    SELECT r.platform, COUNT(*)::int AS n, COALESCE(SUM(o.owns),0)::int AS wins
    FROM recent r
    LEFT JOIN outcome o ON o.lead_id = r.id
    GROUP BY r.platform
  `)).rows as Array<{ platform: string; n: number; wins: number }>;

  let minR = Infinity, maxR = -Infinity;
  const rates: Record<string, number> = {};

  for (const r of rows) {
    const p = (r.platform || '').toLowerCase();
    const rate = (Number(r.wins) || 0) / Math.max(1, Number(r.n) || 0);
    rates[p] = rate;
    if (rate < minR) minR = rate;
    if (rate > maxR) maxR = rate;
  }

  const platforms: Record<string, number> = {};
  for (const [k, v] of Object.entries(rates)) {
    platforms[k] = norm(v, minR, maxR, 0.5);
  }

  // Base coeffs (feel free to tweak)
  const weights = {
    coeffs: { recency: 0.5, platform: 0.9, domain: 0.4, intent: 0.6, histCtr: 0.3, userFit: 1.0 },
    platforms,
    badDomains: [] as string[],
  };

  await q(
    `INSERT INTO model_state(segment, weights)
       VALUES ('global', $1::jsonb)
     ON CONFLICT (segment)
       DO UPDATE SET weights = EXCLUDED.weights, updated_at = now()`,
    [weights]
  );

  console.log('Updated weights:', JSON.stringify(weights, null, 2));
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error('[weights] error', e);
    pool.end();
    process.exit(1);
  });
