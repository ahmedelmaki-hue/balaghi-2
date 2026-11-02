const express = require('express');
const cors = require('cors');
const { createAuthMiddleware } = require('./middleware/auth');
const { createAuthRouter } = require('./routes/auth');
const { createReportsRouter } = require('./routes/reports');
const { createStatsRouter } = require('./routes/stats');
const { createAdminRouter } = require('./routes/admin');
const { HttpError, asyncRoute, errorHandler } = require('./http');
const { createRateLimiter } = require('./rateLimit');

function createApp({
  pool, authClientFactory, storage, authAdmin, staffEmailDomain = 'balaghi.local',
  corsOrigins = [],
}) {
  const app = express();
  app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
  app.use(express.json({ limit: '64kb' }));

  const auth = createAuthMiddleware({ pool, authClientFactory });
  const limit = createRateLimiter();
  app.get('/', (req, res) => res.json({ name: 'Balaghi API', status: 'ok' }));
  app.get('/api/images', asyncRoute(async (req, res) => {
    const image = await storage.downloadSignedImage(req.query.target);
    res.set('Cache-Control', 'private, max-age=300');
    res.type('jpeg').send(image);
  }));
  app.use('/api/auth', createAuthRouter({ pool, authClientFactory, authAdmin, auth, limit }));
  app.use('/api/reports', createReportsRouter({ pool, auth, storage }));
  app.use('/api/stats', createStatsRouter({ pool, auth }));
  app.use('/api/admin', createAdminRouter({ pool, auth, authAdmin, staffEmailDomain }));
  app.use((req, res, next) => next(new HttpError(404, 'not found')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
