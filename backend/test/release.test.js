const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/app');

const staff = { id: '22222222-2222-4222-8222-222222222222', full_name: 'موظف', phone: null,
  staff_username: 'operator1', staff_auth_email: 'operator1@balaghi.local', role: 'staff',
  is_active: true, must_change_password: false };
const authClientFactory = () => ({ auth: {
  async getUser(token) {
    return token === 'staff-token'
      ? { data: { user: { id: staff.id, email: staff.staff_auth_email } }, error: null }
      : { data: { user: null }, error: new Error('invalid') };
  },
} });

function fakePool(report) {
  const writes = [];
  const query = async (sql, params = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM public.profiles WHERE id = $1')) return { rows: [staff] };
    if (sql.includes('FROM public.reports WHERE id = $1 FOR UPDATE')) return { rows: report ? [report] : [] };
    writes.push({ sql, params });
    return { rows: [] };
  };
  return { writes, query, async connect() { return { query, release() {} }; } };
}

async function release(pool, body = { reason: 'العامل أنهى عقده' }) {
  const server = createApp({ pool, authClientFactory, storage: {}, authAdmin: {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/14/release`, {
      method: 'PATCH', headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const inProgress = { status: 'in_progress', approved_at: new Date(), assigned_worker_id: 'w1',
  field_issue_pending: false, completion_pending: false };

test('staff return an in-progress report to its agency with a recorded reason', async () => {
  const pool = fakePool({ ...inProgress });
  const result = await release(pool);
  assert.deepEqual(result, { status: 200, body: { id: '14', status: 'new', released_from: 'in_progress' } });
  assert.match(pool.writes[0].sql, /assigned_worker_id = NULL/);
  assert.match(pool.writes[0].sql, /work_started_at = NULL/);
  assert.deepEqual(pool.writes[1].params, ['14', 'in_progress', staff.id, 'العامل أنهى عقده']);
});

test('release needs a reason, a worker, and no decision waiting on staff', async () => {
  assert.equal((await release(fakePool({ ...inProgress }), { reason: ' ' })).status, 400);
  assert.equal((await release(fakePool({ ...inProgress, assigned_worker_id: null }))).status, 409);
  assert.equal((await release(fakePool({ ...inProgress, status: 'resolved' }))).status, 409);
  assert.deepEqual((await release(fakePool({ ...inProgress, completion_pending: true }))).body,
    { error: 'decide pending work completion first' });
  assert.deepEqual((await release(fakePool({ ...inProgress, field_issue_pending: true }))).body,
    { error: 'decide pending field issue first' });
  assert.equal((await release(fakePool(null))).status, 404);
});
