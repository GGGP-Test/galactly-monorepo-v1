// src/index.ts
import express from 'express'
import type { Request, Response } from 'express'
import { inferPersonaFromSite } from './persona'

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

// --- Persona endpoint ---
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

// --- Optional: mount existing routes if present (won’t crash if missing) ---
async function mountOptional() {
  try {
    const buyers = await import('./buyers').catch(() => null)
    // If your buyers module exposes a registrar, call it; else ignore.
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
