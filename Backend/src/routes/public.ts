import express from 'express';

export function mountPublic(app: express.Express) {
  const r = express.Router();

  r.get('/ping', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  r.get('/echo', (req, res) => {
    res.json({ ok: true, query: req.query });
  });

  r.post('/echo', (req, res) => {
    res.json({ ok: true, body: req.body });
  });

  app.use('/api/v1/public', r);
}
