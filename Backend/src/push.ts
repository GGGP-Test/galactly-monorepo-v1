import webpush from 'web-push';
import { db } from '../db.js'; // <<< fixed: normal import

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://galactly-api-docker.onrender.com';

export function initPush() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] Disabled: missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
    return;
  }
  try {
    webpush.setVapidDetails(`${SITE_ORIGIN}/contact`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('[push] Web Push enabled');
  } catch (e) {
    console.error('[push] Failed to init, continuing without push:', e);
  }
}

export function saveSubscription(userId: string, sub: any) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const { endpoint, keys } = sub || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return;
  db.prepare(
    `INSERT OR IGNORE INTO push_subs(user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?)`
  ).run(userId, endpoint, keys.p256dh, keys.auth, Date.now());
}

type SubRow = { endpoint: string; p256dh: string; auth: string };

export async function pushToUser(userId: string, payload: object) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const rows = db
    .prepare(`SELECT endpoint,p256dh,auth FROM push_subs WHERE user_id=?`)
    .all(userId) as SubRow[];

  for (const r of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } } as any,
        JSON.stringify(payload),
        { TTL: 60 }
      );
    } catch {
      // ignore stale/invalid subscriptions
    }
  }
}
