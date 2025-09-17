// src/persona.ts
// Lightweight persona inference for packaging suppliers.
// No extra deps: uses built-in fetch + simple text heuristics.

export type Persona = {
  host: string
  company: string
  productOffer: string[]
  sectors: string[]
  solves: string[]
  buyerTitles: string[]
  line: string
  confidence: number // 0..1
  why: Array<{ cue: string; weight: number }>
  fetchedAt: string
}

const TIMEOUT_MS = 12000

// Keyword banks (extendable). Weight ~ relative importance.
const PRODUCTS: Array<[string, number]> = [
  ['corrugated', 0.20],
  ['boxes', 0.12],
  ['right-size', 0.25],
  ['mailers', 0.18],
  ['poly mailer', 0.18],
  ['bubble mailer', 0.16],
  ['labels', 0.10],
  ['tape', 0.10],
  ['stretch film', 0.20],
  ['shrink film', 0.16],
  ['void fill', 0.16],
  ['cushioning', 0.12],
  ['pallet', 0.10],
  ['automation', 0.12],
  ['cartonization', 0.28],
]

const SECTORS: Array<[string, number]> = [
  ['e-commerce', 0.25],
  ['ecommerce', 0.25],
  ['dtc', 0.22],
  ['subscription', 0.16],
  ['3pl', 0.18],
  ['retail', 0.12],
  ['grocery', 0.10],
  ['cold chain', 0.14],
  ['food', 0.10],
  ['beverage', 0.10],
  ['pharma', 0.10],
  ['cosmetics', 0.10],
  ['electronics', 0.10],
]

const SOLVES: Array<[string, number]> = [
  ['dim weight', 0.24],
  ['reduce damage', 0.24],
  ['returns', 0.12],
  ['right-size', 0.28],
  ['sustainab', 0.14], // sustainability/sustainable
  ['automation', 0.12],
  ['throughput', 0.10],
  ['ista', 0.10],
  ['eco', 0.08],
]

const TITLES: Array<[string, number]> = [
  ['fulfillment ops manager', 0.30],
  ['packaging engineer', 0.28],
  ['supply chain manager', 0.20],
  ['operations manager', 0.18],
  ['procurement', 0.14],
  ['plant manager', 0.14],
  ['warehouse manager', 0.16],
]

// Fallback titles if text gives no strong cues.
const TITLE_DEFAULTS = [
  'Fulfillment Ops Manager',
  'Packaging Engineer',
  'Supply Chain Manager',
]

// Very small in-memory cache (per host) to avoid re-fetching repeatedly.
const cache = new Map<string, Persona>()

function abortableFetch(url: string, ms = TIMEOUT_MS) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(t))
}

function pickCompanyFromHtml(html: string, host: string): string {
  const og = html.match(/property=['"]og:site_name['"][^>]*content=['"]([^'"]+)['"]/i)?.[1]
  if (og) return sanitize(og)

  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
  if (title) {
    // Trim things like " | Company Name" or " – …"
    const parts = title.split(/[\|\-–—]/).map(s => s.trim()).filter(Boolean)
    const longest = parts.sort((a, b) => b.length - a.length)[0] || title
    return sanitize(longest).slice(0, 60)
  }

  // Fallback: host without www + TLD split
  const base = host.replace(/^www\./, '')
  const stem = base.split('.')[0]
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

function sanitize(s: string) {
  return s.replace(/\s+/g, ' ').trim()
}

function scoreBank(html: string, bank: Array<[string, number]>) {
  const text = html.toLowerCase()
  let total = 0
  const hits: Array<{k: string; w: number; c: number}> = []
  for (const [k, w] of bank) {
    const rx = new RegExp('\\b' + k.replace(/\s+/g, '\\s+') + '\\b', 'gi')
    const c = (text.match(rx) || []).length
    if (c > 0) {
      total += w * Math.min(1, c) // cap each key’s contribution
      hits.push({ k, w, c })
    }
  }
  return { total, hits }
}

function topKeys(hits: Array<{k:string;w:number;c:number}>, limit: number) {
  return hits.sort((a,b)=> (b.w*b.c)-(a.w*a.c)).slice(0, limit).map(h => h.k)
}

function buildOneLiner(company: string, products: string[], sectors: string[], titles: string[]) {
  const prod = products.slice(0, 2).join(' & ') || 'packaging'
  const who  = sectors.slice(0, 2).join(' / ') || 'e-commerce operations'
  const title = titles[0] || TITLE_DEFAULTS[0]
  return `${company} sells ${prod} to ${who}; best first-contact: ${title}.`
}

export async function inferPersonaFromSite(url: string): Promise<Persona> {
  const u = new URL(url)
  const host = u.host.toLowerCase()
  if (cache.has(host)) return cache.get(host)!

  const res = await abortableFetch(url)
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`)
  const html = await res.text()

  const company = pickCompanyFromHtml(html, host)

  const p = scoreBank(html, PRODUCTS)
  const s = scoreBank(html, SECTORS)
  const z = scoreBank(html, SOLVES)

  // Titles are trickier; we’ll pull from copy if present, else defaults.
  const titlesScore = scoreBank(html, TITLES)
  const buyerTitles = titlesScore.hits.length
    ? topKeys(titlesScore.hits, 3).map(capWords)
    : TITLE_DEFAULTS

  const productOffer = topKeys(p.hits, 5)
  const sectors = topKeys(s.hits, 5)
  const solves = topKeys(z.hits, 5)

  // Very simple confidence: sigmoid over weighted totals.
  const raw = p.total * 0.45 + s.total * 0.35 + z.total * 0.20
  const confidence = 1 / (1 + Math.exp(-4 * (raw - 0.6))) // centered ~0.6

  const why: Persona['why'] = []
  for (const h of [...p.hits, ...s.hits, ...z.hits].slice(0, 10)) {
    why.push({ cue: h.k, weight: +(h.w * Math.min(1, h.c)).toFixed(3) })
  }

  const line = buildOneLiner(company, productOffer, sectors, buyerTitles)

  const persona: Persona = {
    host,
    company,
    productOffer,
    sectors,
    solves,
    buyerTitles,
    line,
    confidence: +confidence.toFixed(3),
    why,
    fetchedAt: new Date().toISOString(),
  }

  cache.set(host, persona)
  return persona
}

function capWords(s: string) {
  return s.replace(/\b\w+/g, m => m.charAt(0).toUpperCase() + m.slice(1))
}
