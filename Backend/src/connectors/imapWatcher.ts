// @ts-nocheck
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export async function startImapWatcher() {
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) return;

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASS! }
  });

  await client.connect().catch((_e: any) => {});
  try {
    await client.mailboxOpen(process.env.IMAP_BOX || 'INBOX');
    for await (const msg of client.fetch('1:*', { envelope: true, uid: true, source: true })) {
      try {
        const parsed = await simpleParser(msg.source as any);
        // TODO: pipe parsed to your normalizer
      } catch (_err: any) {}
    }
  } catch (_err: any) {}
  await client.logout().catch((_e: any) => {});
}
