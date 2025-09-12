import express from "express";
import cors from "cors";
import mountRoutes from "./routes";

export const app = express();
app.use(cors());
app.use(express.json());

// tiny logger (no morgan needed)
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

mountRoutes(app);

export type App = typeof app;
export default app;
