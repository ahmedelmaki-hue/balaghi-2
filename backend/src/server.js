const { loadConfig } = require('./config');
const { createPool } = require('./db');
const { createAuthClientFactory, createServiceClient } = require('./supabase');
const { createStorage } = require('./storage');
const { createApp } = require('./app');

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const authClientFactory = createAuthClientFactory(config);
const serviceClient = createServiceClient(config);
const storage = createStorage(serviceClient, config.storageBucket, config.supabaseUrl);
const app = createApp({
  pool, authClientFactory, storage, authAdmin: serviceClient.auth.admin,
  staffEmailDomain: config.staffEmailDomain, corsOrigins: config.corsOrigins,
  trustProxy: config.trustProxy,
});

if (process.env.NODE_ENV === 'production' && !config.corsOrigins.length) {
  console.warn('CORS_ORIGINS is empty: any website can call this API from a browser. Set it to the dashboard origin.');
}

app.listen(config.port, () => console.log(`Balaghi API running on :${config.port}`));
