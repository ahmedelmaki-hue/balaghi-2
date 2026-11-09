const { loadConfig } = require('./config');
const { createPool } = require('./db');
const { createAuthClientFactory, createServiceClient } = require('./supabase');
const { createStorage } = require('./storage');
const { createApp } = require('./app');
const { createGeocoder } = require('./geocode');
const { createResalaClient } = require('./resala');
const { createPhotoChecker } = require('./photo_check');

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const authClientFactory = createAuthClientFactory(config);
const serviceClient = createServiceClient(config);
const storage = createStorage(serviceClient, config.storageBucket, config.supabaseUrl);
const app = createApp({
  pool, authClientFactory, storage, authAdmin: serviceClient.auth.admin,
  staffEmailDomain: config.staffEmailDomain, corsOrigins: config.corsOrigins,
  trustProxy: config.trustProxy,
  geocoder: config.geocoder && createGeocoder(config.geocoder),
  photoChecker: config.photoCheck && createPhotoChecker(config.photoCheck),
  smsHook: config.resala && {
    secret: config.resala.hookSecret,
    templateId: config.resala.templateId,
    resala: createResalaClient(config.resala),
  },
});
if (config.resala) {
  console.log(`Sign-in codes go through Resala${config.resala.test ? ' (sandbox: nothing is sent)' : ''}.`);
} else if (process.env.RESALA_API_KEY || process.env.RESALA_TEMPLATE_ID || process.env.SMS_HOOK_SECRET) {
  console.warn('Resala is half configured: set RESALA_API_KEY, RESALA_TEMPLATE_ID and SMS_HOOK_SECRET together.');
}

console.log(config.photoCheck
  ? 'Report photos are checked automatically with Claude.'
  : 'The automatic photo check is off (no ANTHROPIC_API_KEY, or PHOTO_CHECK=off).');

if (process.env.NODE_ENV === 'production' && !config.corsOrigins.length) {
  console.warn('CORS_ORIGINS is empty: any website can call this API from a browser. Set it to the dashboard origin.');
}

app.listen(config.port, () => console.log(`Balaghi API running on :${config.port}`));
