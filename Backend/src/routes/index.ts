import type { Express } from "express";
import mountFind from "./find";
import mountBuyers from "./buyers";
import mountWebscout from "./webscout";

export const mountRoutes = (app: Express) => {
  mountFind(app);
  mountBuyers(app);
  mountWebscout(app);
};

export default mountRoutes;
