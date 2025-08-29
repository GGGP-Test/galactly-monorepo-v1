// Backend/src/brandintake.ts
const CANDIDATE_PATHS = [
  'supplier','suppliers','vendors','vendor','procurement','purchasing','sourcing',
  'partner','partners','become-a-supplier','vendor-registration','supplier-registration',
  'rfq','rfi','request-for-quote',
  'pages/suppliers','pages/vendor','pages/procurement','about/suppliers'
];

const RX_ANY = /\b(supplier|vendors?|procurement|purchasing|sourcing|rfq|rfi|vendor registration|become a supplier)\b/i;
const RX_PACK = /\b(packaging|corrugated|cartons?|labels?|mailers?|rsc|case\s?pack)\b/i;

async function tryFetch(u: string): Promise<string|null> {
  try {
    const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': 'GalactlyBot/0.1' } });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    return await r.text();
  } catch { return null; }
}
function visible(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function titleOf(html: string) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i); return (m?.[1] || '').trim();
}

export type IntakeHit = { url: string; title?: string; snippet?: string };

export async function scanBrandIntake(domain: string): Promise<IntakeHit[]> {
  const host = domain.replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase();
  const hits: IntakeHit[] = [];
  for (const p of CANDIDATE_PATHS) {
    const u = `https://${host}/${p}`;
    const html = await tryFetch(u);
    if (!html) continue;
    const txt = visible(html);
    if (RX_ANY.test(txt) && RX_PACK.test(txt)) {
      hits.push({
        url: u,
        title: titleOf(html) || 'Supplier / Procurement',
        snippet: txt.slice(0, 240)
      });
    }
  }
  return hits.slice(0, Number(process.env.INTAKE_MAX || 10));
}
