import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

const ScoreInput = z.object({
  name: z.string().min(1).optional(),
  signals: z.array(z.string()).optional(),
  text: z.string().optional()
});

function scoreIt(payload: z.infer<typeof ScoreInput>): number {
  // tiny heuristic: +10 for name, +5 per signal (max 50), +0..40 for text length
  let s = 0;
  if (payload.name) s += 10;
  if (payload.signals?.length) s += Math.min(50, payload.signals.length * 5);
  if (payload.text) s += Math.min(40, Math.floor(payload.text.length / 100));
  return Math.max(0, Math.min(100, s));
}

export default function createScoreRouter() {
  const r = Router();

  r.get('/score/ping', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  r.post('/score', (req: Request, res: Response) => {
    const parse = ScoreInput.safeParse(req.body ?? {});
    if (!parse.success) {
      return res.status(400).json({ ok: false, error: 'bad_request', issues: parse.error.issues });
    }
    const score = scoreIt(parse.data);
    res.json({ ok: true, score });
  });

  return r;
}
