/**
 * Placeholder Stripe webhook/register to keep builds green.
 * No 'stripe' or 'express' imports; safe to include even if unused.
 */

export function registerStripeWebhook(app: any): void {
  if (!app || typeof app.post !== "function") return;

  app.post("/api/stripe/webhook", async (req: any, res: any) => {
    try {
      // No-op placeholder; accept payload to avoid retries.
      if (res?.status && res?.send) {
        return res.status(202).send("accepted");
      }
      if (res?.end) return res.end("accepted");
    } catch {
      if (res?.status && res?.send) {
        return res.status(500).send("error");
      }
    }
  });
}
