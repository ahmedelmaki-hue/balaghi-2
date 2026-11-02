const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/app');
const { createRateLimiter } = require('../src/rateLimit');

test('the limiter refuses past the limit until its window ends', () => {
  let time = 0;
  const limit = createRateLimiter({ now: () => time })([
    { name: 'try', limit: 2, windowMs: 60_000, key: (req) => req.id },
  ]);
  const run = (id) => {
    const headers = {};
    let error;
    limit({ id }, { set: (name, value) => { headers[name] = value; } }, (cause) => { error = cause; });
    return { status: error?.status || 200, retryAfter: headers['Retry-After'] };
  };
  assert.equal(run('a').status, 200);
  assert.equal(run('a').status, 200);
  assert.deepEqual(run('a'), { status: 429, retryAfter: '60' });
  assert.equal(run('b').status, 200, 'another key has its own window');
  time = 61_000;
  assert.equal(run('a').status, 200, 'a new window starts after the old one ends');
});

test('repeated staff sign-in attempts for one username are refused with 429', async () => {
  const pool = { async query() { return { rows: [] }; } };
  const authClientFactory = () => ({ auth: {} });
  const server = createApp({ pool, authClientFactory, storage: {}, authAdmin: {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (username) => fetch(`${base}/api/auth/staff/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'wrong-password' }),
  });
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assert.equal((await login('Operator1')).status, 401);
    }
    const refused = await login('operator1');
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: 'too many attempts' });
    assert.ok(Number(refused.headers.get('retry-after')) > 0);
    assert.equal((await login('operator2')).status, 401, 'other accounts are not locked');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
