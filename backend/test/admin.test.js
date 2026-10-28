const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/app');

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const helperId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const staffId = '22222222-2222-4222-8222-222222222222';
const workerId = '44444444-4444-4444-8444-444444444444';
const citizenId = '11111111-1111-4111-8111-111111111111';
const accounts = {
  'admin-token': { id: adminId, full_name: 'المسؤول', phone: null, staff_username: 'admin1',
    staff_auth_email: 'admin1@balaghi.local', role: 'admin', is_active: true,
    must_change_password: false, is_owner: true, admin_permissions: [] },
  'helper-token': { id: helperId, full_name: 'مسؤول العمال', phone: null, staff_username: 'admin2',
    staff_auth_email: 'admin2@balaghi.local', role: 'admin', is_active: true,
    must_change_password: false, is_owner: false, admin_permissions: ['manage_workers'] },
  'staff-token': { id: staffId, full_name: 'موظف', phone: null, staff_username: 'operator1',
    staff_auth_email: 'operator1@balaghi.local', role: 'staff', is_active: true,
    must_change_password: false },
  'worker-token': { id: workerId, full_name: 'عامل', phone: null, staff_username: 'field1',
    staff_auth_email: 'field1@balaghi.local', role: 'field_worker', agency: 'roads_maintenance',
    is_active: true, must_change_password: false },
};
const session = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600,
  token_type: 'bearer' };

function authUser(profile) {
  return { id: profile.id, email: profile.staff_auth_email, phone: profile.phone };
}

function authClientFactory(passwords = {}) {
  return () => ({ auth: {
    async getUser(token) {
      const profile = accounts[token];
      return { data: { user: profile ? authUser(profile) : null },
        error: profile ? null : new Error('invalid') };
    },
    async signInWithPassword({ email, password }) {
      const profile = Object.values(accounts).find((item) => item.staff_auth_email === email);
      const valid = profile && passwords[email] === password;
      return { data: valid ? { user: authUser(profile), session } : null,
        error: valid ? null : new Error('invalid credentials') };
    },
    async signInWithOtp() { return { data: {}, error: null }; },
  } });
}

function fakeAuthAdmin() {
  return {
    calls: [],
    async createUser(input) { this.calls.push(['createUser', input]);
      return { data: { user: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }, error: null }; },
    async deleteUser(id) { this.calls.push(['deleteUser', id]); return { error: null }; },
    async updateUserById(id, input) { this.calls.push(['updateUserById', id, input]);
      return { data: {}, error: null }; },
    async signOut(jwt, scope) { this.calls.push(['signOut', jwt, scope]); return { error: null }; },
  };
}

// Answers the auth lookup from `accounts`, then hands other SQL to `handle`.
function fakePool(handle = () => { throw new Error('unexpected SQL'); }) {
  const queries = [];
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM public.profiles WHERE id = $1') && sql.includes('must_change_password')
        && !sql.includes('FOR UPDATE')) {
      return { rows: Object.values(accounts).filter((item) => item.id === params[0]) };
    }
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    return handle(sql, params);
  };
  return { queries, query, async connect() { return { query, release() {} }; } };
}

