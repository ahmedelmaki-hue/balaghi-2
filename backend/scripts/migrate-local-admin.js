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
    // Separate queries: the new enum value must be committed before it is used.
    for (const file of ['20261023000000_admin_role.sql', '20261023000001_admin_accounts.sql']) {
      await pool.query(fs.readFileSync(
        path.resolve(__dirname, '../supabase/migrations', file), 'utf8'
      ));
    }
    console.log('Local administrator schema is ready.');
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
