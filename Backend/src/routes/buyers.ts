// Backend/src/routes/buyers.ts
// Mounts /api/v1/buyers/find — calls the WebScout worker and returns candidates.
// No admin token required for find (read-only). Adjust auth if you want.

import express from 'express';
import { runWebScout } from '../workers/webscout';

export function mountBuyers(app: express.Express){
  // POST /api/v1/buyers/find
  // Body: { supplierDomain: string, persona?: string, region?: string, includeUSA?: boolean, includeCanada?: boolean, limit?: number }
  app.post('/api/v1/buyers/find', express.json(), async (req, res) => {
    try{
      const {
        supplierDomain,
        persona,
        region,
        includeUSA,
        includeCanada,
        limit
      } = req.body || {};

      if (!supplierDomain || typeof supplierDomain !== 'string'){
        return res.status(400).json({ ok:false, error:'missing supplierDomain' });
      }

      const items = await runWebScout({
        supplierDomain,
        persona: typeof persona==='string' && persona.trim() ? persona.trim() : undefined,
        region: typeof region==='string' && region.trim() ? region.trim() : undefined,
        includeUSA: typeof includeUSA==='boolean' ? includeUSA : true,
        includeCanada: typeof includeCanada==='boolean' ? includeCanada : true,
        limit: typeof limit==='number' ? Math.max(1, Math.min(50, limit)) : 10,
      });

      res.json({ ok:true, supplierDomain, items });
    }catch(e:any){
      res.status(500).json({ ok:false, error: String(e?.message||e) });
    }
  });
}
