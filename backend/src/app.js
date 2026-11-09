const express = require('express');
const cors = require('cors');
const { createAuthMiddleware } = require('./middleware/auth');
const { createAuthRouter } = require('./routes/auth');
const { createSmsHookRouter } = require('./smsHook');
const { createReportsRouter } = require('./routes/reports');
const { createStatsRouter } = require('./routes/stats');
const { createAdminRouter } = require('./routes/admin');
const { HttpError, asyncRoute, errorHandler } = require('./http');
const { createRateLimiter } = require('./rateLimit');

// The API answers JSON and images only, so it forbids everything else.
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
}

function createApp({
  pool, authClientFactory, storage, authAdmin, staffEmailDomain = 'balaghi.local',
  corsOrigins = [], trustProxy = false, geocoder = null, smsHook = null, photoChecker = null,
}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy, trust its X-Forwarded-For so rate limits count the
  // visitor's address rather than the proxy's.
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use(securityHeaders);
  app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
  // The raw bytes are kept for checking signed webhooks (the SMS hook).
  app.use(express.json({ limit: '64kb', verify: (req, res, buffer) => { req.rawBody = buffer; } }));

  const auth = createAuthMiddleware({ pool, authClientFactory });
  const limit = createRateLimiter();
  app.get('/', (req, res) => res.json({ name: 'Balaghi API', status: 'ok' }));
  app.get('/api/images', asyncRoute(async (req, res) => {
    const image = await storage.downloadSignedImage(req.query.target);
    res.set('Cache-Control', 'private, max-age=300');
    res.type('jpeg').send(image);
  }));
  if (smsHook) app.use('/api/auth/sms-hook', createSmsHookRouter(smsHook));
  app.use('/api/auth', createAuthRouter({ pool, authClientFactory, authAdmin, auth, limit }));
  app.use('/api/reports', createReportsRouter({ pool, auth, storage, geocoder, photoChecker }));
  app.use('/api/stats', createStatsRouter({ pool, auth }));
  app.use('/api/admin', createAdminRouter({ pool, auth, authAdmin, staffEmailDomain }));
  app.use((req, res, next) => next(new HttpError(404, 'not found')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
