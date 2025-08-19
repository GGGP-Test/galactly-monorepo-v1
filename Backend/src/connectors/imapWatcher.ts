// File: src/connectors/imapWatcher.ts
// Purpose: Watch a mailbox (Gmail/IMAP) for social + Google Alerts emails and
//          push normalized signals into /api/v1/ingest using HMAC (INGEST_SECRET).
// Notes:   No scraping. Users explicitly receive/forward these emails.
//          Supports optional Gmail RAW search (e.g., category:social, from:googlealerts...).

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import crypto from 'crypto';
import fetch from 'node-fetch';

// ===== Required ENV =====
// IMAP_HOST=imap.gmail.com
// IMAP_PORT=993
// IMAP_SECURE=true
// IMAP_USER=your_inbox@example.com
// IMAP_PASS=your_app_password
// IMAP_BOX=[Gmail]/All Mail    // recommended so Social/Promotions are included
// INGEST_URL=https://YOUR-RENDER-URL/api/v1/ingest
// INGEST_SECRET=<hex secret>
//
// ===== Optional ENV =====
// IMAP_FROM_FILTER=linkedin.com,facebookmail.com,mail.instagram.com,notify.linkedin.com,googlealerts-noreply@google.com
// IMAP_KEYWORDS=packaging,labels,corrugated,pouch,rfq,quote,procurement,buyer,sourcing
// GMAIL_RAW=category:social newer_than:3d  // uses Gmail IMAP extension when available

const HOST  = process.env.IMAP_HOST || '';
const PORT  = Number(process.env.IMAP_PORT || 993);
const SECURE= String(process.env.IMAP_SECURE||'true') !== 'false';
const USER  = process.env.IMAP_USER || '';
const PASS  = process.env.IMAP_PASS || '';
const BOX   = process.env.IMAP_BOX  || '[Gmail]/All Mail';

const FROM_FILTER = (process.env.IMAP_FROM_FILTER||'linkedin.com,facebookmail.com,mail.instagram.com,notify.linkedin.com,googlealerts-noreply@google.com')
  .split(',').map(s=>s.trim()).filter(Boolean);
const KEYWORDS = (process.env.IMAP_KEYWORDS||'packaging,boxes,labels,pouch,pouches,corrugated,mailer,crate,pallet,rfq,quote,procurement,buyer,sourcing')
  .split(',').map(s=>s.trim()).filter(Boolean);
const GMAIL_RAW = process.env.GMAIL_RAW || '';

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
  if(a.includes('youtube')||a.includes('google')) return 'YouTube/Google';
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
  const text = (plainTxt || htmlTxt || '').replace(/\s+/g,' ').trim();

  // Gates: sender domain AND/OR keyword hit
  const senderOk = FROM_FILTER.some(dom => fromAddr.includes(dom));
  const textLower = (subject + ' ' + text).toLowerCase();
  const textOk   = KEYWORDS.some(k => textLower.includes(k));
  if(!senderOk && !textOk) return; // Ignore non-signal mail

  const platform = platformFromAddr(fromAddr);
  const raw = `${subject} ${text}`.trim();
  const snippet = raw.slice(0, 300);

  const body = {
    platform,
    source_url: '', // email notifications rarely have reliable public URLs
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
    console.warn('[imapWatcher] ingest error', (e as any)?.message || e);
  }
}

async function initialSweep(client: ImapFlow){
  const since = new Date(Date.now() - 3*24*3600*1000);
  const lock = await client.getMailboxLock(BOX);
  try{
    const supportsGmail = (client.capabilities||[]).includes('X-GM-EXT-1') && !!GMAIL_RAW;
    const uids = supportsGmail
      ? await client.search({ gmailRaw: GMAIL_RAW })
      : await client.search({ seen: false, since });
    for(const uid of uids.slice(-100)){
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
