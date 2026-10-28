const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL ||
    !['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error('A local DATABASE_URL is required. Run configure:local first.');
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sql = fs.readFileSync(path.resolve(__dirname,
      '../supabase/migrations/20261020000000_auto_agency_assignment.sql'), 'utf8');
    const result = await pool.query(sql);
    console.log(`Automatically assigned ${result.rowCount} previously approved reports.`);
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
