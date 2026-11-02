const { HttpError } = require('./http');

// Supabase Auth limits sign-in attempts per IP address, and every request
// reaches it from this server's single address, so without a limit here one
// person guessing passwords or codes could lock every user out. This is a
// fixed-window counter kept in memory: it covers one API process. When several
// instances run behind a proxy, limit at the proxy as well.
function createRateLimiter({ now = () => Date.now() } = {}) {
  const windows = new Map();

  function hit(key, limit, windowMs) {
    const time = now();
    const entry = windows.get(key);
    if (!entry || entry.resetAt <= time) {
      windows.set(key, { count: 1, resetAt: time + windowMs });
      return null;
    }
    entry.count += 1;
    return entry.count > limit ? Math.ceil((entry.resetAt - time) / 1000) : null;
  }

  const sweep = setInterval(() => {
    const time = now();
    for (const [key, entry] of windows) if (entry.resetAt <= time) windows.delete(key);
  }, 60_000);
  sweep.unref?.();

  // Each rule counts one key (an address, a phone, a username); the first rule
  // over its limit refuses the request with 429 and Retry-After.
  return function limit(rules) {
    return (req, res, next) => {
      for (const rule of rules) {
        const id = rule.key(req);
        if (!id) continue;
        const retryAfter = hit(`${rule.name}:${id}`, rule.limit, rule.windowMs);
        if (retryAfter !== null) {
          res.set('Retry-After', String(retryAfter));
          return next(new HttpError(429, 'too many attempts'));
        }
      }
      return next();
    };
  };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const clientAddress = (req) => req.ip || req.socket?.remoteAddress || null;
const bodyText = (name, normalize = (value) => value) => (req) => {
  const value = req.body?.[name];
  return typeof value === 'string' && value.trim() ? normalize(value.trim()) : null;
};

// Per address limits are generous because an office may share one address;
// per phone and per username limits stop guessing against one account.
const AUTH_LIMITS = {
  otpSend: [
    { name: 'otp-send-ip', limit: 30, windowMs: FIFTEEN_MINUTES, key: clientAddress },
    { name: 'otp-send-phone', limit: 5, windowMs: FIFTEEN_MINUTES, key: bodyText('phone') },
  ],
  otpVerify: [
    { name: 'otp-verify-ip', limit: 60, windowMs: FIFTEEN_MINUTES, key: clientAddress },
    { name: 'otp-verify-phone', limit: 10, windowMs: FIFTEEN_MINUTES, key: bodyText('phone') },
  ],
  staffLogin: [
    { name: 'login-ip', limit: 50, windowMs: FIFTEEN_MINUTES, key: clientAddress },
    { name: 'login-user', limit: 8, windowMs: FIFTEEN_MINUTES, key: bodyText('username', (value) => value.toLowerCase()) },
  ],
  passwordChange: [
    { name: 'password-user', limit: 5, windowMs: FIFTEEN_MINUTES, key: (req) => req.user?.id || null },
  ],
};

module.exports = { createRateLimiter, AUTH_LIMITS };
