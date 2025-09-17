// src/discovery.ts
// Minimal lead discovery (v0): harvests "warm" buyer candidates from supplier-owned public pages.
// No external APIs. Safe, dependency-free. Extend with more connectors later.

export type BuyerCandidate = {
  name: string
  url?: string
  temp: 'warm' | 'hot'
  why: string[]
}

export type FindBuyersInput = {
  supplierUrl: string
  country?: string // e.g., "US/CA" (unused in v0, reserved)
  radiusMi?: number // unused in v0, reserved
}

export type FindBuyersResult = {
  created: number
  warm: number
  hot: number
  items: BuyerCandidate[]
  notes?: string[]
}

const TIMEOUT_MS = 12000

const CANDIDATE_PATHS = [
  '/customers', '/customers/',
  '/clients', '/clients/',
  '/case-studies', '/case-studies/',
  '/case-study', '/case-study/',
  '/partners', '/partners/',
  '/our-work', '/our-work/',
  '/portfolio', '/portfolio/',
  '/work', '/work/',
  '/success-stories', '/success-stories/',
]

function abortableFetch(url: string, ms = TIMEOUT_MS) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(t))
}

function hostFrom(url: string) {
  try { return new URL(url).host.toLowerCase() } catch { return '' }
}

function cleanText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractAnchorHrefs(html: string) {
  const rx = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  const out: Array<{ href: string; text: string }> = []
  let m: RegExpExecArray | null
  while ((m = rx.exec(html))) {
    const href = m[1]
    const text = cleanText(m[2] || '')
    out.push({ href, text })
  }
  return out
}

function titleCase(s: string) {
  return s.replace(/\b\w+/g, (w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase())
}

function likelyCompanyName(s: string) {
  // extremely light filter to avoid generic words
  const t = s.trim()
  if (!t) return ''
  if (t.length < 3) return ''
  if (/^(learn more|read more|visit|website|details|case study|client|customer)$/i.test(t)) return ''
  return titleCase(t.slice(0, 80))
}

export async function findBuyersFromSupplierPages(input: FindBuyersInput): Promise<FindBuyersResult> {
  const base = new URL(input.supplierUrl)
  const supplierHost = base.host.toLowerCase()

  // Try a handful of common “customers” pages in parallel
  const targets = CANDIDATE_PATHS.map(p => new URL(p, base).toString())
  const htmls = await Promise.all(
    targets.map(async (u) => {
      try {
        const res = await abortableFetch(u)
        if (!res.ok) return { url: u, ok: false, html: '', status: res.status }
        const html = await res.text()
        return { url: u, ok: true, html, status: res.status }
      } catch {
        return { url: u, ok: false, html: '', status: 0 }
      }
    })
  )

  const notes: string[] = []
  const candidates: BuyerCandidate[] = []
  const seen = new Set<string>() // key by host or name

  for (const page of htmls) {
    if (!page.ok) continue

    // Prefer external anchors (customers often link to brand sites)
    const anchors = extractAnchorHrefs(page.html)
    for (const a of anchors) {
      // Resolve relative links to absolute
      let href = a.href
      try { href = new URL(a.href, page.url).toString() } catch {}

      const h = hostFrom(href)
      if (!h || h === supplierHost) continue // skip internal links

      const key = `host:${h}`
      if (seen.has(key)) continue
      seen.add(key)

      const nameGuess = likelyCompanyName(a.text) || titleCase(h.split('.')[0])
      candidates.push({
        name: nameGuess,
        url: href,
        temp: 'warm',
        why: [`Mention/link found on ${new URL(page.url).pathname}`],
      })
    }

    // Fallback: harvest plain-text brand lists (no outbound links).
    // This is basic: scan for capitalized words between commas/line breaks.
    if (candidates.length === 0) {
      const text = cleanText(page.html)
      const chunks = text.split(/[,•\n\r\-–—]+/g).map(s => s.trim()).filter(Boolean)
      for (const c of chunks) {
        if (c.length < 3 || c.length > 60) continue
        if (!/[A-Za-z]/.test(c)) continue
        if (!/[A-Z]/.test(c[0])) continue
        const nm = likelyCompanyName(c)
        if (!nm) continue
        const key = `name:${nm.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({
          name: nm,
          temp: 'warm',
          why: [`Name detected on ${new URL(page.url).pathname}`],
        })
        if (candidates.length >= 50) break
      }
    }
  }

  if (candidates.length === 0) {
    notes.push('No customers/clients/case-studies pages yielded results.')
  }

  return {
    created: candidates.length,
    warm: candidates.length,
    hot: 0,
    items: candidates.slice(0, 100),
    notes,
  }
}
