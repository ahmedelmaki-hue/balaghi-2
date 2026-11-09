require('dotenv').config();

// "1" trusts one proxy hop, "true" every hop, anything else is passed to Express
// as a subnet list (for example "loopback").
function parseTrustProxy(value) {
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  return value;
}

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
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
    // Sign-in codes by SMS through Resala, called by Supabase's Send SMS hook.
    // All three are needed; without them Supabase sends codes itself (or test codes only).
    resala: env.RESALA_API_KEY && env.RESALA_TEMPLATE_ID && env.SMS_HOOK_SECRET ? {
      apiKey: env.RESALA_API_KEY,
      templateId: env.RESALA_TEMPLATE_ID,
      hookSecret: env.SMS_HOOK_SECRET,
      sender: env.RESALA_SENDER || undefined,
      // RESALA_TEST=true: Resala's sandbox, nothing is sent or charged.
      test: env.RESALA_TEST === 'true',
      baseUrl: env.RESALA_BASE_URL || undefined,
    } : null,
    // Street names from OpenStreetMap; GEOCODER=off keeps coordinates only.
    geocoder: env.GEOCODER === 'off' ? null : {
      url: env.GEOCODER_URL || undefined,
      userAgent: env.GEOCODER_USER_AGENT || undefined,
    },
    // The automatic photo check with Claude; without a key, reports carry no check.
    // PHOTO_CHECK=off turns it off while keeping the key.
    photoCheck: env.ANTHROPIC_API_KEY && env.PHOTO_CHECK !== 'off' ? {
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.PHOTO_CHECK_MODEL || undefined,
    } : null,
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
