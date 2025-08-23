import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';


const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
console.warn('[db] DATABASE_URL not set. Set it in env or secrets.');
}


export const pool = new Pool({
connectionString,
ssl: { rejectUnauthorized: false }
});


export async function q<T = any>(text: string, params?: any[]) {
return pool.query<T>(text, params as any);
}


export async function migrate() {
try {
const schemaPath = path.resolve(__dirname, 'schema.sql');
if (fs.existsSync(schemaPath)) {
const sql = fs.readFileSync(schemaPath, 'utf8');
if (sql.trim()) await pool.query(sql);
console.log('[db] schema applied');
} else {
console.warn('[db] schema.sql not found at', schemaPath, '- skipping');
}
} catch (e) {
console.error('[db] migrate error', e);
}
}
