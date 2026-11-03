const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { createResalaClient, ResalaError, resalaPhone } = require('../src/resala');

const key = crypto.randomBytes(32);
const secret = `v1,whsec_${key.toString('base64')}`;

// Signs a body the way Supabase's Send SMS hook does (Standard Webhooks).
function signed(body, { at = Math.floor(Date.now() / 1000), with: signingKey = key } = {}) {
  const raw = JSON.stringify(body);
  const id = `msg_${crypto.randomUUID()}`;
  const signature = crypto.createHmac('sha256', signingKey).update(`${id}.${at}.${raw}`).digest('base64');
  return {
    body: raw,
    headers: {
      'content-type': 'application/json', 'webhook-id': id,
      'webhook-timestamp': String(at), 'webhook-signature': `v1,${signature}`,
    },
  };
}

async function withHook(resala, run) {
  const app = createApp({
    pool: { async query() { return { rows: [] }; } }, authClientFactory: () => ({ auth: {} }),
    storage: {}, authAdmin: {}, smsHook: { secret, templateId: 'tpl-1', resala },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth/sms-hook`;
  try {
    await run(async (request) => {
      const response = await fetch(base, { method: 'POST', ...request });
      return { status: response.status, body: await response.json() };
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const hookBody = (phone = '+218912345678', otp = '482913') => ({ user: { id: 'u1', phone }, sms: { otp } });

test('Libyan mobiles are passed to Resala without the plus sign', () => {
  assert.equal(resalaPhone('+218912345678'), '218912345678');
  assert.equal(resalaPhone('218942345678'), '218942345678');
  assert.equal(resalaPhone('+218952345678'), null); // not 091 to 094
  assert.equal(resalaPhone('+201012345678'), null);
  assert.equal(resalaPhone(undefined), null);
});

test('the Resala client sends a template once, with the key, sender and sandbox flag', async () => {
  const calls = [];
  const client = createResalaClient({
    apiKey: 'rsl_test_key', sender: 'Balaghi', test: true,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return { ok: true, json: async () => ({ succeeded: 1, failed: 0, is_prod: false }) };
    },
  });
  const result = await client.sendTemplate({ templateId: 'tpl-1', records: [{ phone: '218912345678', $1: '482913' }] });

  assert.equal(result.succeeded, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/api/v1/messages/send-template');
  assert.equal(calls[0].url.searchParams.get('sms_template_id'), 'tpl-1');
  assert.equal(calls[0].url.searchParams.get('sender'), 'Balaghi');
  assert.equal(calls[0].url.searchParams.get('test'), 'true');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer rsl_test_key');
  assert.deepEqual(JSON.parse(calls[0].options.body), { records: [{ phone: '218912345678', $1: '482913' }] });
  assert.throws(() => createResalaClient({ apiKey: 'wrong' }), /rsl_/);
});

test('Resala errors are read from their type, and a failed send is not retried', async () => {
  let calls = 0;
  const client = createResalaClient({
    apiKey: 'rsl_test_key',
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 422, json: async () => ({ type: 'InputValidation', message: 'رقم غير صالح', errors: { phone: ['invalid'] } }) };
    },
  });
  await assert.rejects(client.sendTemplate({ templateId: 'tpl-1', records: [] }), (error) => {
    assert.ok(error instanceof ResalaError);
    assert.equal(error.type, 'InputValidation');
    assert.deepEqual(error.errors, { phone: ['invalid'] });
    return true;
  });
  assert.equal(calls, 1);
});

test('a signed hook from Supabase texts the code through the template', async () => {
  const sends = [];
  const resala = { async sendTemplate(input) { sends.push(input); return { succeeded: 1, is_prod: true }; } };
  await withHook(resala, async (post) => {
    const sent = await post(signed(hookBody()));
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, {});
    assert.deepEqual(sends, [{ templateId: 'tpl-1', records: [{ phone: '218912345678', $1: '482913' }] }]);
  });
});

test('unsigned, stale or foreign hooks are refused before anything is sent', async () => {
  const resala = { async sendTemplate() { throw new Error('must not send'); } };
  await withHook(resala, async (post) => {
    const unsigned = signed(hookBody());
    delete unsigned.headers['webhook-signature'];
    assert.equal((await post(unsigned)).status, 401);
    assert.equal((await post(signed(hookBody(), { with: crypto.randomBytes(32) }))).status, 401);
    const stale = await post(signed(hookBody(), { at: Math.floor(Date.now() / 1000) - 3600 }));
    assert.equal(stale.status, 401);
    assert.deepEqual(stale.body, { error: { http_code: 401, message: 'invalid signature' } });
    assert.equal((await post(signed(hookBody('+201012345678')))).status, 400);
  });
});

test('a Resala refusal tells Supabase the code was not sent', async () => {
  const resala = { async sendTemplate() { throw new ResalaError(400, 'InsufficientCredit', 'رصيد غير كاف'); } };
  await withHook(resala, async (post) => {
    const refused = await post(signed(hookBody()));
    assert.equal(refused.status, 502);
    assert.equal(refused.body.error.message, 'the code could not be sent');
  });
  const skipped = { async sendTemplate() { return { succeeded: 0, invalid_numbers: ['218912345678'] }; } };
  await withHook(skipped, async (post) => {
    assert.equal((await post(signed(hookBody()))).status, 502);
  });
});
