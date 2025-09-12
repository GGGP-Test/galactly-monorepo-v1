import type { Request, Response } from 'express';
import type { App } from '../index';

export function mountPublic(app: App) {
  app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));
}
