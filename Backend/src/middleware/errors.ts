import type { Request, Response, NextFunction } from 'express';
import { log } from '../logger';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = typeof err?.status === 'number' ? err.status : 500;
  const code = err?.code || 'internal_error';
  const msg = err?.message || 'Internal Server Error';

  if (status >= 500) log.error({ err }, '[error] unhandled');
  else log.warn({ err }, '[warn] handled');

  res.status(status).json({ ok: false, error: code, message: msg });
}
