import express from 'express';

export type App = express.Application;

export function createApp(): App {
  const app = express();
  app.use(express.json());
  return app;
}
