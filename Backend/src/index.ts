// src/index.ts
import express from 'express'
import type { Request, Response } from 'express'
import { inferPersonaFromSite } from './persona'
import { findBuyersFromSupplierPages } from './discovery'

const app = express()
app.use(express.json())

// simple CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }))

// --- Persona ---
app.get('/api/v1/persona', async (req: Request, res: Response) => {
  try {
    const url = String(req.query.url || '').trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'query param "url" (http/https) is required' })
    }
    const persona = await inferPersonaFromSite(url)
    return res.json(persona)
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'persona inference failed' })
  }
})

// --- Find buyers (v0) ---
// Accepts either POST with JSON body or GET with query params.
async function handleFindBuyers(req: Request, res: Response) {
  try {
    const url =
      (req.body && req.body.url) ||
      (req.body && req.body.supplierUrl) ||
      String(req.query.url || req.query.supplierUrl || '').trim()

    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'param "url" or "supplierUrl" (http/https) is required' })
    }

    const country =
      (req.body && req.body.country) ||
      String(req.query.country || 'US/CA')

    const radiusMiRaw =
      (req.body && (req.body.radiusMi as any)) ||
      (req.query.radiusMi as any)

    const radiusMi = Number(radiusMiRaw || 50)

    const out = await findBuyersFromSupplierPages({
      supplierUrl: url,
      country,
      radiusMi,
    })

    // Shape friendly to the Free Panel (counts + items).
    return res.json(out)
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'buyer discovery failed' })
  }
}

app.post('/api/v1/leads/find-buyers', handleFindBuyers)
app.get('/api/v1/leads/find-buyers', handleFindBuyers)

// --- Optional: mount existing routes if present (kept safe) ---
async function mountOptional() {
  try {
    const buyers = await import('./buyers').catch(() => null)
    if (buyers && typeof (buyers as any).register === 'function') {
      ;(buyers as any).register(app)
    }
  } catch { /* ignore */ }
}
mountOptional().catch(() => undefined)

const PORT = Number(process.env.PORT || 8787)
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})
