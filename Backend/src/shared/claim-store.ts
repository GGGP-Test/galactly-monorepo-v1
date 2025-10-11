// src/shared/claim-store.ts
//
// Persistent store for Claim/Hide.
// - Uses Postgres when DATABASE_URL + pg are available.
// - Falls back to in-memory Map (survives until process restarts).
//
// Exposes: getStatus, own, hide, unhide.
// own() returns {rec, conflictOwner?} so caller can 409 if needed.

export type ClaimRecord = {
  host: string;
  owner?: string | null;
  ownedAt?: number | null;
  hiddenBy?: string | null;
  hiddenAt?: number | null;
};

function normHost(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/* ---------------- PG wiring (lazy) ---------------- */

let usePg = false;
let pool: any = null;

async function ensurePg() {
  if (usePg) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pg = require("pg");
    const url = String(process.env.DATABASE_URL || "");
    if (!pg || !url) return;

    pool = new pg.Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 5),
    });

    // Create table if missing
    const ddl = `
      CREATE TABLE IF NOT EXISTS claims (
        host       TEXT PRIMARY KEY,
        owner      TEXT,
        owned_at   BIGINT,
        hidden_by  TEXT,
        hidden_at  BIGINT
      );
    `;
    await pool.query(ddl);
    usePg = true;
  } catch {
    usePg = false; // stay in memory
  }
}

/* --------------- in-memory fallback --------------- */

const MEM = new Map<string, ClaimRecord>();

function memGet(host: string): ClaimRecord | null {
  const rec = MEM.get(host);
  return rec ? { ...rec } : null;
}
function memUpsert(rec: ClaimRecord) {
  MEM.set(rec.host, { ...rec });
}

/* ------------------ API surface ------------------- */

export async function getStatus(hostRaw: unknown): Promise<ClaimRecord | null> {
  const host = normHost(hostRaw);
  if (!host) return null;

  await ensurePg();
  if (!usePg) return memGet(host);

  const q = `SELECT host, owner, owned_at AS "ownedAt", hidden_by AS "hiddenBy", hidden_at AS "hiddenAt"
             FROM claims WHERE host = $1`;
  const r = await pool.query(q, [host]);
  if (!r.rows?.length) return null;
  return r.rows[0] as ClaimRecord;
}

/** Claim ownership. If someone else owns it, returns conflictOwner. */
export async function own(hostRaw: unknown, email: string): Promise<{ rec: ClaimRecord; conflictOwner?: string }> {
  const host = normHost(hostRaw);
  const now = Date.now();
  if (!host || !email) return { rec: { host } };

  await ensurePg();

  if (!usePg) {
    const cur = memGet(host) || { host };
    if (cur.owner && cur.owner !== email) {
      return { rec: cur, conflictOwner: cur.owner };
    }
    const rec: ClaimRecord = { host, owner: email, ownedAt: now, hiddenBy: cur.hiddenBy, hiddenAt: cur.hiddenAt };
    memUpsert(rec);
    return { rec };
  }

  // PG path: check conflict, then upsert
  const cur = await getStatus(host);
  if (cur?.owner && cur.owner !== email) {
    return { rec: cur, conflictOwner: cur.owner };
  }

  const up = `
    INSERT INTO claims(host, owner, owned_at, hidden_by, hidden_at)
    VALUES ($1, $2, $3, COALESCE((SELECT hidden_by FROM claims WHERE host=$1), NULL),
                   COALESCE((SELECT hidden_at FROM claims WHERE host=$1), NULL))
    ON CONFLICT (host) DO UPDATE
    SET owner=$2, owned_at=$3
    RETURNING host, owner, owned_at AS "ownedAt", hidden_by AS "hiddenBy", hidden_at AS "hiddenAt";
  `;
  const r = await pool.query(up, [host, email, now]);
  return { rec: r.rows[0] as ClaimRecord };
}

export async function hide(hostRaw: unknown, email: string): Promise<ClaimRecord | null> {
  const host = normHost(hostRaw);
  const now = Date.now();
  if (!host || !email) return null;

  await ensurePg();

  if (!usePg) {
    const cur = memGet(host) || { host };
    const rec: ClaimRecord = { ...cur, host, hiddenBy: email, hiddenAt: now };
    memUpsert(rec);
    return rec;
  }

  const up = `
    INSERT INTO claims(host, hidden_by, hidden_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (host) DO UPDATE
    SET hidden_by=$2, hidden_at=$3
    RETURNING host, owner, owned_at AS "ownedAt", hidden_by AS "hiddenBy", hidden_at AS "hiddenAt";
  `;
  const r = await pool.query(up, [host, email, now]);
  return r.rows[0] as ClaimRecord;
}

export async function unhide(hostRaw: unknown): Promise<ClaimRecord | null> {
  const host = normHost(hostRaw);
  if (!host) return null;

  await ensurePg();

  if (!usePg) {
    const cur = memGet(host) || { host };
    const rec: ClaimRecord = { ...cur, hiddenBy: null, hiddenAt: null };
    memUpsert(rec);
    return rec;
  }

  const up = `
    INSERT INTO claims(host, hidden_by, hidden_at)
    VALUES ($1, NULL, NULL)
    ON CONFLICT (host) DO UPDATE
    SET hidden_by=NULL, hidden_at=NULL
    RETURNING host, owner, owned_at AS "ownedAt", hidden_by AS "hiddenBy", hidden_at AS "hiddenAt";
  `;
  const r = await pool.query(up, [host]);
  return r.rows[0] as ClaimRecord;
}