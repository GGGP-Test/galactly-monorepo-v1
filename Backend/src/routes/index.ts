import type { App } from '../index';
import mountWebscout from './webscout';
import { mountFind } from './find';
import { mountBuyers } from './buyers';

export function mountRoutes(app: App) {
  mountWebscout(app);
  mountFind(app);
  mountBuyers(app);
}
