import express, { Request, Response } from "express";
import pino from "pino";

const logger = pino();
const router = express.Router();

/**
 * Minimal Stripe webhook endpoint without adding the stripe SDK.
 * You can replace express.raw(...) with your preferred body parser later.
 */
router.post(
  "/api/webhooks/stripe",
  express.raw({ type: "*/*" }),
  async (req: Request, res: Response) => {
    try {
      // If/when you add signature verification, do it here.
      const bytes = Buffer.isBuffer(req.body) ? req.body.length : 0;
      logger.info({ bytes }, "stripe webhook received");
      res.sendStatus(200);
    } catch (err) {
      logger.error({ err }, "stripe webhook error");
      res.sendStatus(400);
    }
  }
);

export default router;
