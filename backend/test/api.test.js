const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { prepareImage, createStorage } = require('../src/storage');

const citizenId = '11111111-1111-4111-8111-111111111111';
const staffId = '22222222-2222-4222-8222-222222222222';
const citizen = { id: citizenId, full_name: 'مواطن', phone: '+218912345678', role: 'citizen' };
const staff = {
  id: staffId, full_name: 'موظف', phone: null, staff_username: 'operator1',
  staff_auth_email: 'operator1@your-organization.example', email: 'operator1@your-organization.example',
  role: 'staff',
};
const workerId = '44444444-4444-4444-8444-444444444444';
const worker = {
  id: workerId, full_name: 'عامل ميداني', phone: null, staff_username: 'field1',
  staff_auth_email: 'field1@your-organization.example',
  email: 'field1@your-organization.example', role: 'field_worker', agency: 'roads_maintenance',
};
const otherWorkerId = '55555555-5555-4555-8555-555555555555';
const otherWorker = { ...worker, id: otherWorkerId, full_name: 'عامل آخر',
  staff_username: 'field2', staff_auth_email: 'field2@your-organization.example',
  email: 'field2@your-organization.example', agency: 'water_sewer' };
const session = {
  access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer',
};

function authClientFactory() {
  return {
    auth: {
      async getUser(token) {
        const user = token === 'staff-token' ? staff : token === 'worker-token' ? worker
          : token === 'other-worker-token' ? otherWorker
          : token === 'citizen-token' ? citizen : null;
        return { data: { user }, error: user ? null : new Error('invalid') };
      },
      async signInWithOtp() { return { data: {}, error: null }; },
      async verifyOtp() { return { data: { user: citizen, session }, error: null }; },
      async signInWithPassword({ email, password }) {
        const user = email === staff.staff_auth_email ? staff
          : email === worker.staff_auth_email ? worker : null;
        const valid = user && password === 'correct-password';
        return { data: valid ? { user, session } : null,
          error: valid ? null : new Error('invalid credentials') };
      },
      async refreshSession({ refresh_token: token }) {
        return { data: { user: token === 'staff-refresh' ? staff
          : token === 'worker-refresh' ? worker : citizen, session }, error: null };
      },
    },
  };
}

function fakeStorage() {
  return {
    uploads: 0,
    async upload() { this.uploads += 1; return 'images/test.jpg'; },
    async remove() {},
    async withSignedImages(rows) {
      return rows.map(({ image_path, ...row }) => ({ ...row, image_url: 'https://example.test/signed' }));
    },
  };
}

async function withServer(deps, run) {
  const server = createApp(deps).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function jsonRequest(base, path, options = {}) {
  const response = await fetch(base + path, options);
  return { status: response.status, body: await response.json() };
}

test('signed report images load through the API without exposing local Storage to the phone', async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#eeaa44' },
  }).jpeg().toBuffer();
  const upstream = http.createServer((req, res) => {
    if (req.url !== '/storage/v1/object/sign/report-images/user/report.jpg?token=valid') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'image/jpeg' }).end(jpeg);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  try {
    const origin = `http://127.0.0.1:${upstream.address().port}`;
    const storage = createStorage({ storage: { from: () => ({
      async createSignedUrls(paths) {
        return { data: paths.map((path) => ({
          path, signedUrl: `${origin}/storage/v1/object/sign/report-images/${path}?token=valid`,
        })) };
      },
    }) } }, 'report-images', origin);
    const [report] = await storage.withSignedImages([{ id: '42', image_path: 'user/report.jpg' }]);
    assert.match(report.image_url, /^\/api\/images\?target=/);
    assert.equal(report.image_url.includes(origin), false);

    await withServer({ pool: {}, authClientFactory, storage }, async (base) => {
      const image = await fetch(base + report.image_url);
      assert.equal(image.status, 200);
      assert.match(image.headers.get('content-type'), /^image\/jpeg/);
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);

      const invalid = await jsonRequest(base,
        `/api/images?target=${encodeURIComponent('http://example.com/private.jpg')}`);
      assert.equal(invalid.status, 400);
    });
  } finally {
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
});

test('phone OTP creates a citizen profile and old password routes are absent', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('SELECT is_active FROM public.profiles WHERE phone')) return { rows: [] };
      queries.push({ sql, params });
      assert.match(sql, /INSERT INTO public\.profiles/);
      return { rows: [citizen] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const sent = await jsonRequest(base, '/api/auth/otp/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: citizen.phone }),
    });
    assert.equal(sent.status, 200);

    const verified = await jsonRequest(base, '/api/auth/otp/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: citizen.phone, code: '123456' }),
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.user.role, 'citizen');
    assert.equal(verified.body.session.access_token, 'access');
    assert.equal(queries.length, 1);

    const old = await jsonRequest(base, '/api/auth/login', { method: 'POST' });
    assert.equal(old.status, 404);
  });
});

test('phone OTP accepts Supabase Auth phone numbers without a leading plus', async () => {
  const authUser = { ...citizen, phone: citizen.phone.slice(1) };
  const client = () => ({ auth: {
    async verifyOtp() { return { data: { user: authUser, session }, error: null }; },
    async getUser() { return { data: { user: authUser }, error: null }; },
  } });
  const pool = { async query(sql, params) {
    if (sql.includes('INSERT INTO public.profiles')) {
      assert.equal(params[1], citizen.phone);
    }
    return { rows: [citizen] };
  } };
  await withServer({ pool, authClientFactory: client, storage: fakeStorage() }, async (base) => {
    const verified = await jsonRequest(base, '/api/auth/otp/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: citizen.phone, code: '123456' }),
    });
    assert.equal(verified.status, 200);
    const me = await jsonRequest(base, '/api/auth/me', {
      headers: { authorization: 'Bearer access' },
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.phone, citizen.phone);
  });
});

test('staff signs in with username and password without exposing internal email', async () => {
  const pool = {
    async query(sql, params) {
      if (sql.includes('WHERE staff_username = $1')) {
        return { rows: params[0] === 'operator1'
          ? [{ id: staffId, staff_auth_email: staff.staff_auth_email }] : [] };
      }
      assert.match(sql, /FROM public\.profiles WHERE id = \$1/);
      return { rows: [staff] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const login = await jsonRequest(base, '/api/auth/staff/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ' Operator1 ', password: 'correct-password' }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.staff_username, 'operator1');
    assert.equal(login.body.user.role, 'staff');
    assert.equal(Object.hasOwn(login.body.user, 'staff_auth_email'), false);
    assert.equal(Object.hasOwn(login.body.user, 'email'), false);
    assert.equal(login.body.session.access_token, 'access');

    const wrong = await jsonRequest(base, '/api/auth/staff/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'operator1', password: 'wrong' }),
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'invalid credentials');

    const unknown = await jsonRequest(base, '/api/auth/staff/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'unknown', password: 'correct-password' }),
    });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, 'invalid credentials');

    const me = await jsonRequest(base, '/api/auth/me', {
      headers: { authorization: 'Bearer staff-token' },
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.staff_username, 'operator1');
    assert.equal(Object.hasOwn(me.body.user, 'staff_auth_email'), false);

    const refreshed = await jsonRequest(base, '/api/auth/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'staff-refresh' }),
    });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.user.role, 'staff');
    assert.equal(Object.hasOwn(refreshed.body.user, 'staff_auth_email'), false);
  });
});

