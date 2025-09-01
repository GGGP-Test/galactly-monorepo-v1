// Backend/src/session.ts
import { q } from './db';

// ---------- Types ----------
export type Onboarding = {
  vendorDomain?: string | null;
  industries?: string[];
  regions?: string[];
  buyers?: string[];
  notes?: string | null;         // free-form guidance for "Customize your AI"
};

export type ConfirmedProof = {
  host: string;
  platform: string;
  url?: string;
  ts: string;                    // ISO time
};

export type SessionCounters = {
  revealsToday: number;          // free reveals spent today
  lastReset: string;             // ISO (UTC midnight boundary of last reset)
  aiTicks: number;               // how many preview ticks the user has run (for UI)
};

export type Cooldown = {
  until: number;                 // Date.now() millis; 0 = none
};

export type Fairplay = {
  score: number;                 // higher = more friction
  lastDecayAt: number;           // millis; decay over time
};

export type UserPrefs = {
  muteDomains?: string[];
  confirmedProofs?: ConfirmedProof[];
  preferredCats?: string[];
  boostKeywords?: string[];
  // we store the live session state *inside* user_prefs.session
  session?: PersistedSession;
};

export type PersistedSession = {
  onboarding: Onboarding;
  counters: SessionCounters;
  cooldown: Cooldown;
  fairplay: Fairplay;
};

export type Session = {
  userId: string;
  onboarding: Onboarding;
  counters: SessionCounters;
  cooldown: Cooldown;
  fairplay: Fairplay;
  loadedAt: number;
  touchedAt: number;
};

// ---------- Config (env-tunable) ----------
const FREE_REVEALS_PER_DAY = num(process.env.FREE_REVEALS_PER_DAY, 2);  // free plan daily reveals
const FREE_COOLDOWN_SEC    = num(process.env.FREE_COOLDOWN_SEC, 20);    // cooldown between reveals
const FAIRPLAY_DECAY_MIN   = num(process.env.FAIRPLAY_DECAY_MIN, 10);   // decay window (minutes)
const FAIRPLAY_DECAY_PER   = num(process.env.FAIRPLAY_DECAY_PER, 1);    // points decayed per window
const FAIRPLAY_MAX         = num(process.env.FAIRPLAY_MAX, 100);
const FAIRPLAY_MIN         = 0;

// ---------- In-memory cache ----------
const cache = new Map<string, Session>();
const TTL_MS = 10 * 60 * 1000; // re-load from DB if older than 10 minutes

