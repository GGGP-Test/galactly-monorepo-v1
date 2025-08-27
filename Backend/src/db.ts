import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';


const connectionString = process.env.DATABASE_URL;
if (!connectionString) console.warn('[db] DATABASE_URL not set.');


export const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
export async function q<T = any>(text: string, params?: any[]) { return pool.query<T>(text, params as any); }


export async function migrate() {
try {
const distPath = path.resolve(__dirname, 'schema.sql');
const srcPath = path.resolve(__dirname, '../src/schema.sql');
const schemaPath = fs.existsSync(distPath) ? distPath : (fs.existsSync(srcPath) ? srcPath : '');
if (!schemaPath) { console.warn('[db] schema.sql not found. Skipping.'); return; }
const sql = fs.readFileSync(schemaPath, 'utf8');
if (sql.trim()) await pool.query(sql);
console.log('[db] schema applied from', schemaPath.includes('/src/') ? 'src' : 'dist');
} catch (e) { console.error('[db] migrate error', e); }
}
