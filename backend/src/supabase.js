const { createClient } = require('@supabase/supabase-js');

const serverAuthOptions = {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

function createAuthClientFactory(config) {
  // A fresh client per login/OTP/refresh request keeps sessions from different callers separate.
  return () => createClient(config.supabaseUrl, config.publishableKey, serverAuthOptions);
}

function createServiceClient(config) {
  // The secret key stays on the server. Mobile and dashboard clients never receive it.
  // It is used for private Storage and for account administration (auth.admin).
  return createClient(config.supabaseUrl, config.secretKey, serverAuthOptions);
}

module.exports = { createAuthClientFactory, createServiceClient };