async function withServer(deps, run) {
  const server = createApp({ storage: {}, ...deps }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(base, path, token, { method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

test('admin has staff access but not field-worker or other roles admin access', async () => {
  const pool = fakePool((sql) => {
    if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }] };
    if (sql.includes('GROUP BY')) return { rows: [] };
    return { rows: [] };
  });
  await withServer({ pool, authClientFactory: authClientFactory(), authAdmin: fakeAuthAdmin() },
    async (base) => {
      assert.equal((await request(base, '/api/stats/overview', 'admin-token')).status, 200);
      assert.equal((await request(base, '/api/reports/field/assigned', 'admin-token')).status, 403);
      assert.equal((await request(base, '/api/admin/users', 'admin-token')).status, 200);
      assert.equal((await request(base, '/api/admin/users', 'staff-token')).status, 403);
      assert.equal((await request(base, '/api/admin/citizens', 'worker-token')).status, 403);
    });
});

test('deactivated accounts and pending password changes are enforced by the server', async () => {
  const pool = fakePool(() => ({ rows: [{ total: 0 }] }));
  await withServer({ pool, authClientFactory: authClientFactory(), authAdmin: fakeAuthAdmin() },
    async (base) => {
      accounts['staff-token'].is_active = false;
      try {
        const disabled = await request(base, '/api/stats/overview', 'staff-token');
        assert.deepEqual(disabled, { status: 403, body: { error: 'account disabled' } });
      } finally { accounts['staff-token'].is_active = true; }

      accounts['staff-token'].must_change_password = true;
      try {
        const blocked = await request(base, '/api/stats/overview', 'staff-token');
        assert.deepEqual(blocked.body, { error: 'password change required' });
        const me = await request(base, '/api/auth/me', 'staff-token');
        assert.equal(me.status, 200);
        assert.equal(me.body.user.must_change_password, true);
      } finally { accounts['staff-token'].must_change_password = false; }
    });
});

test('a suspended citizen cannot request a sign-in code', async () => {
  const pool = fakePool((sql) => {
    assert.match(sql, /SELECT is_active FROM public\.profiles WHERE phone/);
    return { rows: [{ is_active: false }] };
  });
  await withServer({ pool, authClientFactory: authClientFactory(), authAdmin: fakeAuthAdmin() },
    async (base) => {
      const response = await request(base, '/api/auth/otp/send', null, {
        method: 'POST', body: { phone: '+218912345678' },
      });
      assert.deepEqual(response, { status: 403, body: { error: 'account disabled' } });
    });
});

test('admin creates an account with a one-time temporary password', async () => {
  const authAdmin = fakeAuthAdmin();
  const audits = [];
  let failInsert = false;
  const pool = fakePool((sql, params) => {
    if (sql.includes('SELECT 1 FROM public.profiles WHERE staff_username')) return { rows: [] };
    if (sql.includes('INSERT INTO public.profiles')) {
      if (failInsert) throw new Error('database unavailable');
      return { rows: [{ id: params[0], full_name: params[1], staff_username: params[2],
        role: params[4], agency: params[5], must_change_password: true }] };
    }
    if (sql.includes('INSERT INTO public.admin_audit_log')) { audits.push(params); return { rows: [] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await withServer({ pool, authClientFactory: authClientFactory(), authAdmin,
    staffEmailDomain: 'staff.example' }, async (base) => {
    const create = (body) => request(base, '/api/admin/users', 'admin-token', { method: 'POST', body });
    assert.equal((await create({ full_name: 'عامل', username: 'water1', role: 'field_worker' })).status, 400);
    assert.equal((await create({ full_name: 'موظف', username: 'desk1', role: 'staff',
      agency: 'water_sewer' })).status, 400);
    assert.equal((await create({ full_name: 'موظف', username: '1bad', role: 'staff' })).status, 400);

    const created = await create({ full_name: 'عامل المياه', username: 'Water1',
      role: 'field_worker', agency: 'water_sewer' });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.staff_username, 'water1');
    assert.equal(created.body.user.must_change_password, true);
    assert.match(created.body.temporary_password, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(created.body.user.staff_auth_email, undefined);
    const [, input] = authAdmin.calls.find(([name]) => name === 'createUser');
    assert.equal(input.email, 'water1@staff.example');
    assert.equal(input.password, created.body.temporary_password);
    assert.equal(audits[0][0], adminId);
    assert.equal(audits[0][1], 'account_created');
    assert.doesNotMatch(audits[0][3], /password/);

    failInsert = true;
    assert.equal((await create({ full_name: 'موظف', username: 'desk2', role: 'staff' })).status, 500);
    assert.ok(authAdmin.calls.some(([name]) => name === 'deleteUser'),
      'the Auth user is removed when the profile cannot be saved');
  });
});

test('admin cannot lock themselves out and must give a reason to suspend a citizen', async () => {
  const authAdmin = fakeAuthAdmin();
  const pool = fakePool((sql, params) => {
    if (sql.includes("role = 'citizen' FOR UPDATE")) return { rows: [{ is_active: true }] };
    if (sql.includes('FOR UPDATE')) {
      return { rows: [{ id: params[0], full_name: 'المسؤول', role: 'admin', agency: null,
        is_active: true }] };
    }
    if (sql.includes('UPDATE public.profiles SET is_active')) {
      return { rows: [{ id: params[0], is_active: params[1], deactivated_reason: params[2] }] };
    }
    if (sql.includes('INSERT INTO public.admin_audit_log')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await withServer({ pool, authClientFactory: authClientFactory(), authAdmin }, async (base) => {
    const patch = (path, body) => request(base, path, 'admin-token', { method: 'PATCH', body });
    assert.equal((await patch(`/api/admin/users/${adminId}/status`, { active: false })).status, 409);
    assert.equal((await patch(`/api/admin/users/${adminId}`, { role: 'staff' })).status, 409);
    assert.equal((await request(base, `/api/admin/users/${adminId}/reset-password`, 'admin-token',
      { method: 'POST' })).status, 409);

    assert.equal((await patch(`/api/admin/citizens/${citizenId}/status`, { active: false })).status, 400);
    const suspended = await patch(`/api/admin/citizens/${citizenId}/status`,
      { active: false, reason: 'بلاغات مسيئة متكررة' });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.user.is_active, false);
    assert.deepEqual(authAdmin.calls.at(-1), ['updateUserById', citizenId, { ban_duration: '876000h' }]);
  });
});

test('deactivating a field worker returns unstarted work to the agency queue', async () => {
  const pool = fakePool((sql, params) => {
    if (sql.includes('FOR UPDATE')) {
      return { rows: [{ id: params[0], role: 'field_worker', agency: 'roads_maintenance',
        is_active: true }] };
    }
    if (sql.includes('UPDATE public.reports SET assigned_worker_id = NULL')) {
      return { rows: [{ id: '7' }] };
    }
    if (sql.includes('UPDATE public.report_verifications SET claimed_by = NULL')) {
      return { rows: [{ id: '3' }] };
    }
    if (sql.includes("status = 'in_progress'")) return { rows: [{ total: 1 }] };
    if (sql.includes('UPDATE public.profiles AS p SET is_active')) {
      return { rows: [{ id: params[0], is_active: false }] };
    }
    if (sql.includes('INSERT INTO public.admin_audit_log')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await withServer({ pool, authClientFactory: authClientFactory(), authAdmin: fakeAuthAdmin() },
    async (base) => {
      const result = await request(base, `/api/admin/users/${workerId}/status`, 'admin-token', {
        method: 'PATCH', body: { active: false, reason: 'انتهى عقده' },
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.released, { released_reports: ['7'],
        released_verifications: 1, in_progress_reports: 1 });
    });
});

test('reset forces a new password; the owner changes it without the admin knowing it', async () => {
  const authAdmin = fakeAuthAdmin();
  const passwords = { 'operator1@balaghi.local': 'temporary-pass-1' };
  const updates = [];
  const pool = fakePool((sql, params) => {
    if (sql.includes('FOR UPDATE')) return { rows: [{ id: params[0], role: 'staff' }] };
    if (sql.includes('SELECT staff_auth_email')) {
      return { rows: [{ staff_auth_email: 'operator1@balaghi.local' }] };
    }
    if (sql.includes('UPDATE public.profiles')) { updates.push(sql); return { rows: [] }; }
    if (sql.includes('INSERT INTO public.admin_audit_log')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const factory = authClientFactory(passwords);
  authAdmin.updateUserById = async function updateUserById(id, input) {
    this.calls.push(['updateUserById', id, input]);
    if (input.password) passwords['operator1@balaghi.local'] = input.password;
    return { data: {}, error: null };
  };
  await withServer({ pool, authClientFactory: factory, authAdmin }, async (base) => {
    const reset = await request(base, `/api/admin/users/${staffId}/reset-password`,
      'admin-token', { method: 'POST' });
    assert.equal(reset.status, 200);
    assert.match(updates.at(-1), /must_change_password = TRUE/);
    const temporary = reset.body.temporary_password;

    accounts['staff-token'].must_change_password = true;
    try {
      const change = (body) => request(base, '/api/auth/password', 'staff-token',
        { method: 'POST', body });
      assert.deepEqual((await change({ current_password: 'wrong-password',
        new_password: 'a-new-password' })).body, { error: 'current password incorrect' });
      assert.equal((await change({ current_password: temporary,
        new_password: 'short' })).status, 400);
      assert.equal((await change({ current_password: temporary,
        new_password: temporary })).status, 400);

      const changed = await change({ current_password: temporary,
        new_password: 'my-own-password' });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.user.must_change_password, false);
      assert.equal(changed.body.session.access_token, 'new-access');
      assert.deepEqual(authAdmin.calls.at(-1), ['signOut', 'new-access', 'others']);
      assert.match(updates.at(-1), /must_change_password = FALSE/);
      assert.equal(passwords['operator1@balaghi.local'], 'my-own-password');
    } finally { accounts['staff-token'].must_change_password = false; }
  });
});

test('a limited administrator manages only the accounts it was granted', async () => {
  const listed = [];
  const pool = fakePool((sql, params) => {
    if (sql.includes('FROM public.profiles p') && sql.includes('p.role = ANY')) {
      listed.push(params[0]);
      return { rows: sql.includes('COUNT(*)') ? [{ total: 0 }] : [] };
    }
    if (sql.includes('SELECT 1 FROM public.profiles WHERE staff_username')) return { rows: [] };
    if (sql.includes('INSERT INTO public.profiles')) {
      return { rows: [{ id: params[0], staff_username: params[2], role: params[4] }] };
    }
    if (sql.includes('INSERT INTO public.admin_audit_log')) return { rows: [] };
    if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }] };
    if (sql.includes('GROUP BY')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await withServer({ pool, authClientFactory: authClientFactory(), authAdmin: fakeAuthAdmin() },
    async (base) => {
      const get = (path) => request(base, path, 'helper-token');
      const create = (body) => request(base, '/api/admin/users', 'helper-token',
        { method: 'POST', body });
      assert.equal((await get('/api/admin/users')).status, 200);
      assert.deepEqual(listed.at(-1), ['field_worker']);
      assert.equal((await get('/api/admin/users?role=staff')).status, 403);
      assert.equal((await create({ full_name: 'موظف', username: 'desk1', role: 'staff' })).status, 403);
      assert.equal((await create({ full_name: 'مسؤول', username: 'boss2', role: 'admin' })).status, 403);
      assert.equal((await create({ full_name: 'عامل', username: 'roads2', role: 'field_worker',
        agency: 'roads_maintenance' })).status, 201);
      assert.equal((await get('/api/admin/citizens')).status, 403);
      assert.equal((await get('/api/admin/audit')).status, 403);
      assert.equal((await get('/api/stats/overview')).status, 200, 'still reviews reports');
    });
});

test('only owners manage administrators, and owners are protected from the dashboard', async () => {
  const ownerTwoId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const regularId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const targets = {
    [ownerTwoId]: { id: ownerTwoId, full_name: 'رئيسي ثانٍ', role: 'admin', agency: null,
      is_owner: true, admin_permissions: [], is_active: true },
    [regularId]: { id: regularId, full_name: 'مسؤول السجل', role: 'admin', agency: null,
      is_owner: false, admin_permissions: ['view_audit'], is_active: true },
    [helperId]: { id: helperId, full_name: 'مسؤول العمال', role: 'admin', agency: null,
      is_owner: false, admin_permissions: ['manage_workers'], is_active: true },
  };
  const inserts = [];
  const audits = [];
  const pool = fakePool((sql, params) => {
    if (sql.includes('FOR UPDATE')) return { rows: [targets[params[0]]].filter(Boolean) };
    if (sql.includes('SELECT 1 FROM public.profiles WHERE staff_username')) return { rows: [] };
    if (sql.includes('INSERT INTO public.profiles')) {
      inserts.push(params);
      return { rows: [{ id: params[0], role: params[4], admin_permissions: params[6] }] };
    }
    if (sql.includes('UPDATE public.profiles AS p SET full_name')) {
      return { rows: [{ ...targets[params[0]], admin_permissions: params[4] }] };
    }
    if (sql.includes('UPDATE public.profiles SET must_change_password')) return { rows: [] };
    if (sql.includes('INSERT INTO public.admin_audit_log')) { audits.push(params); return { rows: [] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await withServer({ pool, authClientFactory: authClientFactory(), authAdmin: fakeAuthAdmin() },
    async (base) => {
      const owner = (path, method, body) => request(base, path, 'admin-token', { method, body });
      assert.equal((await owner('/api/admin/users', 'POST', { full_name: 'مسؤول', username: 'boss2',
        role: 'admin', admin_permissions: ['delete_everything'] })).status, 400);
      assert.equal((await owner('/api/admin/users', 'POST', { full_name: 'موظف', username: 'desk1',
        role: 'staff', admin_permissions: ['view_audit'] })).status, 400);
      const created = await owner('/api/admin/users', 'POST', { full_name: 'مسؤول', username: 'boss2',
        role: 'admin', admin_permissions: ['view_audit', 'manage_staff'] });
      assert.equal(created.status, 201);
      assert.deepEqual(inserts.at(-1)[6], ['manage_staff', 'view_audit']);

      const granted = await owner(`/api/admin/users/${regularId}`, 'PATCH',
        { admin_permissions: ['view_audit', 'manage_citizens'] });
      assert.equal(granted.status, 200);
      assert.deepEqual(JSON.parse(audits.at(-1)[3]).changes.admin_permissions,
        { from: ['view_audit'], to: ['manage_citizens', 'view_audit'] });

      const locked = { error: 'owner accounts are managed on the server' };
      assert.deepEqual((await owner(`/api/admin/users/${ownerTwoId}/status`, 'PATCH',
        { active: false })).body, locked);
      assert.deepEqual((await owner(`/api/admin/users/${ownerTwoId}`, 'PATCH',
        { role: 'staff' })).body, locked);
      assert.equal((await owner(`/api/admin/users/${ownerTwoId}/reset-password`, 'POST')).status,
        200, 'owners can recover each other');

      const helper = (path, method, body) => request(base, path, 'helper-token', { method, body });
      assert.equal((await helper(`/api/admin/users/${regularId}/reset-password`, 'POST')).status, 403);
      assert.equal((await helper(`/api/admin/users/${ownerTwoId}/reset-password`, 'POST')).status, 403);
      assert.equal((await helper(`/api/admin/users/${regularId}`, 'PATCH',
        { admin_permissions: ['manage_staff'] })).status, 403);
      assert.equal((await helper(`/api/admin/users/${helperId}`, 'PATCH',
        { admin_permissions: ['manage_staff'] })).status, 400, 'cannot raise own permissions');
    });
});
