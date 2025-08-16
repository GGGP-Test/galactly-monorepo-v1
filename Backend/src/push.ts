import webpush from 'web-push';
import { db } from './db.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'http://localhost:8787';

export function initPush(){
  webpush.setVapidDetails(`${SITE_ORIGIN}/contact`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export function saveSubscription(userId: string, sub: any){
  const { endpoint, keys } = sub;
  db.prepare(`INSERT OR IGNORE INTO push_subs(user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?)`)
    .run(userId, endpoint, keys.p256dh, keys.auth, Date.now());
}

export async function pushToUser(userId: string, payload: object){
  const rows = db.prepare(`SELECT endpoint,p256dh,auth FROM push_subs WHERE user_id=?`).all(userId);
  for(const r of rows){
    try{
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } } as any,
        JSON.stringify(payload), { TTL: 60 });
    }catch(e){ /* ignore stale subs */ }
  }
}
