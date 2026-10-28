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
});

app.listen(config.port, () => console.log(`Balaghi API running on :${config.port}`));
