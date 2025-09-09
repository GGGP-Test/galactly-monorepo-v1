import express from 'express';
import cors from 'cors';
import { mountPublic } from './routes/public';
import { mountLeads } from './routes/leads';
import { mountReveal } from './api/reveal';

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// health & metadata
app.get('/healthz', (req,res)=> res.json({ ok:true, time:new Date().toISOString() }));
app.get('/readyz',  (req,res)=> res.json({ ok:true, ready:true, time:new Date().toISOString() }));
app.get('/version', (req,res)=> res.json({ ok:true, version: process.env.VERSION || 'dev' }));
app.get('/api/v1/config', (req,res)=> res.json({
  ok:true, env: process.env.NODE_ENV || 'production',
  devUnlimited: false, allowList: [], version: process.env.VERSION || 'dev', time:new Date().toISOString()
}));

// feature routes
mountPublic(app);
mountReveal(app);
mountLeads(app);

// 404 fallthrough in JSON (for API)
app.use('/api/', (req,res)=> res.status(404).json({ ok:false, error:'not_found' }));

const port = Number(process.env.PORT || 3000);
app.listen(port, ()=> console.log(`api listening on ${port}`));
