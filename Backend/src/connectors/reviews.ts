// reviews.ts — Public review mining via Google CSE (or graceful synth fallback)
import fetch from 'node-fetch';

type Hit = { url: string; title: string; snippet: string; stars?: number; when?: string; cat?: string; };

const LEX = [
  { re: /\bleak|spill|spilled|burst|ruptur/i, cat: 'containment' },
  { re: /\b(dent|crush|torn box|damaged box|corner damage)/i, cat: 'carton' },
  { re: /\bseal|cap|lid|closure|ring\b/i, cat: 'closure' },
  { re: /\bpallet|wrap|film|shifting load|unstable/i, cat: 'pallet' },
  { re: /\blabel|peel|smear|barcode|print\b/i, cat: 'label' },
];

export async function reviewProbe(domain: string, apiKey?: string, cx?: string): Promise<Hit[]> {
  const clean = domain.replace(/^https?:\/\//,'').replace(/\/.*$/,'');
  if (!clean) return [];
  const key = apiKey || process.env.GOOGLE_API_KEY || '';
  const cxe = cx || process.env.GOOGLE_CX_REVIEWS || process.env.GOOGLE_CX_1 || '';
  const q = `site:${clean} (review OR reviews) (packaging OR box OR leak OR broken OR dented OR seal OR label OR wrap OR film OR pallet OR carton)`;
  if (!key || !cxe) {
    // Synth fallback (still useful for UX demo)
    return [
      { url:`https://${clean}/reviews/demo-1`, title:`Recent review mentioning packaging`, snippet:`Customer mentioned a dented box on arrival; considering heavier mailer / double wall carton.` },
    ];
  }
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cxe)}&q=${encodeURIComponent(q)}&num=5`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j: any = await r.json();
  const items: any[] = Array.isArray(j.items) ? j.items : [];
  const hits: Hit[] = items.map(it => ({
    url: it.link, title: it.title, snippet: it.snippet,
  }));
  // Categorize
  for (const h of hits) {
    const text = `${h.title} ${h.snippet}`;
    const bucket = LEX.find(b => b.re.test(text));
    if (bucket) h.cat = bucket.cat;
  }
  return hits;
}