test('field worker can sign in but cannot use staff administration routes', async () => {
  const pool = { async query(sql, params) {
    if (sql.includes('WHERE staff_username = $1')) {
      return { rows: params[0] === worker.staff_username
        ? [{ id: workerId, staff_auth_email: worker.staff_auth_email }] : [] };
    }
    if (sql.includes('FROM public.profiles WHERE id')) return { rows: [worker] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const signedIn = await jsonRequest(base, '/api/auth/staff/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'field1', password: 'correct-password' }),
    });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.user.role, 'field_worker');
    assert.equal(Object.hasOwn(signedIn.body.user, 'staff_auth_email'), false);
    const denied = await jsonRequest(base, '/api/reports/staff', {
      headers: { authorization: 'Bearer worker-token' },
    });
    assert.equal(denied.status, 403);
    assert.equal((await jsonRequest(base, '/api/stats/overview', {
      headers: { authorization: 'Bearer worker-token' },
    })).status, 403);
  });
});

test('only a worker in the assigned agency can claim and start an approved report', async () => {
  let assignedAgency = 'roads_maintenance';
  let assignedWorkerId = null;
  let acceptedAt = null;
  let status = 'new';
  const approvedAt = new Date();
  const history = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff
          : params[0] === workerId ? worker
          : params[0] === otherWorkerId ? otherWorker : citizen] };
      }
      if (sql.includes('accepted_at = NOW()')) {
        assert.match(sql, /r\.assigned_agency = \$3/);
        if (acceptedAt || status !== 'new' || params[2] !== assignedAgency ||
            (assignedWorkerId && params[1] !== assignedWorkerId)) return { rows: [] };
        assignedWorkerId = params[1];
        acceptedAt = new Date();
        return { rows: [{ id: '1', assigned_worker_id: assignedWorkerId, accepted_at: acceptedAt }] };
      }
      if (sql.includes('COUNT(*)') && sql.includes('assigned_worker_id')) {
        return { rows: [{ total: assignedWorkerId === params[0] ||
          (!assignedWorkerId && assignedAgency === params[1]) ? 1 : 0 }] };
      }
      if (sql.includes('FROM public.reports r') && sql.includes('r.assigned_worker_id = $1')) {
        return { rows: assignedWorkerId === params[0] ||
          (!assignedWorkerId && assignedAgency === params[1]) ? [{ id: '1', category: 'pothole', status,
          assigned_at: new Date(), accepted_at: acceptedAt, approved_at: approvedAt,
          image_path: 'images/one.jpg', latitude: 32.88, longitude: 13.19,
          created_at: new Date() }] : [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql)) return { rows: [] };
          if (sql.includes('FOR UPDATE')) return { rows: [{ status, approved_at: approvedAt,
            assigned_worker_id: assignedWorkerId, accepted_at: acceptedAt }] };
          if (sql.includes("SET status = 'in_progress'")) {
            status = 'in_progress';
            return { rows: [{ id: '1', status, work_started_at: new Date() }] };
          }
          if (sql.includes('INSERT INTO public.status_history')) {
            history.push(params);
            return { rows: [] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };
  const headers = (token) => ({ authorization: `Bearer ${token}` });
  const patch = (base, path, token, body) => jsonRequest(base, path, {
    method: 'PATCH', headers: { ...headers(token), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    assert.equal((await jsonRequest(base, '/api/reports/staff/workers', {
      headers: headers('staff-token'),
    })).status, 404);
    assert.equal((await patch(base, '/api/reports/1/assign', 'staff-token',
      { agency: 'roads_maintenance' })).status, 404);
    assert.equal((await jsonRequest(base, '/api/reports/field/assigned', {
      headers: headers('staff-token'),
    })).status, 403);
    const assigned = await jsonRequest(base, '/api/reports/field/assigned', {
      headers: headers('worker-token'),
    });
    assert.equal(assigned.body.items[0].id, '1');
    assert.equal(Object.hasOwn(assigned.body.items[0], 'reporter_phone'), false);
    assert.equal((await jsonRequest(base, '/api/reports/field/assigned', {
      headers: headers('other-worker-token'),
    })).body.items.length, 0);
    assert.equal((await patch(base, '/api/reports/1/status', 'staff-token',
      { status: 'in_progress' })).status, 409);
    assert.equal((await patch(base, '/api/reports/1/start', 'worker-token')).status, 409);
    assert.equal((await patch(base, '/api/reports/1/accept', 'other-worker-token')).status, 409);
    assert.equal(status, 'new');
    assert.equal((await patch(base, '/api/reports/1/accept', 'staff-token')).status, 403);
    assert.equal((await patch(base, '/api/reports/1/accept', 'worker-token')).status, 200);
    assert.equal((await patch(base, '/api/reports/1/start', 'other-worker-token')).status, 409);
    assert.equal((await patch(base, '/api/reports/1/accept', 'worker-token')).status, 409);
    assert.equal((await patch(base, '/api/reports/1/start', 'worker-token')).status, 200);
    assert.equal(status, 'in_progress');
    assert.deepEqual(history, [['1', workerId]]);
    assert.equal((await patch(base, '/api/reports/1/start', 'worker-token')).status, 409);
  });
});

test('field concern pauses public visibility until staff reviews it, without worker rejection', async () => {
  const approvedAt = new Date();
  let issue = null;
  let status = 'new';
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff : params[0] === workerId ? worker
          : params[0] === otherWorkerId ? otherWorker : citizen] };
      }
      if (sql.includes('FROM public.reports r') && sql.includes('r.assigned_worker_id = $1')) {
        assert.match(sql, /NOT EXISTS \(SELECT 1 FROM public\.field_issue_reviews/);
        if (sql.includes('COUNT(*)')) return { rows: [{ total: issue ? 0 : 1 }] };
        return { rows: issue ? [] : [{ id: '1', category: 'pothole', status,
          latitude: 32.88, longitude: 13.19, created_at: approvedAt,
          assigned_worker_id: null, assigned_agency: worker.agency }] };
      }
      if (sql.includes('FROM public.reports r') && sql.includes('r.approved_at IS NOT NULL')) {
        assert.match(sql, /NOT EXISTS \(SELECT 1 FROM public\.field_issue_reviews/);
        return { rows: issue ? [] : [{ id: '1', category: 'pothole', status,
          latitude: 32.88, longitude: 13.19, created_at: approvedAt }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql)) return { rows: [] };
          if (sql.includes('FROM public.reports WHERE id = $1 FOR UPDATE')) {
            return { rows: [{ id: '1', status, approved_at: approvedAt,
              assigned_worker_id: null, assigned_agency: worker.agency }] };
          }
          if (sql.includes('FROM public.field_issue_reviews') && sql.includes('decision IS NULL')) {
            return { rows: issue ? [{ id: issue.id }] : [] };
          }
          if (sql.includes('FROM public.work_completion_reviews') && sql.includes('decision IS NULL')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO public.field_issue_reviews')) {
            issue = { id: '9', reason: params[2], note: params[3] };
            return { rows: [{ id: issue.id, report_id: '1', ...issue }] };
          }
          if (sql.includes('UPDATE public.field_issue_reviews')) {
            assert.equal(params[1], 'continue');
            issue = null;
            return { rows: [{ id: '9', report_id: '1', decision: 'continue' }] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };
  const request = (base, path, token, method, body) => jsonRequest(base, path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const publicPath = '/api/reports/public?bbox=13,32,14,33';
    const workerPath = '/api/reports/field/assigned';
    assert.equal((await jsonRequest(base, publicPath)).body.items.length, 1);
    assert.equal((await request(base, workerPath, 'worker-token')).body.items.length, 1);
    assert.equal((await request(base, '/api/reports/1/field-issue', 'other-worker-token',
      'POST', { reason: 'not_found', note: 'لا توجد حفرة' })).status, 409);
    assert.equal((await request(base, '/api/reports/1/field-issue', 'worker-token',
      'POST', { reason: 'not_found', note: '' })).status, 400);
    const raised = await request(base, '/api/reports/1/field-issue', 'worker-token',
      'POST', { reason: 'not_found', note: 'لم أجد المشكلة في الموقع' });
    assert.equal(raised.status, 201);
    assert.equal(raised.body.reason, 'not_found');
    assert.equal((await jsonRequest(base, publicPath)).body.items.length, 0);
    assert.equal((await request(base, workerPath, 'worker-token')).body.items.length, 0);
    assert.equal((await request(base, '/api/reports/1/field-issue', 'worker-token',
      'POST', { reason: 'other', note: 'مرة ثانية' })).status, 409);
    assert.equal((await request(base, '/api/reports/1/field-issue/review', 'worker-token',
      'PATCH', { decision: 'continue' })).status, 403);
    assert.equal((await request(base, '/api/reports/1/field-issue/review', 'staff-token',
      'PATCH', { decision: 'continue', note: 'الموقع صحيح' })).status, 200);
    assert.equal((await jsonRequest(base, publicPath)).body.items.length, 1);
    assert.equal((await request(base, workerPath, 'worker-token')).body.items.length, 1);
    assert.equal(status, 'new');
  });
});

test('staff can correct a field-reported location or reject with a citizen-facing reason', async () => {
  let status = 'in_progress';
  let pending = true;
  let location = [32.88, 13.19];
  const history = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff : worker] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql)) return { rows: [] };
          if (sql.includes('FROM public.reports WHERE id = $1 FOR UPDATE')) {
            return { rows: [{ id: '1', status, category: 'pothole', approved_at: new Date(),
              assigned_worker_id: workerId }] };
          }
          if (sql.includes('FROM public.field_issue_reviews') && sql.includes('FOR UPDATE')) {
            return { rows: pending ? [{ id: '9' }] : [] };
          }
          if (sql.includes('UPDATE public.reports SET latitude = $2')) {
            location = [params[1], params[2]];
            return { rows: [] };
          }
          if (sql.includes("UPDATE public.reports SET status = 'rejected'")) {
            status = 'rejected';
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO public.status_history')) {
            history.push(params);
            return { rows: [] };
          }
          if (sql.includes('UPDATE public.field_issue_reviews')) {
            pending = false;
            return { rows: [{ id: '9', report_id: '1', decision: params[1] }] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };
  const decide = (base, token, body) => jsonRequest(base, '/api/reports/1/field-issue/review', {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`,
      'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    assert.equal((await decide(base, 'worker-token', {
      decision: 'reject', note: 'وهمي',
    })).status, 403);
    assert.equal((await decide(base, 'staff-token', {
      decision: 'correct_location', latitude: 32.9,
    })).status, 400);
    assert.equal((await decide(base, 'staff-token', {
      decision: 'correct_location', latitude: 32.95, longitude: 13.3,
    })).status, 422);
    assert.deepEqual(location, [32.88, 13.19]);
    assert.equal(pending, true);
    assert.equal((await decide(base, 'staff-token', {
      decision: 'correct_location', latitude: 32.885, longitude: 13.2,
    })).status, 200);
    assert.deepEqual(location, [32.885, 13.2]);
    assert.equal(status, 'in_progress');
    pending = true;
    assert.equal((await decide(base, 'staff-token', {
      decision: 'reassign', note: 'إجراء مؤجل',
    })).status, 400);
    assert.equal((await decide(base, 'staff-token', {
      decision: 'reject', note: '',
    })).status, 400);
    assert.equal((await decide(base, 'staff-token', {
      decision: 'reject', note: 'تأكد الفريق من عدم وجود المشكلة',
    })).status, 200);
    assert.equal(status, 'rejected');
    assert.equal(history.at(-1)[3], 'تأكد الفريق من عدم وجود المشكلة');
  });
});

test('a worker submits finished work and only staff can confirm or return it', async () => {
  let status = 'in_progress';
  let pending = null;
  let nextId = 1;
  const history = [];
  const completionImage = await sharp({ create: {
    width: 4, height: 4, channels: 3, background: '#55aa66',
  } }).jpeg().toBuffer();
  const storage = fakeStorage();
  let removedImages = 0;
  storage.remove = async () => { removedImages += 1; };
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff
          : params[0] === workerId ? worker
            : params[0] === otherWorkerId ? otherWorker : citizen] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      return { async query(sql, params = []) {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('FROM public.reports WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ id: '1', status, approved_at: new Date(),
            assigned_worker_id: workerId, work_started_at: new Date() }] };
        }
        if (sql.includes('AS field_issue') && sql.includes('AS completion')) {
          return { rows: [{ field_issue: false, completion: Boolean(pending) }] };
        }
        if (sql.includes('INSERT INTO public.work_completion_reviews')) {
          pending = { id: String(nextId++), report_id: '1', note: params[2],
            after_image_path: params[3], photo_latitude: params[4],
            photo_longitude: params[5], photo_accuracy_m: params[6],
            submitted_at: new Date() };
          return { rows: [pending] };
        }
        if (sql.includes('FROM public.work_completion_reviews') && sql.includes('FOR UPDATE')) {
          return { rows: pending ? [{ id: pending.id }] : [] };
        }
        if (sql.includes("UPDATE public.reports SET status = 'resolved'")) {
          status = 'resolved'; return { rows: [] };
        }
        if (sql.includes('INSERT INTO public.status_history')) {
          history.push(params); return { rows: [] };
        }
        if (sql.includes('UPDATE public.work_completion_reviews')) {
          const result = { id: pending.id, report_id: '1', decision: params[1],
            decision_note: params[2], decided_at: new Date() };
          pending = null;
          return { rows: [result] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }, release() {} };
    },
  };
  const request = (base, path, token, method, body) => jsonRequest(base, path, {
    method, headers: { authorization: `Bearer ${token}`,
      'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  await withServer({ pool, authClientFactory, storage }, async (base) => {
    const submit = (token, body = {}) => {
      const form = new FormData();
      if (body.image !== false) form.append('image',
        new Blob([completionImage], { type: 'image/jpeg' }), 'after.jpg');
      if (body.note !== undefined) form.append('note', body.note);
      if (body.photo_latitude !== undefined) form.append('photo_latitude', body.photo_latitude);
      if (body.photo_longitude !== undefined) form.append('photo_longitude', body.photo_longitude);
      if (body.photo_accuracy_m !== undefined) form.append('photo_accuracy_m', body.photo_accuracy_m);
      return jsonRequest(base, '/api/reports/1/completion', {
        method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
      });
    };
    const review = (token, body) => request(base, '/api/reports/1/completion/review',
      token, 'PATCH', body);
    assert.equal((await submit('staff-token')).status, 403);
    assert.equal((await submit('other-worker-token')).status, 409);
    assert.equal((await submit('worker-token', { image: false })).status, 400);
    assert.equal((await submit('worker-token', { note: 'x'.repeat(501) })).status, 400);
    assert.equal((await submit('worker-token', { photo_latitude: '32.8' })).status, 400);
    assert.equal((await submit('worker-token', {
      photo_latitude: '32.88', photo_longitude: '13.19', photo_accuracy_m: '12',
    })).status, 201);
    assert.equal(status, 'in_progress');
    assert.equal(storage.uploads, 2);
    assert.equal(removedImages, 1); // The wrong worker's unused image is cleaned up.
    assert.equal(pending.after_image_path, 'images/test.jpg');
    assert.deepEqual([pending.photo_latitude, pending.photo_longitude,
      pending.photo_accuracy_m], [32.88, 13.19, 12]);
    assert.equal((await submit('worker-token')).status, 409);
    assert.equal((await review('citizen-token', { decision: 'confirmed' })).status, 403);
    assert.equal((await review('staff-token', { decision: 'returned' })).status, 400);
    assert.equal((await review('staff-token', {
      decision: 'returned', note: 'يحتاج الموقع إلى تنظيف إضافي',
    })).status, 200);
    assert.equal(status, 'in_progress');
    assert.equal((await submit('worker-token', { note: 'أُنجز التنظيف' })).status, 201);
    assert.equal((await review('staff-token', { decision: 'confirmed' })).status, 200);
    assert.equal(status, 'resolved');
    assert.deepEqual(history, [['1', staffId]]);
    assert.equal((await review('staff-token', { decision: 'confirmed' })).status, 409);
    assert.equal((await submit('worker-token')).status, 409);
  });
});

test('public reports never return identity fields or rejected reports', async () => {
  const row = {
    id: '1', category: 'pothole', description: 'حفرة', image_path: 'images/one.jpg',
    latitude: 32.88, longitude: 13.19, address_text: null, status: 'new',
    created_at: new Date('2026-09-23T12:00:00Z'), updated_at: new Date(),
    user_id: citizenId, reporter_phone: citizen.phone,
  };
  const pool = {
    async query(sql, params) {
      assert.match(sql, /r\.status <> 'rejected'/);
      assert.match(sql, /r\.approved_at IS NOT NULL/);
      if (params.length === 1 && params[0] === '2') return { rows: [] };
      if (params.length > 1) assert.deepEqual(params, [32, 33, 13, 14, 501]);
      return { rows: [row] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const list = await jsonRequest(base, '/api/reports/public?bbox=13,32,14,33');
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    for (const field of ['user_id', 'reporter_phone', 'image_path', 'updated_at', 'image_url', 'description']) {
      assert.equal(Object.hasOwn(list.body.items[0], field), false);
    }

    const detail = await jsonRequest(base, '/api/reports/1/public');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.image_url, 'https://example.test/signed');
    assert.equal(Object.hasOwn(detail.body, 'user_id'), false);
    assert.equal((await jsonRequest(base, '/api/reports/2/public')).status, 404);
    assert.equal((await jsonRequest(base, '/api/reports/public?bbox=13,32,14,33&status=rejected')).status, 400);
  });
});

test('staff routes read the database role before returning reporter contact details', async () => {
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff : citizen] };
      }
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 1 }] };
      return { rows: [{ id: '1', image_path: 'images/one.jpg', reporter_phone: citizen.phone }] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const citizenView = await jsonRequest(base, '/api/reports/staff', {
      headers: { authorization: 'Bearer citizen-token' },
    });
    assert.equal(citizenView.status, 403);

    const staffView = await jsonRequest(base, '/api/reports/staff?page=1&limit=25', {
      headers: { authorization: 'Bearer staff-token' },
    });
    assert.equal(staffView.status, 200);
    assert.equal(staffView.body.items[0].reporter_phone, citizen.phone);
    assert.equal(staffView.body.total_pages, 1);
  });
});

test('staff map includes pending reports without exposing them to citizens', async () => {
  const rows = [
    { id: '7', category: 'pothole', latitude: 32.88, longitude: 13.19,
      status: 'new', created_at: new Date('2026-10-14T10:00:00Z'), approved_at: null,
      description: 'private description', reporter_phone: citizen.phone },
    { id: '6', category: 'garbage', latitude: 32.89, longitude: 13.20,
      status: 'in_progress', created_at: new Date('2026-10-13T10:00:00Z'), approved_at: new Date(),
      description: 'private description', reporter_phone: citizen.phone },
  ];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff : citizen] };
      }
      assert.match(sql, /r\.status <> 'rejected'/);
      assert.doesNotMatch(sql, /r\.approved_at IS NOT NULL/);
      assert.deepEqual(params, [32, 33, 13, 14, 501]);
      return { rows };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const path = '/api/reports/staff/map?bbox=13,32,14,33';
    assert.equal((await jsonRequest(base, path)).status, 401);
    assert.equal((await jsonRequest(base, path, {
      headers: { authorization: 'Bearer citizen-token' },
    })).status, 403);
    const result = await jsonRequest(base, path, {
      headers: { authorization: 'Bearer staff-token' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.items.length, 2);
    assert.equal(result.body.items[0].approved_at, null);
    assert.ok(result.body.items[1].approved_at);
    for (const item of result.body.items) {
      assert.equal(Object.hasOwn(item, 'description'), false);
      assert.equal(Object.hasOwn(item, 'reporter_phone'), false);
    }
  });
});

test('new reports stay private until a staff member approves them', async () => {
  let approvedAt = null;
  const report = {
    id: '1', category: 'pothole', description: 'حفرة', image_path: 'images/one.jpg',
    latitude: 32.88, longitude: 13.19, status: 'new',
    created_at: new Date('2026-10-14T10:00:00Z'),
  };
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff : citizen] };
      }
      if (sql.includes('UPDATE public.reports r') && sql.includes('approved_at = NOW()')) {
        assert.equal(params[1], staffId);
        assert.equal(params[2], 'roads_maintenance');
        if (approvedAt) return { rows: [] };
        approvedAt = new Date();
        return { rows: [{ ...report, approved_at: approvedAt,
          assigned_agency: params[2], assigned_at: approvedAt }] };
      }
      if (sql.includes('SELECT id FROM public.reports WHERE id')) {
        return { rows: [{ id: '1' }] };
      }
      if (sql.includes('FROM public.reports r') && sql.includes('approved_at IS NOT NULL')) {
        return { rows: approvedAt ? [{ ...report, approved_at: approvedAt }] : [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
          if (sql.includes('FROM public.reports') && sql.includes('FOR UPDATE')) {
            return { rows: [{ ...report, approved_at: approvedAt }] };
          }
          if (sql.includes('FROM public.report_verifications')) return { rows: [] };
          return pool.query(sql, params);
        },
        release() {},
      };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const list = () => jsonRequest(base, '/api/reports/public?bbox=13,32,14,33');
    assert.equal((await list()).body.items.length, 0);
    assert.equal((await jsonRequest(base, '/api/reports/1/public')).status, 404);
    const citizenApproval = await jsonRequest(base, '/api/reports/1/approve', {
      method: 'PATCH', headers: { authorization: 'Bearer citizen-token' },
    });
    assert.equal(citizenApproval.status, 403);
    const approve = () => jsonRequest(base, '/api/reports/1/approve', {
      method: 'PATCH', headers: { authorization: 'Bearer staff-token' },
    });
    assert.equal((await approve()).status, 200);
    assert.equal((await approve()).status, 409);
    assert.equal((await list()).body.items.length, 1);
    assert.equal((await jsonRequest(base, '/api/reports/1/public')).status, 200);
  });
});

test('pending reports cannot move to in progress before approval', async () => {
  let status = 'new';
  const pool = {
    async query(sql) {
      assert.match(sql, /FROM public\.profiles WHERE id/);
      return { rows: [staff] };
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
          if (sql.includes('FOR UPDATE')) return { rows: [{ status, approved_at: null }] };
          if (sql.includes('UPDATE public.reports')) {
            status = params[0];
            return { rows: [{ id: '1', status }] };
          }
          if (sql.includes('INSERT INTO public.status_history')) return { rows: [] };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const change = (body) => jsonRequest(base, '/api/reports/1/status', {
      method: 'PATCH',
      headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal((await change({ status: 'in_progress' })).status, 409);
    assert.equal(status, 'new');
    assert.equal((await change({ status: 'rejected', reason: 'صورة غير واضحة' })).status, 200);
    assert.equal(status, 'rejected');
  });
});

test('staff details include status history and stay hidden from citizens', async () => {
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff : citizen] };
      }
      if (sql.trimStart().startsWith('SELECT h.id')) {
        return { rows: [{ old_status: 'new', new_status: 'rejected',
          change_reason: 'مكرر', changed_by: staffId }] };
      }
      if (sql.includes('FROM public.work_completion_reviews wc')) {
        return { rows: [{ id: '7', after_image_path: 'images/after.jpg',
          photo_latitude: 32.88, photo_longitude: 13.19, photo_accuracy_m: 12,
          worker_name: 'عامل ميداني', decision: 'confirmed' }] };
      }
      const approver = sql.includes('LEFT JOIN public.profiles approver ON approver.id = r.approved_by');
      return { rows: [{ id: '1', image_path: 'images/one.jpg',
        reporter_phone: citizen.phone, status: 'rejected',
        approved_by_name: approver ? 'موظف' : undefined }] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const citizenView = await jsonRequest(base, '/api/reports/1/staff', {
      headers: { authorization: 'Bearer citizen-token' },
    });
    assert.equal(citizenView.status, 403);
    const staffView = await jsonRequest(base, '/api/reports/1/staff', {
      headers: { authorization: 'Bearer staff-token' },
    });
    assert.equal(staffView.status, 200);
    assert.equal(staffView.body.report.reporter_phone, citizen.phone);
    assert.equal(staffView.body.report.approved_by_name, 'موظف');
    assert.equal(staffView.body.status_history[0].change_reason, 'مكرر');
    assert.equal(staffView.body.completions[0].after_image_url, 'https://example.test/signed');
    assert.equal(staffView.body.completions[0].after_image_path, undefined);
  });
});

test('status changes are transactional and only allow the approved sequence', async () => {
  let status = 'new';
  const operations = [];
  const pool = {
    async query(sql, params) {
      assert.match(sql, /FROM public\.profiles WHERE id/);
      return { rows: [staff] };
    },
    async connect() {
      return {
        async query(sql, params = []) {
          operations.push(sql.split(' ')[0]);
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('FOR UPDATE')) return { rows: [{ status, approved_at: new Date() }] };
          if (sql.includes('UPDATE public.reports')) {
            status = params[0];
            return { rows: [{ id: '1', status, image_path: 'images/one.jpg' }] };
          }
          if (sql.includes('INSERT INTO public.status_history')) {
            if (params[2] === 'rejected') assert.equal(params[4], 'مكرر');
            return { rows: [] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };

  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const change = (body) => jsonRequest(base, '/api/reports/1/status', {
      method: 'PATCH', headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal((await change({ status: 'resolved' })).status, 409);
    assert.equal(status, 'new');
    assert.equal(operations.includes('COMMIT'), false);

    assert.equal((await change({ status: 'in_progress' })).status, 409);
    assert.equal(status, 'new');
    status = 'in_progress'; // A separate field-worker confirmation owns this transition.
    assert.equal((await change({ status: 'resolved' })).status, 409);
    assert.equal(status, 'in_progress');

    assert.equal((await change({ status: 'rejected' })).status, 400);
    assert.equal((await change({ status: 'rejected', reason: 'مكرر' })).status, 200);
    assert.equal(status, 'rejected');
    assert.ok(operations.includes('COMMIT'));
    assert.equal((await change({ status: 'rejected', reason: 'مكرر' })).status, 409);
    assert.equal((await change({ status: 'new' })).status, 409);
  });
});

// A citizen's reports table: answers the retry lookup, the daily count and the insert.
function citizenReportsPool({ sentToday = 0 } = {}) {
  const saved = new Map();
  const operations = [];
  const query = async (sql, params) => {
    operations.push(sql);
    if (sql.includes('FROM public.profiles WHERE id')) return { rows: [citizen] };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('client_request_id = $2')) return { rows: saved.has(params[1]) ? [saved.get(params[1])] : [] };
    if (sql.includes("AT TIME ZONE 'Africa/Tripoli'")) return { rows: [{ total: sentToday + saved.size }] };
    if (sql.includes('INSERT INTO public.reports')) {
      const row = {
        id: String(saved.size + 1), category: params[2], description: null, image_path: params[4],
        latitude: 32.88, longitude: 13.19, address_text: null, status: 'new',
        created_at: new Date(), updated_at: new Date(),
      };
      saved.set(params[1], row);
      return { rows: [row] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  return { query, operations, async connect() { return { query, release() {} }; } };
}

async function sendReport(base, requestId) {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .png().toBuffer();
  const form = new FormData();
  form.set('category', 'garbage');
  form.set('latitude', '32.88');
  form.set('longitude', '13.19');
  form.set('client_request_id', requestId);
  form.set('image', new Blob([image], { type: 'image/png' }), 'image.png');
  return jsonRequest(base, '/api/reports', {
    method: 'POST', headers: { authorization: 'Bearer citizen-token' }, body: form,
  });
}

test('repeating a report request does not upload or create another report', async () => {
  const pool = citizenReportsPool();
  const storage = fakeStorage();
  const requestId = '33333333-3333-4333-8333-333333333333';

  await withServer({ pool, authClientFactory, storage }, async (base) => {
    assert.equal((await sendReport(base, requestId)).status, 201);
    assert.equal((await sendReport(base, requestId)).status, 200);
    assert.equal(storage.uploads, 1);
    assert.ok(pool.operations.some((sql) => sql.includes('pg_advisory_xact_lock')));
    assert.ok(pool.operations.includes('COMMIT'));
  });
});

test('a citizen can send ten reports a day, and an eleventh is refused before upload', async () => {
  const pool = citizenReportsPool({ sentToday: 9 });
  const storage = fakeStorage();
  const tenth = '44444444-4444-4444-8444-444444444444';

  await withServer({ pool, authClientFactory, storage }, async (base) => {
    assert.equal((await sendReport(base, tenth)).status, 201);
    const eleventh = await sendReport(base, '55555555-5555-4555-8555-555555555555');
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.body.error, 'daily report limit reached');
    assert.equal(storage.uploads, 1);
    // Resending the tenth report still returns it; the limit only stops new ones.
    assert.equal((await sendReport(base, tenth)).status, 200);
  });
});

test('uploaded images are re-encoded without source metadata', async () => {
  const original = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'red' },
  }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'private' } } }).toBuffer();
  assert.ok((await sharp(original).metadata()).exif);

  const cleaned = await prepareImage({ mimetype: 'image/jpeg', buffer: original });
  const metadata = await sharp(cleaned).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.exif, undefined);
});

test('staff pages use the requested filter and offset', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) return { rows: [staff] };
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 60 }] };
      return { rows: [] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const result = await jsonRequest(base,
      '/api/reports/staff?category=garbage&page=2&limit=25',
      { headers: { authorization: 'Bearer staff-token' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.total_pages, 3);
    assert.deepEqual(queries[0].params, ['garbage']);
    assert.deepEqual(queries[1].params, ['garbage', 25, 25]);
    assert.match(queries[1].sql, /AS assigned_worker_name/);

    queries.length = 0;
    const unclaimed = await jsonRequest(base, '/api/reports/staff?acceptance=pending',
      { headers: { authorization: 'Bearer staff-token' } });
    assert.equal(unclaimed.status, 200);
    assert.match(queries[0].sql,
      /r\.approved_at IS NOT NULL AND r\.status = 'new' AND r\.accepted_at IS NULL/);
    assert.equal((await jsonRequest(base, '/api/reports/staff?acceptance=done',
      { headers: { authorization: 'Bearer staff-token' } })).status, 400);
  });
});

test('staff can find one pending report and review oldest first', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) return { rows: [staff] };
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 1 }] };
      return { rows: [] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const result = await jsonRequest(base,
      '/api/reports/staff?review=pending&report_id=42&sort=oldest&limit=10',
      { headers: { authorization: 'Bearer staff-token' } });
    assert.equal(result.status, 200);
    assert.deepEqual(queries[0].params, ['42']);
    assert.match(queries[0].sql, /r\.approved_at IS NULL/);
    assert.match(queries[0].sql, /r\.id = \$1/);
    assert.deepEqual(queries[1].params, ['42', 10, 0]);
    assert.match(queries[1].sql, /ORDER BY r\.created_at ASC, r\.id ASC/);

    const invalid = await jsonRequest(base, '/api/reports/staff?report_id=not-a-number',
      { headers: { authorization: 'Bearer staff-token' } });
    assert.equal(invalid.status, 400);
    const invalidSort = await jsonRequest(base, '/api/reports/staff?sort=random',
      { headers: { authorization: 'Bearer staff-token' } });
    assert.equal(invalidSort.status, 400);
  });
});

test('staff completion queue selects pending work by submission time', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) return { rows: [staff] };
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 1 }] };
      return { rows: [] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const result = await jsonRequest(base,
      '/api/reports/staff?completion=pending&sort=newest&date=2026-10-21',
      { headers: { authorization: 'Bearer staff-token' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.total, 1);
    assert.match(queries[0].sql, /FROM public\.work_completion_reviews wc/);
    assert.match(queries[0].sql, /wc\.decision IS NULL/);
    assert.match(queries[1].sql, /ORDER BY \(SELECT wc\.submitted_at/);
    assert.match(queries[1].sql, /AS completion_submitted_at/);
    assert.match(queries[0].sql, /\(SELECT wc\.submitted_at[\s\S]*?\) >= \(\$1::date AT TIME ZONE 'Africa\/Tripoli'\)/);
  });
});

test('worker active list excludes pending concerns and resolved list stays separate', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) return { rows: [worker] };
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const headers = { authorization: 'Bearer worker-token' };
    assert.equal((await jsonRequest(base, '/api/reports/field/assigned', { headers })).status, 200);
    assert.match(queries[0].sql, /r\.status IN \('new', 'in_progress'\)/);
    assert.match(queries[0].sql, /NOT EXISTS \(SELECT 1 FROM public\.field_issue_reviews/);
    assert.match(queries[1].sql, /AS field_issue_pending/);
    assert.match(queries[1].sql, /AS field_issue_note/);
    queries.length = 0;
    assert.equal((await jsonRequest(base, '/api/reports/field/assigned?view=resolved', { headers })).status, 200);
    assert.match(queries[0].sql, /r\.assigned_worker_id = \$1 AND r\.status = 'resolved'/);
    assert.equal(queries[0].params.length, 1);
    assert.match(queries[1].sql, /ORDER BY r\.updated_at DESC/);
    assert.match(queries[1].sql, /LIMIT \$2 OFFSET \$3/);
    assert.equal(queries[1].params.length, 3);
    assert.equal((await jsonRequest(base, '/api/reports/field/assigned?view=other', { headers })).status, 400);
  });
});

test('field review date uses the concern time and overview counts all decision queues', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) return { rows: [staff] };
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 2 }] };
      return { rows: [] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const headers = { authorization: 'Bearer staff-token' };
    const review = await jsonRequest(base, '/api/reports/staff?field_review=pending&date=2026-10-21', { headers });
    assert.equal(review.status, 200);
    assert.match(queries[0].sql, /\(SELECT fi\.raised_at[\s\S]*?\) >= \(\$1::date AT TIME ZONE 'Africa\/Tripoli'\)/);
    queries.length = 0;
    const overview = await jsonRequest(base, '/api/stats/overview', { headers });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.pending_review, 2);
    assert.equal(overview.body.pending_field_review, 2);
    assert.equal(overview.body.pending_completion, 2);
    assert.equal(queries.length, 6);
  });
});

test('staff can correct a pending category before automatic assignment', async () => {
  let category = 'pothole';
  let approved = false;
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff : citizen] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      return { async query(sql, params = []) {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('FROM public.reports') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: '1', category, status: 'new', approved_at: approved ? new Date() : null }] };
        }
        if (sql.includes('FROM public.report_verifications')) return { rows: [] };
        if (sql.includes('UPDATE public.reports r SET category')) {
          category = params[1];
          return { rows: [{ id: '1', category }] };
        }
        if (sql.includes('UPDATE public.reports r SET approved_at')) {
          assert.equal(params[2], 'water_sewer');
          approved = true;
          return { rows: [{ id: '1', category, assigned_agency: params[2] }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }, release() {} };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const patch = (route, token, body) => jsonRequest(base, `/api/reports/1/${route}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${token}`,
        'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal((await patch('category', 'citizen-token', { category: 'water_leak' })).status, 403);
    assert.equal((await patch('category', 'staff-token', { category: 'invalid' })).status, 400);
    assert.equal((await patch('category', 'staff-token', { category: 'water_leak' })).status, 200);
    assert.equal(category, 'water_leak');
    assert.equal((await patch('approve', 'staff-token', {})).body.assigned_agency, 'water_sewer');
    assert.equal((await patch('category', 'staff-token', { category: 'garbage' })).status, 409);
  });
});

test('citizen reports are scoped to the owner before filtering and paging', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) return { rows: [citizen] };
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 26 }] };
      return { rows: [{ id: '42', status: 'in_progress', category: 'pothole',
        latitude: 32.89, longitude: 13.19, image_path: 'images/test.jpg' }] };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const result = await jsonRequest(base,
      '/api/reports/mine?status=in_progress&page=2&limit=25',
      { headers: { authorization: 'Bearer citizen-token' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.total_pages, 2);
    assert.equal(result.body.items[0].image_url, 'https://example.test/signed');
    assert.match(queries[0].sql, /r\.user_id = \$1 AND r\.status = \$2/);
    assert.match(queries[1].sql, /r\.user_id = \$1 AND r\.status = \$2/);
    assert.deepEqual(queries[0].params, [citizenId, 'in_progress']);
    assert.deepEqual(queries[1].params, [citizenId, 'in_progress', 25, 25]);
    const invalid = await jsonRequest(base, '/api/reports/mine?status=invalid',
      { headers: { authorization: 'Bearer citizen-token' } });
    assert.equal(invalid.status, 400);
    const noAuth = await jsonRequest(base, '/api/reports/mine');
    assert.equal(noAuth.status, 401);
  });
});

test('preapproval verification stays private, is limited to the responsible agency, and returns the decision to staff', async () => {
  let approved = false;
  let verification = null;
  const report = { id: '81', category: 'pothole', status: 'new', approved_at: null,
    image_path: 'images/private.jpg', latitude: 32.88, longitude: 13.19,
    description: 'حفرة تحتاج فحصًا', created_at: new Date() };
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === staffId ? staff
          : params[0] === workerId ? worker
            : params[0] === citizenId ? citizen : otherWorker] };
      }
      if (sql.includes('COUNT(*)') && sql.includes('report_verifications')) {
        return { rows: [{ total: verification?.result === null &&
          params[0] === 'roads_maintenance' &&
          (!verification.claimed_by || params[1] === verification.claimed_by) ? 1 : 0 }] };
      }
      if (sql.includes('FROM public.report_verifications v') && sql.includes('JOIN public.reports r')) {
        return { rows: verification?.result === null &&
          params[0] === 'roads_maintenance' &&
          (!verification.claimed_by || params[1] === verification.claimed_by)
          ? [{ ...report, verification_id: verification.id,
            request_note: verification.request_note, requested_at: verification.requested_at,
            claimed_by: verification.claimed_by }] : [] };
      }
      if (sql.includes('UPDATE public.report_verifications v') && sql.includes('result = $3')) {
        if (!verification || verification.result || verification.claimed_by !== params[1] ||
            params[4] !== 'roads_maintenance') return { rows: [] };
        verification.result = params[2]; verification.result_note = params[3];
        return { rows: [{ ...verification }] };
      }
      if (sql.includes('UPDATE public.report_verifications v') && sql.includes('claimed_by = $2')) {
        if (!verification || verification.result || params[2] !== 'roads_maintenance' ||
            (verification.claimed_by && verification.claimed_by !== params[1])) return { rows: [] };
        verification.claimed_by = params[1];
        return { rows: [{ ...verification }] };
      }
      if (sql.includes('UPDATE public.reports r') && sql.includes('approved_at = NOW()')) {
        if (approved || verification?.result === null) return { rows: [] };
        approved = true;
        return { rows: [{ ...report, approved_at: new Date() }] };
      }
      if (sql.includes('SELECT id FROM public.reports WHERE id')) return { rows: [{ id: '81' }] };
      if (sql.includes('FROM public.reports r') && sql.includes('approved_at IS NOT NULL')) {
        return { rows: approved ? [report] : [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params = []) {
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
          if (sql.includes('FROM public.reports') && sql.includes('FOR UPDATE')) {
            return { rows: [{ ...report, approved_at: approved ? new Date() : null }] };
          }
          if (sql.includes('FROM public.report_verifications') && sql.includes('result IS NULL')) {
            return { rows: verification?.result === null ? [verification] : [] };
          }
          if (sql.includes('FROM public.report_verifications') && sql.includes('ORDER BY id DESC')) {
            return { rows: verification ? [verification] : [] };
          }
          if (sql.includes('INSERT INTO public.report_verifications')) {
            verification = { id: '1', report_id: '81', agency: params[1],
              request_note: params[3], requested_at: new Date(),
              claimed_by: null, result: null, corrected_at: null };
            return { rows: [verification] };
          }
          if (sql.includes('UPDATE public.reports SET latitude = $2')) {
            report.latitude = params[1]; report.longitude = params[2];
            return { rows: [] };
          }
          if (sql.includes('UPDATE public.report_verifications SET corrected_latitude')) {
            verification.corrected_at = new Date();
            return { rows: [] };
          }
          if (sql.includes('UPDATE public.reports r') && sql.includes('approved_at = NOW()')) {
            return pool.query(sql, params);
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const patch = (path, token, body) => jsonRequest(base, `/api/reports/81${path}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${token}`,
        'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal((await patch('/verification/request', 'worker-token', { note: 'شك' })).status, 403);
    assert.equal((await patch('/verification/request', 'staff-token', { note: '' })).status, 400);
    assert.equal((await patch('/verification/request', 'staff-token', {
      note: 'الصورة لا توضّح الموقع',
    })).status, 201);
    assert.equal(verification.agency, 'roads_maintenance');
    assert.equal((await patch('/verification/request', 'staff-token', { note: 'مرة أخرى' })).status, 409);
    assert.equal((await jsonRequest(base, '/api/reports/public?bbox=13,32,14,33')).body.items.length, 0);
    assert.equal((await patch('/approve', 'staff-token')).status, 409);
    const list = (token) => jsonRequest(base, '/api/reports/field/verifications', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal((await list('other-worker-token')).body.total, 0);
    assert.equal((await list('worker-token')).body.total, 1);
    assert.equal((await list('citizen-token')).status, 403);
    assert.equal((await patch('/verification/claim', 'other-worker-token')).status, 409);
    assert.equal((await patch('/verification/claim', 'worker-token')).status, 200);
    assert.equal((await patch('/verification/respond', 'other-worker-token', {
      result: 'exists', note: 'رأيتها',
    })).status, 409);
    assert.equal((await patch('/verification/respond', 'worker-token', {
      result: 'exists', note: '',
    })).status, 400);
    assert.equal((await patch('/verification/respond', 'worker-token', {
      result: 'wrong_location', note: 'المشكلة في الشارع المجاور',
    })).status, 200);
    assert.equal((await list('worker-token')).body.total, 0);
    assert.equal((await patch('/approve', 'staff-token')).status, 409);
    assert.equal((await patch('/verification/location', 'staff-token', {
      latitude: 200, longitude: 13.2,
    })).status, 400);
    assert.equal((await patch('/verification/location', 'staff-token', {
      latitude: 32.95, longitude: 13.3,
    })).status, 422);
    assert.equal(report.latitude, 32.88);
    assert.equal((await patch('/verification/location', 'staff-token', {
      latitude: 32.881, longitude: 13.191,
    })).status, 200);
    assert.equal(report.latitude, 32.881);
    assert.equal((await patch('/approve', 'staff-token')).status, 200);
    assert.equal(approved, true);
  });
});

test('staff see same-category reports near a report; citizens cannot ask', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM public.profiles WHERE id')) {
        return { rows: [params[0] === citizen.id ? citizen : staff] };
      }
      queries.push({ sql, params });
      if (sql.includes('FROM public.reports WHERE id = $1')) {
        return { rows: params[0] === '7' ? [{ id: '7', category: 'pothole', latitude: '32.8812', longitude: '13.1910' }] : [] };
      }
      if (sql.includes('distance_m')) {
        return { rows: [{ id: '8', category: 'pothole', status: 'new', approved_at: null, image_path: 'images/8.jpg', distance_m: 38 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  await withServer({ pool, authClientFactory, storage: fakeStorage() }, async (base) => {
    const asStaff = { headers: { authorization: 'Bearer staff-token' } };
    const found = await jsonRequest(base, '/api/reports/7/nearby', asStaff);
    assert.equal(found.status, 200);
    assert.equal(found.body.radius_m, 100);
    assert.equal(found.body.items[0].distance_m, 38);
    assert.equal(found.body.items[0].image_url, 'https://example.test/signed');
    const search = queries.find((q) => q.sql.includes('distance_m'));
    assert.deepEqual(search.params.slice(0, 4), ['7', 'pothole', 32.8812, 13.191]);
    assert.equal(search.params[6], 100);
    assert.match(search.sql, /r\.status <> 'rejected'/);

    assert.equal((await jsonRequest(base, '/api/reports/9/nearby', asStaff)).status, 404);
    assert.equal((await jsonRequest(base, '/api/reports/7/nearby',
      { headers: { authorization: 'Bearer citizen-token' } })).status, 403);
  });
});

test('a new report gets its street name after the response is sent', async () => {
  const reports = citizenReportsPool();
  const addressWrites = [];
  const query = async (sql, params) => {
    if (sql.startsWith('SELECT latitude, longitude FROM public.reports')) {
      return { rows: [{ latitude: 32.88, longitude: 13.19 }] };
    }
    if (sql.includes('SET address_text')) {
      addressWrites.push(params);
      return { rows: [], rowCount: 1 };
    }
    return reports.query(sql, params);
  };
  const pool = { query, async connect() { return { query, release() {} }; } };
  const lookups = [];
  const geocoder = { async reverse(lat, lng) { lookups.push([lat, lng]); return 'شارع عمر المختار'; } };

  await withServer({ pool, authClientFactory, storage: fakeStorage(), geocoder }, async (base) => {
    const created = await sendReport(base, '66666666-6666-4666-8666-666666666666');
    assert.equal(created.status, 201);
    assert.equal(created.body.address_text, null, 'the citizen is not kept waiting for the lookup');
    for (let i = 0; i < 50 && !addressWrites.length; i += 1) await new Promise((done) => setTimeout(done, 10));
    assert.deepEqual(lookups, [[32.88, 13.19]]);
    assert.deepEqual(addressWrites[0].slice(0, 2), ['1', 'شارع عمر المختار']);
  });
});
