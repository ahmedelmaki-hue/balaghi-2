const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const username = process.argv[2] || 'field1';
const fullName = process.argv[3] || 'عامل ميداني تجريبي';
const agency = process.argv[4] || 'roads_maintenance';
if (!/^[a-z][a-z0-9_.-]{2,49}$/.test(username) || !fullName.trim() || fullName.length > 100) {
  throw new Error('Use a valid lowercase username and a name up to 100 characters.');
}
if (!['public_services', 'water_sewer', 'roads_maintenance'].includes(agency)) {
  throw new Error('Agency must be public_services, water_sewer, or roads_maintenance.');
}
for (const key of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
  if (!process.env[key]) throw new Error(`Missing ${key}. Run configure:local first.`);
}
for (const key of ['DATABASE_URL', 'SUPABASE_URL']) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(process.env[key]).hostname)) {
    throw new Error('This script can only create accounts in local Supabase.');
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const existing = await pool.query(
      'SELECT id FROM public.profiles WHERE staff_username = $1', [username]
    );
    if (existing.rows[0]) throw new Error('This username already exists.');
    const password = crypto.randomBytes(18).toString('base64url');
    const email = `${username}@balaghi.local`;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (error || !data?.user?.id) throw new Error(error?.message || 'Could not create Auth user.');
    try {
      await pool.query(
        `INSERT INTO public.profiles
         (id, full_name, staff_username, staff_auth_email, role, agency)
         VALUES ($1, $2, $3, $4, 'field_worker', $5)`,
        [data.user.id, fullName.trim(), username, email, agency]
      );
    } catch (cause) {
      await supabase.auth.admin.deleteUser(data.user.id);
      throw cause;
    }
    console.log(`Local field-worker username: ${username}`);
    console.log(`Local field-worker agency: ${agency}`);
    console.log(`Local field-worker password (shown once): ${password}`);
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
