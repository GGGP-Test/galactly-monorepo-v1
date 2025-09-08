import express, { Router } from 'express';

export default function createScoreRouter(): Router {
  const r = express.Router();
  r.get('/api/v1/score/ping', (_req, res) => res.json({ ok: true, pong: true }));
  return r;
}
