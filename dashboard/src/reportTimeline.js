const decisionTitles = {
  continue: 'متابعة البلاغ',
  correct_location: 'تم تصحيح موقع البلاغ',
  reassign: 'أُعيد البلاغ إلى قائمة جهة العمل',
  reject: 'تم رفض البلاغ',
};

const near = (left, right) => left && right &&
  Math.abs(new Date(left).getTime() - new Date(right).getTime()) <= 2000;

export function buildReportTimeline(report, statusHistory = [], fieldReviews = [],
  { agencyName = 'جهة العمل المختصة', reasonNames = {} } = {}, completions = []) {
  const events = [];
  const add = (key, at, title, actor, detail, order) => {
    if (at) events.push({ key, at, title, actor, detail, order });
  };

  add('created', report.created_at, 'تم إرسال البلاغ', null, null, 0);
  add('approved', report.approved_at, 'تم اعتماد البلاغ ونشره',
    report.approved_by_name || report.approved_by_username || null, null, 1);

  const legacyReassignment = fieldReviews.some((review) =>
    review.decision === 'reassign' && near(review.decided_at, report.assigned_at));
  if (!legacyReassignment) {
    add('assigned', report.assigned_at, `أُسند البلاغ إلى ${agencyName}`, null, null, 2);
  }
  add('accepted', report.accepted_at, 'استلم العامل البلاغ',
    report.assigned_worker_name || report.assigned_worker_username || 'العامل الميداني', null, 3);

  for (const entry of statusHistory) {
    const duplicateDecision = fieldReviews.some((review) =>
      ((entry.new_status === 'new' && review.decision === 'reassign') ||
       (entry.new_status === 'rejected' && review.decision === 'reject')) &&
      near(entry.changed_at, review.decided_at));
    const confirmedCompletion = entry.new_status === 'resolved' && completions.some((item) =>
      item.decision === 'confirmed' && near(entry.changed_at, item.decided_at));
    if (duplicateDecision || confirmedCompletion) continue;
    const title = {
      in_progress: 'بدأت المعالجة', resolved: 'تم الحل',
      rejected: 'تم رفض البلاغ', new: 'عاد البلاغ إلى حالة جديد',
    }[entry.new_status] || 'تغيّرت حالة البلاغ';
    add(`status-${entry.id}`, entry.changed_at, title,
      entry.changed_by_name || 'موظف', entry.change_reason, 4);
  }

  for (const review of fieldReviews) {
    const reason = reasonNames[review.reason] || 'ملاحظة ميدانية';
    add(`issue-${review.id}`, review.raised_at, 'تم الإبلاغ عن مشكلة',
      review.worker_name || review.worker_username || 'العامل الميداني',
      `${reason} · ${review.note}`, 5);
    if (review.decision) {
      add(`decision-${review.id}`, review.decided_at,
        decisionTitles[review.decision] || 'تمت مراجعة المشكلة',
        review.reviewer_name || 'الموظف', review.decision_note, 6);
    }
  }

  for (const completion of completions) {
    add(`completion-${completion.id}`, completion.submitted_at,
      'أبلغت جهة العمل بإنجاز الإصلاح',
      completion.worker_name || completion.worker_username || 'العامل الميداني',
      completion.note, 7);
    if (completion.decision) {
      add(`completion-decision-${completion.id}`, completion.decided_at,
        completion.decision === 'confirmed' ? 'تم تأكيد الحل' : 'أُعيد البلاغ للعمل',
        completion.reviewer_name || 'الموظف', completion.decision_note, 8);
    }
  }

  return events.sort((a, b) =>
    new Date(a.at).getTime() - new Date(b.at).getTime() || a.order - b.order);
}
