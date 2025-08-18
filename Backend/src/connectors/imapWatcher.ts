import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import crypto from 'crypto';
import fetch from 'node-fetch';

const HOST = process.env.IMAP_HOST || '';
const PORT = Number(process.env.IMAP_PORT || 993);
const SECURE = String(process.env.IMAP_SECURE||'true') !== 'false';
const USER = process.env.IMAP_USER || '';
const PASS = process.env.IMAP_PASS || '';
const BOX  = process.env.IMAP_BOX  || 'INBOX';

const FROM_FILTER = (process.env.IMAP_FROM_FILTER||'linkedin.com,facebookmail.com,mail.instagram.com,notify.linkedin.com').split(',').map(s=>s.trim()).filter(Boolean);
const KEYWORDS = (process.env.IMAP_KEYWORDS||'packaging,boxes,labels,pouch,pouches,corrugated,mailer,crate,pallet,rfq,quote,procurement,buyer,sourcing').split(',').map(s=>s.trim()).filter(Boolean);

const INGEST_URL = (process.env.INGEST_URL || (process.env.SITE_ORIGIN ? process.env.SITE_ORIGIN.replace(/\/$/,'') : 'http://localhost:8787') + '/api/v1/ingest');
const INGEST_SECRET = process.env.INGEST_SECRET || '';

function hmac(body: any){
  const b = JSON.stringify(body);
  return crypto.createHmac('sha256', INGEST_SECRET).update(b).digest('hex');
}

function platformFromAddr(addr: string){
  const a = addr.toLowerCase();
  if(a.includes('linkedin')) return 'LinkedIn';
  if(a.includes('instagram')) return 'Instagram';
  if(a.includes('facebook')) return 'Facebook';
  if(a.includes('youtube')||a.includes('google')) return 'YouTube';
  return 'Email';
}

async function processUid(client: ImapFlow, uid: number){
  const msg = await client.fetchOne(uid, { source: true, envelope: true });
  if(!msg?.source) return;
  const parsed = await simpleParser(msg.source as any);
  const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  const subject = (parsed.subject || '').toString();
  const text = (parsed.text || parsed.html || '').toString();

  // Filters: sender and packaging-related keywords
  const senderOk = FROM_FILTER.some(dom => fromAddr.includes(dom));
  const textOk   = KEYWORDS.some(k => subject.toLowerCase().includes(k) || text.toLowerCase().includes(k));
  if(!senderOk && !textOk) return; // must match at least one gate

  const platform = platformFromAddr(fromAddr);
  const snippet = `${subject} ${text}`.slice(0, 300);

  const body = {
    platform,
    source_url: '',
    evidence_snippet: snippet,
    ttlHours: 72,
    text: `${subject} ${text}`
  };
  const sig = hmac(body);

  try{
    const r = await fetch(INGEST_URL, { method:'POST', headers:{ 'content-type':'application/json', 'x-ingest-signature': sig }, body: JSON.stringify(body) });
    if(!r.ok) throw new Error('ingest failed '+r.status);
  }catch(e){ /* swallow errors, continue */ }
}

async function initialSweep(client: ImapFlow){
  // Grab unseen messages from last 3 days
  const since = new Date(Date.now() - 3*24*3600*1000);
  const lock = await client.getMailboxLock(BOX);
  try{
    const uids = await client.search({ seen: false, since });
    for(const uid of uids.slice(-50)){ // cap to last 50 to avoid bursts
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
  client.on('error', err => console.warn('[imapWatcher]', err?.message||err));
  await client.connect();
  await client.mailboxOpen(BOX);
  console.log('[imapWatcher] connected to', HOST, 'box', BOX);

  // Initial un
