require('dotenv').config();

function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 5000),
    databaseUrl: env.DATABASE_URL,
    supabaseUrl: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY,
    secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    storageBucket: env.SUPABASE_STORAGE_BUCKET || 'report-images',
    // Domain of the internal Auth emails behind staff usernames; never shown to staff.
    staffEmailDomain: (env.STAFF_EMAIL_DOMAIN || 'balaghi.local').toLowerCase(),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  };

  const missing = [
    ['DATABASE_URL', config.databaseUrl],
    ['SUPABASE_URL', config.supabaseUrl],
    ['SUPABASE_PUBLISHABLE_KEY', config.publishableKey],
    ['SUPABASE_SECRET_KEY', config.secretKey],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }
  if (!/^https?:\/\//.test(config.supabaseUrl)) throw new Error('SUPABASE_URL must be an HTTP URL');

  return config;
}

module.exports = { loadConfig };
