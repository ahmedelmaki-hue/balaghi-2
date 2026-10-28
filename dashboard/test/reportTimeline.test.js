import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportTimeline } from '../src/reportTimeline.js';

test('field concerns and staff decisions appear in time order without duplicate status events', () => {
  const report = {
    created_at: '2026-10-14T23:56:04Z', approved_at: '2026-10-15T16:04:26Z',
    assigned_at: '2026-10-17T17:59:41Z', accepted_at: '2026-10-17T18:03:25Z',
  };
  const history = [
    { id: 2, new_status: 'in_progress', changed_at: '2026-10-16T20:10:27Z' },
    { id: 3, new_status: 'new', changed_at: '2026-10-17T17:59:41Z' },
  ];
  const reviews = [
    { id: 2, reason: 'wrong_location', note: 'الموقع غير صحيح',
      raised_at: '2026-10-17T17:57:08Z', decision: 'reassign',
      decided_at: '2026-10-17T17:59:41Z' },
    { id: 3, reason: 'duplicate', note: 'قد يكون مكررًا',
      raised_at: '2026-10-17T18:03:38Z', decision: 'continue',
      decided_at: '2026-10-17T18:04:32Z' },
    { id: 4, reason: 'wrong_location', note: 'الموقع يحتاج مراجعة',
      raised_at: '2026-10-17T18:04:41Z', decision: 'continue',
      decided_at: '2026-10-17T18:14:58Z' },
  ];
  const titles = buildReportTimeline(report, history, reviews).map((event) => event.title);
  assert.deepEqual(titles, [
    'تم إرسال البلاغ', 'تم اعتماد البلاغ ونشره', 'بدأت المعالجة',
    'تم الإبلاغ عن مشكلة', 'أُعيد البلاغ إلى قائمة جهة العمل',
    'استلم العامل البلاغ', 'تم الإبلاغ عن مشكلة', 'متابعة البلاغ',
    'تم الإبلاغ عن مشكلة', 'متابعة البلاغ',
  ]);
});

test('a field rejection appears once after the concern', () => {
  const report = { created_at: '2026-10-17T10:00:00Z' };
  const history = [{ id: 1, new_status: 'rejected', changed_at: '2026-10-17T10:10:00Z' }];
  const reviews = [{ id: 1, reason: 'not_found', note: 'لم توجد المشكلة',
    raised_at: '2026-10-17T10:05:00Z', decision: 'reject',
    decided_at: '2026-10-17T10:10:00Z' }];
  const events = buildReportTimeline(report, history, reviews);
  assert.deepEqual(events.map((event) => event.title),
    ['تم إرسال البلاغ', 'تم الإبلاغ عن مشكلة', 'تم رفض البلاغ']);
});

test('work completion and staff review appear without repeating the resolved transition', () => {
  const report = { created_at: '2026-10-17T10:00:00Z' };
  const history = [{ id: 1, new_status: 'resolved', changed_at: '2026-10-17T12:20:00Z' }];
  const completions = [
    { id: 1, submitted_at: '2026-10-17T11:00:00Z', note: 'أصلحنا التسرب',
      decision: 'returned', decision_note: 'يحتاج المكان إلى تنظيف',
      decided_at: '2026-10-17T11:10:00Z' },
    { id: 2, submitted_at: '2026-10-17T12:00:00Z', note: 'اكتمل التنظيف',
      decision: 'confirmed', decided_at: '2026-10-17T12:20:00Z' },
  ];
  const events = buildReportTimeline(report, history, [], {}, completions);
  assert.deepEqual(events.map((event) => event.title), [
    'تم إرسال البلاغ', 'أبلغت جهة العمل بإنجاز الإصلاح', 'أُعيد البلاغ للعمل',
    'أبلغت جهة العمل بإنجاز الإصلاح', 'تم تأكيد الحل',
  ]);
  assert.equal(events[2].detail, 'يحتاج المكان إلى تنظيف');
});

test('the acceptance step names the worker who claimed the report', () => {
  const report = {
    created_at: '2026-10-28T08:00:00Z', approved_at: '2026-10-28T09:00:00Z',
    assigned_at: '2026-10-28T09:00:00Z', accepted_at: '2026-10-28T10:00:00Z',
    assigned_worker_name: 'علي', assigned_worker_username: 'field1',
  };
  const accepted = buildReportTimeline(report).find((event) => event.key === 'accepted');
  assert.equal(accepted.title, 'استلم العامل البلاغ');
  assert.equal(accepted.actor, 'علي');
  const unnamed = buildReportTimeline({ ...report, assigned_worker_name: null })
    .find((event) => event.key === 'accepted');
  assert.equal(unnamed.actor, 'field1');
});

test('the approval step names the staff member who approved the report', () => {
  const report = { created_at: '2026-10-28T08:00:00Z', approved_at: '2026-10-28T09:00:00Z',
    approved_by_name: 'سالم', approved_by_username: 'operator1' };
  const approved = buildReportTimeline(report).find((event) => event.key === 'approved');
  assert.equal(approved.actor, 'سالم');
  const byUsername = buildReportTimeline({ ...report, approved_by_name: null })
    .find((event) => event.key === 'approved');
  assert.equal(byUsername.actor, 'operator1');
});
