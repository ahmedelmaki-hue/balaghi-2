class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid JSON' });
  }

  if (error.name === 'MulterError') {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'image too large' : 'invalid upload' });
  }

  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });

  console.error('Request failed', error);
  return res.status(500).json({ error: 'server error' });
}

module.exports = { HttpError, asyncRoute, errorHandler };
