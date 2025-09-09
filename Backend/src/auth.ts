import type express from 'express';

export function attachUser(): express.RequestHandler {
  return (req, _res, next) => {
    const explicit = String(req.header('x-galactly-user') || '').trim();
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '0.0.0.0';
    (req as any).userId = explicit || `anon:${ip}`;
    next();
  };
}
