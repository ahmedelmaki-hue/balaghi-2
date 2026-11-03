// Integration tests: real routes, real SQL, the real local schema.
// Run with `npm run test:integration` while local Supabase is running.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { startWorld, reportForm, completionForm, BBOX } = require('./helpers');

async function world() {
  const w = await startWorld();
  await w.addCitizen('citizen', 'مواطن الاختبار');
  await w.addAccount('staff', { role: 'staff', fullName: 'موظفة المراجعة' });
  await w.addAccount('worker', { role: 'field_worker', agency: 'roads_maintenance', fullName: 'عامل الطرق' });
  await w.addAccount('waterWorker', { role: 'field_worker', agency: 'water_sewer', fullName: 'عامل المياه' });
  return w;
}

async function approvedReport(w) {
  const created = await w.call('citizen-token', '/reports', { method: 'POST', form: await reportForm() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal((await w.call('staff-token', `/reports/${id}/approve`, { method: 'PATCH' })).status, 200);
  return id;
}

test('a report travels from the citizen to resolved through the real schema', async () => {
  const w = await world();
  try {
    const created = await w.call('citizen-token', '/reports', { method: 'POST', form: await reportForm() });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.equal(created.body.status, 'new');
    assert.equal(created.body.approved_at, null);

    const mine = await w.call('citizen-token', '/reports/mine');
    assert.ok(mine.body.items.some((item) => item.id === id), 'the citizen sees their own report');
    const hidden = await w.call(null, `/reports/public?bbox=${BBOX}`);
    assert.ok(!hidden.body.items.some((item) => item.id === id), 'unapproved reports stay private');

    const pending = await w.call('staff-token', '/reports/staff?review=pending&sort=oldest');
    assert.ok(pending.body.items.some((item) => item.id === id));

    // Pre-approval check by the responsible agency.
    assert.equal((await w.call('staff-token', `/reports/${id}/verification/request`, {
      method: 'PATCH', body: { note: 'الصورة لا تُظهر عمق الحفرة' } })).status, 201);
    const checks = await w.call('worker-token', '/reports/field/verifications');
    assert.ok(checks.body.items.some((item) => item.id === id));
    assert.equal((await w.call('waterWorker-token', '/reports/field/verifications')).body.total, 0);
    assert.equal((await w.call('worker-token', `/reports/${id}/verification/claim`, { method: 'PATCH' })).status, 200);
    assert.equal((await w.call('worker-token', `/reports/${id}/verification/respond`, {
      method: 'PATCH', body: { result: 'exists', note: 'الحفرة موجودة وعمقها 10 سم' } })).status, 200);

    const approved = await w.call('staff-token', `/reports/${id}/approve`, { method: 'PATCH' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.assigned_agency, 'roads_maintenance');
    const shown = await w.call(null, `/reports/public?bbox=${BBOX}`);
    assert.ok(shown.body.items.some((item) => item.id === id), 'approved reports appear on the public map');
    assert.equal((await w.call(null, `/reports/${id}/public`)).body.user_id, undefined);

    const unclaimed = await w.call('staff-token', '/reports/staff?acceptance=pending');
    assert.ok(unclaimed.body.items.some((item) => item.id === id));

    const queue = await w.call('worker-token', '/reports/field/assigned');
    assert.ok(queue.body.items.some((item) => item.id === id));
    assert.equal((await w.call('worker-token', `/reports/${id}/accept`, { method: 'PATCH' })).status, 200);
    const started = await w.call('worker-token', `/reports/${id}/start`, { method: 'PATCH' });
    assert.equal(started.body.status, 'in_progress');

    const submitted = await w.call('worker-token', `/reports/${id}/completion`, { method: 'POST', form: await completionForm() });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    const toConfirm = await w.call('staff-token', '/reports/staff?completion=pending');
    assert.ok(toConfirm.body.items.some((item) => item.id === id));
    assert.equal((await w.call('staff-token', `/reports/${id}/completion/review`, {
      method: 'PATCH', body: { decision: 'confirmed' } })).status, 200);

    const detail = await w.call('staff-token', `/reports/${id}/staff`);
    assert.equal(detail.body.report.status, 'resolved');
    assert.equal(detail.body.report.approved_by_name, 'موظفة المراجعة');
    assert.equal(detail.body.report.assigned_worker_name, 'عامل الطرق');
    assert.deepEqual(detail.body.status_history.map((entry) => entry.new_status), ['in_progress', 'resolved']);
    assert.equal(detail.body.verifications[0].result, 'exists');
    assert.ok(detail.body.completions[0].after_image_url);

    const stats = await w.call('staff-token', '/stats/overview');
    assert.ok(stats.body.byStatus.some((row) => row.status === 'resolved' && row.count >= 1));
  } finally {
    await w.stop();
  }
});

test('a held report returns to its agency, and a field concern can end in rejection', async () => {
  const w = await world();
  try {
    const id = await approvedReport(w);
    await w.call('worker-token', `/reports/${id}/accept`, { method: 'PATCH' });
    await w.call('worker-token', `/reports/${id}/start`, { method: 'PATCH' });

    const released = await w.call('staff-token', `/reports/${id}/release`, {
      method: 'PATCH', body: { reason: 'العامل في إجازة طويلة' } });
    assert.deepEqual(released.body, { id, status: 'new', released_from: 'in_progress' });
    const back = await w.call('staff-token', '/reports/staff?acceptance=pending');
    assert.ok(back.body.items.some((item) => item.id === id), 'it waits for a worker again');

    assert.equal((await w.call('worker-token', `/reports/${id}/accept`, { method: 'PATCH' })).status, 200);
    const concern = await w.call('worker-token', `/reports/${id}/field-issue`, {
      method: 'POST', body: { reason: 'duplicate', note: 'نفس الحفرة في البلاغ السابق' } });
    assert.equal(concern.status, 201);
    const publicView = await w.call(null, `/reports/public?bbox=${BBOX}`);
    assert.ok(!publicView.body.items.some((item) => item.id === id), 'a paused report leaves the public map');

    assert.equal((await w.call('staff-token', `/reports/${id}/field-issue/review`, {
      method: 'PATCH', body: { decision: 'reject', note: 'بلاغ مكرر' } })).status, 200);
    const mine = await w.call('citizen-token', '/reports/mine');
    const report = mine.body.items.find((item) => item.id === id);
    assert.equal(report.status, 'rejected');
    assert.equal(report.rejection_reason, 'بلاغ مكرر');
  } finally {
    await w.stop();
  }
});

test('owners manage accounts and permissions within the real constraints', async () => {
  const w = await world();
  try {
    await w.addAccount('owner', { role: 'admin', owner: true, fullName: 'المسؤول الرئيسي' });
    await w.addAccount('helper', { role: 'admin', permissions: ['manage_workers'], fullName: 'مسؤول العمال' });

    const created = await w.call('owner-token', '/admin/users', { method: 'POST', body: {
      full_name: 'مسؤول السجل', username: `it_audit_${Date.now()}`, role: 'admin', admin_permissions: ['view_audit'] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.user.admin_permissions, ['view_audit']);
    assert.equal(created.body.user.must_change_password, true);

    const granted = await w.call('owner-token', `/admin/users/${created.body.user.id}`, {
      method: 'PATCH', body: { admin_permissions: ['view_audit', 'manage_citizens'] } });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));

    const worker = await w.call('helper-token', '/admin/users', { method: 'POST', body: {
      full_name: 'عامل جديد', username: `it_worker_${Date.now()}`, role: 'field_worker', agency: 'roads_maintenance' } });
    assert.equal(worker.status, 201, JSON.stringify(worker.body));
    assert.equal((await w.call('helper-token', '/admin/citizens')).status, 403);

    const off = await w.call('helper-token', `/admin/users/${worker.body.user.id}/status`, {
      method: 'PATCH', body: { active: false, reason: 'انتهى التدريب' } });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(off.body.user.is_active, false);

    const suspended = await w.call('owner-token', `/admin/citizens/${w.people.citizen.id}/status`, {
      method: 'PATCH', body: { active: false, reason: 'بلاغات كاذبة متكررة' } });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
    assert.equal((await w.call('citizen-token', '/reports/mine')).status, 403, 'a suspended citizen is refused');

    const log = await w.call('owner-token', '/admin/audit?limit=100');
    const actions = log.body.items.map((item) => item.action);
    for (const action of ['account_created', 'account_updated', 'account_deactivated']) {
      assert.ok(actions.includes(action), `audit has ${action}`);
    }
    const listed = await w.call('helper-token', '/admin/users?role=field_worker&search=it_worker');
    assert.equal(listed.status, 200);
    assert.ok(listed.body.items.every((item) => item.role === 'field_worker'));
  } finally {
    await w.stop();
  }
});

test('the schema refuses what the API must never write', async () => {
  const w = await world();
  try {
    const reject = async (sql, params) => {
      await assert.rejects(w.db.query(sql, params), (error) => Boolean(error.code), sql);
    };
    await reject(`UPDATE public.profiles SET admin_permissions = '{delete_everything}' WHERE id = $1`, [w.people.staff.id]);
    await reject(`UPDATE public.profiles SET is_owner = TRUE WHERE id = $1`, [w.people.staff.id]);
    await reject(`UPDATE public.profiles SET is_active = FALSE WHERE id = $1`, [w.people.staff.id]);
    const id = await approvedReport(w);
    await reject(`INSERT INTO public.status_history (report_id, old_status, new_status, changed_by)
      VALUES ($1, 'new', 'rejected', $2)`, [id, w.people.staff.id]);
    await reject(`INSERT INTO public.field_issue_reviews (report_id, worker_id, reason, note, decision, decided_by, decided_at)
      VALUES ($1, $2, 'other', 'ملاحظة', 'reassign', $2, NOW())`, [id, w.people.worker.id]);
    await reject(`UPDATE public.reports SET work_started_at = NOW() WHERE id = $1`, [id]);
  } finally {
    await w.stop();
  }
});

test('a citizen sends ten reports a Tripoli day, and yesterday does not count', async () => {
  const w = await world();
  try {
    const send = async (requestId) => w.call('citizen-token', '/reports', { method: 'POST', form: await reportForm({ requestId }) });
    const sent = [];
    for (let i = 0; i < 10; i += 1) {
      const requestId = randomUUID();
      const created = await send(requestId);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      sent.push({ requestId, id: created.body.id });
    }
    const eleventh = await send(randomUUID());
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.body.error, 'daily report limit reached');
    const retry = await send(sent[9].requestId);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.id, sent[9].id);

    await w.db.query(`UPDATE public.reports SET created_at = created_at - INTERVAL '1 day'
      WHERE user_id = $1`, [w.people.citizen.id]);
    assert.equal((await send(randomUUID())).status, 201);
  } finally {
    await w.stop();
  }
});

test('a reviewer sees same-category reports within 100 m as possible duplicates', async () => {
  const w = await world();
  try {
    const send = async (options) => {
      const created = await w.call('citizen-token', '/reports', { method: 'POST', form: await reportForm(options) });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      return created.body.id;
    };
    const first = await send({});
    const second = await send({ at: { latitude: '32.8815', longitude: '13.1912' } }); // about 40 m away
    const otherKind = await send({ category: 'garbage' });
    const far = await send({ at: { latitude: '32.8842', longitude: '13.1910' } }); // about 330 m away

    const nearby = await w.call('staff-token', `/reports/${first}/nearby`);
    assert.equal(nearby.status, 200, JSON.stringify(nearby.body));
    assert.equal(nearby.body.radius_m, 100);
    const ids = nearby.body.items.map((item) => item.id);
    assert.deepEqual(ids, [second]);
    assert.ok(nearby.body.items[0].distance_m > 20 && nearby.body.items[0].distance_m < 60, nearby.body.items[0].distance_m);
    assert.ok(!ids.includes(otherKind) && !ids.includes(far));

    // A rejected report is no longer a duplicate to point at.
    assert.equal((await w.call('staff-token', `/reports/${second}/status`, {
      method: 'PATCH', body: { status: 'rejected', reason: 'مكرر' },
    })).status, 200);
    assert.deepEqual((await w.call('staff-token', `/reports/${first}/nearby`)).body.items, []);
    assert.equal((await w.call('citizen-token', `/reports/${first}/nearby`)).status, 403);
  } finally {
    await w.stop();
  }
});
