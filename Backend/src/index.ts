import express from "express";
import cors from "cors";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { buildPersonaFromSupplier } from "./persona.js";
import { findBuyerCandidates } from "./buyers.js";

const PORT = Number(process.env.PORT || 8787);
const BUDGET_PER_DAY = Number(process.env.TOKEN_BUDGET_PER_DAY || 200);
const WINDOW_SEC = 24 * 60 * 60;
const BURST_PER_MIN = Number(process.env.BURST_PER_MIN || 20);

const app = express();
app.use(cors());
app.use(express.json());

const dailyLimiter = new RateLimiterMemory({ points: BUDGET_PER_DAY, duration: WINDOW_SEC, blockDuration: 60 });
const burstLimiter = new RateLimiterMemory({ points: BURST_PER_MIN, duration: 60 });

function tenantKey(req: express.Request) {
  return (req.header("x-tenant-id") ||
          req.header("x-api-key") ||
          req.header("x-user-id") ||
          req.ip ||
          req.socket.remoteAddress ||
          "anon").toString();
}

app.get("/healthz", (_req,res) => res.status(200).send("ok"));

// ---------------- Persona ----------------
app.post("/api/v1/persona/from-supplier", async (req, res) => {
  const { supplierDomain } = req.body ?? {};
  if (!supplierDomain) return res.status(400).json({ ok:false, error:"supplierDomain required" });

  const tenant = tenantKey(req);
  try { await dailyLimiter.consume(tenant); } catch (e:any) {
    return res.status(429).json({ ok:false, error:"budget_exhausted", retryInSec: Math.max(1, Math.floor(e.msBeforeNext/1000)) });
  }
  try { await burstLimiter.consume(req.ip || tenant); } catch {
    return res.status(429).json({ ok:false, error:"too_many_requests" });
  }

  try {
    const persona = await buildPersonaFromSupplier(supplierDomain);
    return res.json({ ok:true, persona });
  } catch (err:any) {
    return res.status(500).json({ ok:false, error:"persona_failed", details: err?.message || "unknown" });
  }
});

// ---------------- Leads (buyers) ----------------
app.post("/api/v1/leads/find-buyers", async (req, res) => {
  const { supplierDomain, lat, lon, radiusMi } = req.body ?? {};
  if (!supplierDomain) return res.status(400).json({ ok:false, error:"supplierDomain required" });

  const tenant = tenantKey(req);
  try { await dailyLimiter.consume(tenant); } catch (e:any) {
    return res.status(429).json({ ok:false, error:"budget_exhausted", retryInSec: Math.max(1, Math.floor(e.msBeforeNext/1000)) });
  }
  try { await burstLimiter.consume(req.ip || tenant); } catch {
    return res.status(429).json({ ok:false, error:"too_many_requests" });
  }

  try {
    const buyers = await findBuyerCandidates({ supplierDomain, lat, lon, radiusMi });
    const hot = buyers.filter(b => b.temp === "hot").length;
    const warm = buyers.length - hot;
    return res.json({ ok:true, supplierDomain, counts: { total: buyers.length, hot, warm }, buyers });
  } catch (err:any) {
    return res.status(500).json({ ok:false, error:"discovery_failed", details: err?.message || "unknown" });
  }
});

app.listen(PORT, () => console.log(`API listening on ${PORT}`));
