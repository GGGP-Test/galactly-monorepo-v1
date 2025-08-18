// File: src/connectors/imapWatcher.ts
// Purpose: Watch a mailbox for social notification emails (LinkedIn/IG/Facebook/YouTube/etc.)
// and push normalized signals into /api/v1/ingest using INGEST_SECRET HMAC.
// No scraping. Users explicitly receive these notifications and opt-in to forward them.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import crypto from 'crypto';
import fetch from 'node-fetch';

// ===== Config via Environment Variables =====
// IMAP_HOST=imap.gmail.com
// IMAP_PORT=993
// IMAP_SECURE=true
// IMAP_USER=your_inbox@example.com
// IMAP_PASS=your_app_password
// IMAP_BOX=INBOX
// IMAP_FROM_FILTER=linkedin.com,facebookmail.com,mail.instagram.com,notify.linkedin.com
// IMAP_KEYWORDS=packaging,labels,corrugated,pouch,rfq,quote,procurement,buyer,sourcing
// INGEST_URL=https://YOUR-RENDER-URL/api/v1/ingest
// INGEST_SECRET=hex_hmac_secret

const HOST  = process.env.IMAP_HOST || '';
const PORT  = Number(process.env.IMAP_PORT || 993);
const SECURE= String(process.env.IMAP_SECURE||'true') !== 'false';
const USER  = process.env.IMAP_USER || '';
const PASS  = process.env.IMAP_PASS || '';
const BOX   = process.env.IMAP_BOX  || 'INBOX';

const FROM_FILTER = (process.env.IMAP_FROM_FILTER||'linkedin.com,facebookmail.com,mail.instagram.com,notify.linkedin.com')
.split(',').map(s=>s.trim()).filter(Boolean);
const KEYWORDS = (process.env.IMAP_KEYWORDS||'packaging,boxes,labels,pouch,pouches,corrugated,mailer,crate,pallet,rfq,quote,procurement,buyer,sourcing')
.split(',').map(s=>s.trim()).filter(Boolean);

const baseOrigin = (()=>{
const v = process.env.SITE_ORIGIN || 'http://localhost:8787';
return v.endsWith('/') ? v.slice(0,-1) : v;
})();
const INGEST_URL   = process.env.INGEST_URL || (baseOrigin + '/api/v1/ingest');
const INGEST_SECRET= process.env.INGEST_SECRET || '';

function hmac(body: any){
const b = JSON.stringify(body);
return crypto.createHmac('sha256', INGEST_SECRET).update(b).digest('hex');
}

function platformFromAddr(addr: string){
const a = (addr||'').toLowerCase();
if(a.includes('linkedin'))  return 'LinkedIn';
if(a.includes('instagram')) return 'Instagram';
if(a.includes('facebook'))  return 'Facebook';
if(a.includes('youtube')||a.includes('google')) return 'YouTube';
return 'Email';
}

async function processUid(client: ImapFlow, uid: number){
const msg = await client.fetchOne(uid, { source: true, envelope: true });
if(!msg?.source) return;
const parsed = await simpleParser(msg.source as any);
const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase();
const subject  = (parsed.subject || '').toString();
const plainTxt = (parsed.text || '').toString();
const htmlTxt  = (parsed.html  || '').toString();
const text = plainTxt || htmlTxt;

// Gates: sender domain AND/OR keyword hit
const senderOk = FROM_FILTER.some(dom => fromAddr.includes(dom));
const textLower = (subject + ' ' + text).toLowerCase();
const textOk   = KEYWORDS.some(k => textLower.includes(k));
if(!senderOk && !textOk) return; // Ignore non-signal mail

const platform = platformFromAddr(fromAddr);
const raw = subject + ' ' + text;
const snippet = raw.split(' ').filter(Boolean).join(' ').slice(0, 300);

const body = {
platform,
source_url: '', // email notifications rarely have reliable public URLs; users can click through from UI
evidence_snippet: snippet,
ttlHours: 72,
text: raw
};
const sig = hmac(body);

try{
const r = await fetch(INGEST_URL, {
method:'POST',
headers:{ 'content-type':'application/json', 'x-ingest-signature': sig },
body: JSON.stringify(body)
});
if(!r.ok) throw new Error('ingest failed '+r.status);
}catch(e){
// Log to console; continue without crashing the watcher
console.warn('[imapWatcher] ingest error', (e as any)?.message || e);
}
}

async function initialSweep(client: ImapFlow){
// Unseen messages from last 3 days
const since = new Date(Date.now() - 3243600*1000);
const lock = await client.getMailboxLock(BOX);
try{
const uids = await client.search({ seen: false, since });
// Process up to last 50 to avoid bursts
for(const uid of uids.slice(-50)){
await processUid(client, uid);
}
} finally { lock.release(); }
}

export async function startImapWatcher(){
if(!HOST || !USER || !PASS || !INGEST_SECRET){
console.warn('[imapWatcher] Missing IMAP_HOST/USER/PASS or INGEST_SECRET — watcher disabled.');
return;
}
const client = new ImapFlow({ host: HOST, port: PORT, secure: SECURE, auth: { user: USER, pass: PASS } });
client.on('error', err => console.warn('[imapWatcher]', (err as any)?.message || err));
await client.connect();
await client.mailboxOpen(BOX);
console.log('[imapWatcher] connected to', HOST, 'box', BOX);

await initialSweep(client);

// Realtime: when EXISTS increases, process the latest UID
client.on('exists', async ()=>{
try{
const lock = await client.getMailboxLock(BOX);
try{
const uid = client.mailbox?.exists || 0;
if(uid) await processUid(client, uid);
} finally { lock.release(); }
}catch(e){ console.warn('[imapWatcher] exists handler error', (e as any)?.message || e); }
});
}

