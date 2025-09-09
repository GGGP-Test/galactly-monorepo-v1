import type { Express, Request, Response } from 'express';

export type Ctx = {
  users: Map<string, { reveals: number; finds: number }>;
  devUnlimited: boolean;
  quota?: {
    status(uid: string): Promise<{ revealsLeft: number; findsLeft: number }>;
  };
};

export function attachQuotaHelpers(ctx: Ctx) {
  const get = (uid: string) => ctx.users.get(uid) ?? { reveals: 0, finds: 0 };
  ctx.quota = {
    async status(uid: string) {
      const q = get(uid);
      return {
        revealsLeft: ctx.devUnlimited ? 9_999 : Math.max(0, 3 - q.reveals),
        findsLeft:   ctx.devUnlimited ? 9_999 : Math.max(0, 30 - q.finds),
      };
    },
  };
}

export default function registerStatusRoutes(app: Express, ctx: Ctx) {
  app.get('/api/v1/status', async (req: Request, res: Response) => {
    const uid = (req.header('x-galactly-user') || 'anon').toString();
    const quota = await ctx.quota!.status(uid);
    res.json({ ok: true, uid, plan: 'free', quota, devUnlimited: !!ctx.devUnlimited });
  });
}
