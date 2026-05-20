#!/usr/bin/env node
// One-shot: applies db/schema.sql against whatever DATABASE_URL (or POSTGRES_URL) points at.
// Bypasses SQL editors that don't support multi-statement input (e.g. Vercel Query tab).
//
// Usage:
//   DATABASE_URL="postgres://..." node scripts/runSchema.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(here, '..', 'db', 'schema.sql');
const sql = readFileSync(sqlPath, 'utf8');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('Missing DATABASE_URL (or POSTGRES_URL). Usage:');
  console.error('  DATABASE_URL="postgres://..." node scripts/runSchema.js');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('sslmode=require') || url.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : undefined,
});

try {
  await client.connect();
  // pg's simple query protocol supports multi-statement queries.
  await client.query(sql);
  console.log('✅ schema applied');
} catch (err) {
  console.error('❌ schema failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
