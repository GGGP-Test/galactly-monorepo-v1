import { Router } from 'express';

export const router = Router();

const beats = new Map<string, number>();

router.get('/presence/online', (req, res) => {
  const uid = String(req.header('x-galactly-user') || 'u-anon');
  beats.set(uid, Date.now());
  res.json({ ok: true, usersOnline: beats.size });
});

router.get('/presence/beat', (req, res) => {
  const uid = String(req.header('x-galactly-user') || 'u-anon');
  beats.set(uid, Date.now());
  res.json({ ok: true });
});
