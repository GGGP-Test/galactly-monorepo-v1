import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';


const connectionString = process.env.DATABASE_URL;
export const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
export async function q<T = any>(text: string, params?: any[]) { return pool.query<T>(text, params as any); }


export async function migrate(){
const dist = path.resolve(__dirname, 'schema.sql');
const src = path.resolve(__dirname, '../src/schema.sql');
const p = fs.existsSync(dist) ? dist : (fs.existsSync(src) ? src : '');
if (!p) { console.warn('[db] schema.sql missing'); return; }
const sql = fs.readFileSync(p,'utf8');
if (sql.trim()) await pool.query(sql);
console.log('[db] schema applied');
}
