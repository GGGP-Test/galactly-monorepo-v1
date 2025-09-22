// src/routes/index.ts
import { Router } from "express";
import leadsRouter from "./leads";

// If you add more route groups later (metrics, auth, etc), mount them here.
const router = Router();
router.use("/leads", leadsRouter);

export default router;