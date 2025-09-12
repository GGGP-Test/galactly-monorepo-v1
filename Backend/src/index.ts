import express from "express";

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// health probe so the container has something to serve
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

export default app;
