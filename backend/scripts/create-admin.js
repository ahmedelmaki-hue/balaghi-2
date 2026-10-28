// Creates an owner administrator from the server. Owners hold every permission
// and are the only accounts that manage other administrators. The dashboard cannot create
// the first administrator, and no public API grants this role.
// Usage: npm run admin:create -- <username> "<full name>"
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { temporaryPassword, audit } = require('../src/accounts');

const username = (process.argv[2] || '').trim().toLowerCase();
const fullName = (process.argv[3] || '').trim();
if (!/^[a-z][a-z0-9_.-]{2,49}$/.test(username) || !fullName || fullName.length > 100) {
  throw new Error('Usage: npm run admin:create -- <username> "<full name>"');
}
for (const key of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
  if (!process.env[key]) throw new Error(`Missing ${key}.`);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const existing = await pool.query(
      'SELECT id FROM public.profiles WHERE staff_username = $1', [username]
    );
    if (existing.rows[0]) throw new Error('This username already exists.');
    const password = temporaryPassword();
    const domain = (process.env.STAFF_EMAIL_DOMAIN || 'balaghi.local').toLowerCase();
    const email = `${username}@${domain}`;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (error || !data?.user?.id) throw new Error(error?.message || 'Could not create Auth user.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.profiles
         (id, full_name, staff_username, staff_auth_email, role, is_owner, must_change_password)
         VALUES ($1, $2, $3, $4, 'admin', TRUE, TRUE)`,
        [data.user.id, fullName, username, email]
      );
      await audit(client, data.user.id, 'account_created', data.user.id,
        { username, role: 'admin', owner: true, source: 'server script' });
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK');
      await supabase.auth.admin.deleteUser(data.user.id);
      throw cause;
    } finally { client.release(); }
    console.log(`Owner administrator username: ${username}`);
    console.log(`Temporary password (shown once, must be changed at first sign-in): ${password}`);
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