// ---------- Helpers ----------
function num(v: any, dflt: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function todayKeyUTC(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function emptySession(userId: string): Session {
  return {
    userId,
    onboarding: { vendorDomain: null, industries: [], regions: [], buyers: [], notes: null },
    counters: { revealsToday: 0, lastReset: todayKeyUTC(), aiTicks: 0 },
    cooldown: { until: 0 },
    fairplay: { score: 0, lastDecayAt: Date.now() },
    loadedAt: Date.now(),
    touchedAt: Date.now()
  };
}

function needsReload(s: Session) {
  return (Date.now() - s.loadedAt) > TTL_MS;
}

function decayFairplay(f: Fairplay) {
  const now = Date.now();
  if (f.score <= FAIRPLAY_MIN) { f.lastDecayAt = now; return; }
  const elapsedMin = (now - f.lastDecayAt) / 60000;
  if (elapsedMin >= FAIRPLAY_DECAY_MIN) {
    const steps = Math.floor(elapsedMin / FAIRPLAY_DECAY_MIN);
    f.score = Math.max(FAIRPLAY_MIN, f.score - steps * FAIRPLAY_DECAY_PER);
    f.lastDecayAt = now;
  }
}

function resetDailyIfNeeded(c: SessionCounters) {
  const key = todayKeyUTC();
  if (c.lastReset !== key) {
    c.revealsToday = 0;
    c.aiTicks = 0;
    c.lastReset = key;
  }
}

function sanitizeOnboarding(input: Partial<Onboarding>): Onboarding {
  const toStrArr = (v: any) =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) :
    typeof v === 'string' ? String(v).split(',').map(s=>s.trim()).filter(Boolean) : [];
  return {
    vendorDomain: input.vendorDomain ? String(input.vendorDomain).trim() : null,
    industries: toStrArr(input.industries),
    regions: toStrArr(input.regions),
    buyers: toStrArr(input.buyers),
    notes: input.notes ? String(input.notes) : null
  };
}

// ---------- DB I/O ----------
async function ensureUser(userId: string) {
  await q(
    `INSERT INTO app_user(id, region, email, alerts, user_prefs)
     VALUES ($1, NULL, NULL, false, '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [userId]
  );
}

async function loadPrefs(userId: string): Promise<UserPrefs> {
  const r = await q<{ user_prefs: any }>(`SELECT user_prefs FROM app_user WHERE id=$1`, [userId]);
  const prefs = (r.rows[0]?.user_prefs ?? {}) as UserPrefs;
  // guard types
  if (!prefs.confirmedProofs) prefs.confirmedProofs = [];
  return prefs;
}

async function savePrefs(userId: string, prefs: UserPrefs) {
  await q(`UPDATE app_user SET user_prefs=$2, updated_at=now() WHERE id=$1`, [userId, prefs]);
}

function toPersistable(sess: Session): PersistedSession {
  return {
    onboarding: sess.onboarding,
    counters: sess.counters,
    cooldown: sess.cooldown,
    fairplay: sess.fairplay
  };
}

// ---------- Public API ----------
export async function getSession(userId: string): Promise<Session> {
  if (!userId) throw new Error('missing userId');
  const cached = cache.get(userId);
  if (cached && !needsReload(cached)) {
    // maintain decay/reset on each read
    resetDailyIfNeeded(cached.counters);
    decayFairplay(cached.fairplay);
    cached.touchedAt = Date.now();
    return cached;
  }

  await ensureUser(userId);
  const prefs = await loadPrefs(userId);
  const s = emptySession(userId);

  if (prefs.session) {
    const ps = prefs.session;
    // restore persisted
    s.onboarding = {
      vendorDomain: ps.onboarding?.vendorDomain ?? null,
      industries: ps.onboarding?.industries ?? [],
      regions: ps.onboarding?.regions ?? [],
      buyers: ps.onboarding?.buyers ?? [],
      notes: ps.onboarding?.notes ?? null
    };
    s.counters = {
      revealsToday: Number(ps.counters?.revealsToday ?? 0),
      lastReset: ps.counters?.lastReset || todayKeyUTC(),
      aiTicks: Number(ps.counters?.aiTicks ?? 0)
    };
    s.cooldown = { until: Number(ps.cooldown?.until ?? 0) };
    s.fairplay = {
      score: Math.max(FAIRPLAY_MIN, Math.min(FAIRPLAY_MAX, Number(ps.fairplay?.score ?? 0))),
      lastDecayAt: Number(ps.fairplay?.lastDecayAt ?? Date.now())
    };
  }

  resetDailyIfNeeded(s.counters);
  decayFairplay(s.fairplay);
  s.loadedAt = Date.now();
  s.touchedAt = Date.now();
  cache.set(userId, s);
  return s;
}

export async function saveSession(userId: string, sess: Session): Promise<void> {
  const prefs = await loadPrefs(userId);
  prefs.session = toPersistable(sess);
  await savePrefs(userId, prefs);
  cache.set(userId, { ...sess, loadedAt: Date.now(), touchedAt: Date.now() });
}

export async function applyOnboarding(userId: string, patch: Partial<Onboarding>): Promise<Session> {
  const s = await getSession(userId);
  const next = sanitizeOnboarding(patch);

  // Merge (array unions by value)
  const union = (a: string[], b: string[]) => Array.from(new Set([...(a || []), ...(b || [])]));
  s.onboarding.vendorDomain = next.vendorDomain ?? s.onboarding.vendorDomain ?? null;
  s.onboarding.industries   = union(s.onboarding.industries || [], next.industries || []);
  s.onboarding.regions      = union(s.onboarding.regions || [], next.regions || []);
  s.onboarding.buyers       = union(s.onboarding.buyers || [], next.buyers || []);
  s.onboarding.notes        = (next.notes ?? s.onboarding.notes) ?? null;

  // Nudge fairplay down a hair for giving signal (reward)
  s.fairplay.score = Math.max(FAIRPLAY_MIN, s.fairplay.score - 1);
  s.touchedAt = Date.now();

  await saveSession(userId, s);
  return s;
}

/**
 * Spend one reveal if allowed. Applies cooldown + increments counters.
 * Returns: allowed, remaining (today), cooldownSec, reason
 */
export async function useReveal(userId: string): Promise<{ allowed: boolean; remaining: number; cooldownSec: number; reason?: string; }> {
  const s = await getSession(userId);
  const now = Date.now();

  // cooldown check
  if (s.cooldown.until && now < s.cooldown.until) {
    const left = Math.ceil((s.cooldown.until - now) / 1000);
    return { allowed: false, remaining: Math.max(0, FREE_REVEALS_PER_DAY - s.counters.revealsToday), cooldownSec: left, reason: 'cooldown' };
  }

  // daily cap
  if (s.counters.revealsToday >= FREE_REVEALS_PER_DAY) {
    // bump fairplay if they keep trying
    s.fairplay.score = Math.min(FAIRPLAY_MAX, s.fairplay.score + 2);
    await saveSession(userId, s);
    return { allowed: false, remaining: 0, cooldownSec: 0, reason: 'daily_cap' };
  }

  // spend + set cooldown
  s.counters.revealsToday += 1;
  s.cooldown.until = now + FREE_COOLDOWN_SEC * 1000;
  // light fairplay nudge
  s.fairplay.score = Math.min(FAIRPLAY_MAX, s.fairplay.score + 1);
  await saveSession(userId, s);

  return {
    allowed: true,
    remaining: Math.max(0, FREE_REVEALS_PER_DAY - s.counters.revealsToday),
    cooldownSec: FREE_COOLDOWN_SEC
  };
}

/**
 * Log one “tick” of the metrics preview (for the slow, teach-the-user run).
 * This lets the UI show progress bars and also lets you gate how many ticks free users can see.
 */
export async function recordPreviewTick(userId: string, delta = 1): Promise<Session> {
  const s = await getSession(userId);
  s.counters.aiTicks = Math.max(0, (s.counters.aiTicks || 0) + delta);
  // decay fairplay slightly as they engage with the product
  s.fairplay.score = Math.max(FAIRPLAY_MIN, s.fairplay.score - 0.25);
  await saveSession(userId, s);
  return s;
}

/**
 * Per-user proof confirmation (e.g., they clicked “open proof” and verified).
 * We store confirmed proofs and do *not* globally increase heat; this is user-specific signal.
 */
export async function recordProofConfirmation(userId: string, domainOrUrl: string, platform = 'adlib_free', url?: string) {
  await ensureUser(userId);
  const prefs = await loadPrefs(userId);
  const host = safeHost(domainOrUrl);
  if (!host) return;

  const list = Array.isArray(prefs.confirmedProofs) ? prefs.confirmedProofs : [];
  // de-dupe by host+platform
  const exists = list.some(p => p.host === host && p.platform === platform);
  if (!exists) {
    list.push({ host, platform, url, ts: new Date().toISOString() });
    prefs.confirmedProofs = list;
    await savePrefs(userId, prefs);
  }

  // Soft “fit_user” bump can occur at ranking-time using prefs.confirmedProofs; we keep that logic in scoring/handlers.
}

/**
 * Increase/decrease fair-play score manually (e.g., repeated spammy actions).
 */
export async function bumpFairplay(userId: string, delta: number, floor = FAIRPLAY_MIN, ceil = FAIRPLAY_MAX): Promise<Session> {
  const s = await getSession(userId);
  s.fairplay.score = clamp(s.fairplay.score + delta, floor, ceil);
  await saveSession(userId, s);
  return s;
}

// Read-only snapshot (if present in cache)
export function sessionSnapshot(userId: string): Session | null {
  const s = cache.get(userId);
  if (!s) return null;
  resetDailyIfNeeded(s.counters);
  decayFairplay(s.fairplay);
  return { ...s };
}

export function freeCaps() {
  return {
    FREE_REVEALS_PER_DAY,
    FREE_COOLDOWN_SEC,
    FAIRPLAY_DECAY_MIN,
    FAIRPLAY_DECAY_PER,
    FAIRPLAY_MAX
  };
}

// Deep-link helper: parse onboarding from query (hero → free panel)
export function parseOnboardingFromQuery(q: Record<string, any>): Onboarding {
  return sanitizeOnboarding({
    vendorDomain: q.vendor || q.vendorDomain || undefined,
    industries: q.industries || q.industry || undefined,
    regions: q.regions || q.region || undefined,
    buyers: q.buyers || q.buyer || undefined,
    notes: q.notes || undefined
  });
}

// ---------- internals ----------
function safeHost(s?: string): string | null {
  if (!s) return null;
  try {
    if (/^https?:\/\//i.test(s)) return new URL(s).hostname.toLowerCase();
    // treat as hostname as-is
    return String(s).trim().toLowerCase().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
