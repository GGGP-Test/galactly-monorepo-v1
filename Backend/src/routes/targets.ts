import * as fs from 'node:fs';
import * as path from 'node:path';

export type TargetsConfig = {
  keywords?: string[];
  verticals?: string[];
  regions?: string[];
  sampleDomains?: string[];
};

export function readTargetsConfig(file = 'targets.json'): TargetsConfig {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8')) as TargetsConfig;
}
