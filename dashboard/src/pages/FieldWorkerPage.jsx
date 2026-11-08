// The field worker's phone-sized page: checks, claims, start, concerns, finished work.
import React, { useEffect, useRef, useState } from 'react';
import {
  Check, CheckCheck, CircleAlert, Clock3, Eye, FolderOpen, MapPin, Navigation, RefreshCw, ShieldCheck, UserRound, X,
} from 'lucide-react';
import { fieldApi, imageUrl } from '../api.js';
import { AccountMenu } from '../AccountMenu.jsx';
import CompletionCamera from '../CompletionCamera.jsx';
import { agencies, fieldIssueReasons, verificationResults, fmtDate, number, categoryName, errorText, Brand, CategoryIcon, StatusPill, EmptyState, LoadingState } from '../shared.jsx';

// Like the staff counters, the worker's lists refresh themselves every 30 seconds
// while the page is visible, and at once when the worker comes back to it. These
// refreshes are quiet: no loading screen, and a failed one keeps the list shown.
const AUTO_REFRESH_MS = 30000;
function useAutoRefresh(setTick, quiet) {
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      quiet.current = true;
      setTick((value) => value + 1);
    };
    const timer = setInterval(refresh, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [setTick, quiet]);
}

const clockTime = new Intl.DateTimeFormat('ar-LY', { hour: 'numeric', minute: '2-digit' });
const relativeTime = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
function since(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return relativeTime.format(-minutes, 'minute');
  if (minutes < 60 * 24) return relativeTime.format(-Math.round(minutes / 60), 'hour');
  return relativeTime.format(-Math.round(minutes / 1440), 'day');
}
const mapLink = (report) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(report.latitude)},${Number(report.longitude)}`)}`;

// Where a report stands on the worker's path; the employee confirms the last step.
const WORK_STEPS = ['الاستلام', 'بدء العمل', 'الإنجاز', 'تأكيد الموظف'];
function workStep(report) {
  if (report.status === 'resolved') return WORK_STEPS.length;
  if (report.completion_pending) return 3;
  if (report.status === 'in_progress') return 2;
  return report.accepted_at ? 1 : 0;
}
function WorkSteps({ report }) {
  const step = workStep(report);
  return <ol className="wk-steps" aria-label={step < WORK_STEPS.length ? `الخطوة الحالية: ${WORK_STEPS[step]}` : 'اكتمل البلاغ'}>
    {WORK_STEPS.map((label, index) => <li key={label} className={index < step ? 'is-done' : index === step ? 'is-now' : ''}><i aria-hidden="true">{index < step && <Check size={11} strokeWidth={3} />}</i>{label}</li>)}
  </ol>;
}

// The photo and what the report is; shared by work cards and verification requests.
function ReportSummary({ report, when, onPhoto }) {
  const photo = imageUrl(report.image_url);
  return <div className="wk-summary">
    {photo ? <button type="button" className="wk-photo" onClick={onPhoto} aria-label={`فتح صورة البلاغ ${report.id} بحجم كامل`}><img src={photo} alt={`صورة البلاغ ${report.id}`} /></button>
      : <div className="wk-photo"><CategoryIcon category={report.category} size={30} /></div>}
    <div className="wk-summary-text">
      <div className="wk-meta"><strong>{categoryName(report.category)}</strong><span className="num">#{report.id}</span><time dateTime={when} title={fmtDate(when)}>{since(when)}</time></div>
      <p className={report.description ? 'wk-desc' : 'wk-desc is-empty'}>{report.description || 'لا يوجد وصف إضافي.'}</p>
      <p className="wk-place"><MapPin size={14} />{report.address_text || 'الموقع محدد على الخريطة'}</p>
    </div>
  </div>;
}

function FieldVerificationQueue({ onChanged }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(0);
  const quiet = useRef(false);
  useAutoRefresh(setTick, quiet);
  useEffect(() => {
    let active = true;
    const silent = quiet.current;
    quiet.current = false;
    if (!silent) setLoading(true);
    fieldApi.verifications({ page })
      .then((result) => {
        if (!active) return;
        if (page > Math.max(result.total_pages, 1)) {
          setPage(Math.max(result.total_pages, 1));
          return;
        }
        setItems(result.items); setTotalPages(result.total_pages || 1); setError('');
      })
      .catch((cause) => { if (active && !silent) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, tick]);
  useEffect(() => {
    if (!preview) return undefined;
    const close = (event) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [preview]);
  const act = async (item, action) => {
    const draft = drafts[item.id] || {};
    if (action === 'respond' && (!draft.result || !draft.note?.trim())) return;
    setBusyId(item.id); setError(''); setNotice('');
    try {
      if (action === 'claim') await fieldApi.claimVerification(item.id);
      else await fieldApi.respondVerification(item.id, draft.result, draft.note.trim());
      setNotice(action === 'claim' ? 'استلمت مهمة التحقق. افحص الموقع ثم أرسل النتيجة.' : 'وصلت نتيجة التحقق إلى الموظف. البلاغ ما زال غير منشور حتى يقرر بشأنه.');
      setTick((value) => value + 1); onChanged?.();
    } catch (cause) { setError(errorText(cause)); setTick((value) => value + 1); }
    finally { setBusyId(null); }
  };
  return <section className="verification-queue" aria-label="طلبات التحقق قبل الاعتماد">
    <p className="verification-hint">هذه البلاغات غير منشورة. افحص المشكلة في الموقع، ثم أرسل النتيجة للموظف. التحقق لا يعني بدء أعمال الإصلاح.</p>
    {notice && <div className="field-notice" role="status"><Check size={17} />{notice}</div>}
    {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((value) => value + 1)}>إعادة المحاولة</button></div>}
    {loading ? <LoadingState /> : items.length === 0 ? <EmptyState icon={ShieldCheck} title="لا توجد طلبات تحقق حاليًا" detail="ستظهر هنا البلاغات التي يحيلها الموظف إلى جهة عملك قبل اعتمادها." /> : <div className="wk-grid">{items.map((item) => <article className="wk-card" key={item.verification_id}>
      <ReportSummary report={item} when={item.requested_at} onPhoto={() => setPreview(item)} />
      <p className="wk-ask"><strong>سبب طلب التحقق</strong>{item.request_note}</p>
      <a className="wk-secondary wk-map-full" href={mapLink(item)} target="_blank" rel="noopener noreferrer"><Navigation size={17} />الذهاب إلى الموقع</a>
      {!item.claimed_by ? <button type="button" className="wk-primary" disabled={busyId === item.id} onClick={() => act(item, 'claim')}><Check size={18} />استلام مهمة التحقق</button> : <div className="wk-response">
        <fieldset className="wk-results"><legend>نتيجة التحقق</legend><div>{Object.entries(verificationResults).filter(([key]) => key !== 'cancelled').map(([key, label]) => <label key={key} className={drafts[item.id]?.result === key ? 'is-on' : ''}><input type="radio" name={`result-${item.id}`} value={key} checked={drafts[item.id]?.result === key} onChange={() => setDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], result: key } }))} />{label}</label>)}</div></fieldset>
        <label className="wk-note-field">ملاحظتك للموظف<textarea value={drafts[item.id]?.note || ''} maxLength={500} rows={3} placeholder="اكتب ما تحققت منه في الموقع" onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], note: event.target.value } }))} /></label>
        <button type="button" className="wk-primary" disabled={busyId === item.id || !drafts[item.id]?.result || !drafts[item.id]?.note?.trim()} onClick={() => act(item, 'respond')}>{busyId === item.id ? 'جارٍ الإرسال...' : 'إرسال النتيجة للموظف'}</button>
      </div>}
    </article>)}</div>}
    {totalPages > 1 && <div className="wk-pages"><button type="button" className="wk-secondary" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span className="num">{number(page)} / {number(totalPages)}</span><button type="button" className="wk-secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</button></div>}
    {preview && <div className="image-modal" role="dialog" aria-modal="true" aria-label={`صورة البلاغ ${preview.id} كاملة`}><button className="image-modal-close" onClick={() => setPreview(null)} aria-label="إغلاق الصورة"><X size={22} /></button><div className="image-modal-stage"><img src={imageUrl(preview.image_url)} alt={`صورة البلاغ ${preview.id} كاملة`} /></div></div>}
  </section>;
}

export function FieldWorkerPage({ user, onLogout, onPassword }) {
  const [tab, setTab] = useState('reports');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [issueId, setIssueId] = useState(null);
  const [issueReason, setIssueReason] = useState('');
  const [issueNote, setIssueNote] = useState('');
  const [issueError, setIssueError] = useState('');
  const [completionId, setCompletionId] = useState(null);
  const [completionNote, setCompletionNote] = useState('');
  const [completionPhoto, setCompletionPhoto] = useState(null);
  const [completionPreview, setCompletionPreview] = useState('');
  const [completionLocation, setCompletionLocation] = useState(null);
  const [completionLocationState, setCompletionLocationState] = useState('idle');
  const [completionError, setCompletionError] = useState('');
  const locationRequest = useRef(0);
  const [detailsId, setDetailsId] = useState(null);
  const [imageId, setImageId] = useState(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(0);
  const [counts, setCounts] = useState({});
  const [countTick, setCountTick] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const quiet = useRef(false);
  useAutoRefresh(setTick, quiet);
  useEffect(() => {
    let active = true;
    Promise.all([fieldApi.assigned({ view: 'active', limit: 1 }), fieldApi.assigned({ view: 'resolved', limit: 1 }), fieldApi.verifications({ limit: 1 })])
      .then(([reports, resolved, verifications]) => { if (active) setCounts({ reports: reports.total, resolved: resolved.total, verifications: verifications.total }); })
      .catch(() => {});
    return () => { active = false; };
  }, [tick, countTick]);
  useEffect(() => {
    let active = true;
    const silent = quiet.current;
    quiet.current = false;
    if (!silent) setLoading(true);
    fieldApi.assigned({ page, view: tab === 'resolved' ? 'resolved' : 'active' })
      .then((result) => { if (active) {
        if (page > Math.max(result.total_pages, 1)) { setPage(Math.max(result.total_pages, 1)); return; }
        setItems(result.items); setTotalPages(result.total_pages || 1); setError(''); setLoadedAt(new Date());
      } })
      .catch((cause) => { if (active && !silent) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, tab, tick]);
  useEffect(() => {
    if (!completionPhoto) { setCompletionPreview(''); return undefined; }
    const url = URL.createObjectURL(completionPhoto);
    setCompletionPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [completionPhoto]);
  const closeCompletion = () => {
    locationRequest.current += 1;
    setCompletionId(null); setCompletionPhoto(null); setCompletionNote('');
    setCompletionLocation(null); setCompletionLocationState('idle'); setCompletionError('');
  };
  const captureCompletionPhoto = (photo) => {
    if (photo.size > 5 * 1024 * 1024) {
      setCompletionError('حجم الصورة أكبر من 5 ميغابايت. أعد التقاطها.');
      return;
    }
    setCompletionPhoto(photo); setCompletionError(''); setCompletionLocation(null);
    const requestId = ++locationRequest.current;
    if (!navigator.geolocation) {
      setCompletionLocationState('unavailable');
      return;
    }
    setCompletionLocationState('checking');
    navigator.geolocation.getCurrentPosition((position) => {
      if (locationRequest.current !== requestId) return;
      setCompletionLocation({ latitude: position.coords.latitude,
        longitude: position.coords.longitude, accuracy: position.coords.accuracy });
      setCompletionLocationState('ready');
    }, () => {
      if (locationRequest.current === requestId) setCompletionLocationState('unavailable');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  };
  const perform = async (id, action) => {
    setBusyId(id); setError(''); setNotice('');
    try {
      if (action === 'accept') await fieldApi.accept(id);
      else await fieldApi.start(id);
      setNotice(action === 'accept' ? 'تم استلام البلاغ. اضغط «بدأنا العمل» عند بدء العمل فعليًا.' : 'تم تأكيد بدء العمل وأصبح البلاغ قيد المعالجة.');
      setConfirmId(null); setTick((value) => value + 1);
    } catch (cause) { setError(errorText(cause)); setConfirmId(null); setTick((value) => value + 1); }
    finally { setBusyId(null); }
  };
  const submitIssue = async () => {
    if (!issueId || !issueReason || !issueNote.trim() || busyId) return;
    setBusyId(issueId); setIssueError(''); setError(''); setNotice('');
    try {
      await fieldApi.reportIssue(issueId, issueReason, issueNote.trim());
      setNotice('أُرسلت ملاحظتك إلى الموظف المختص. أُوقف البلاغ مؤقتًا حتى يراجعه.');
      setItems((current) => current.filter((report) => report.id !== issueId));
      setIssueId(null); setDetailsId(null); setIssueReason(''); setIssueNote('');
      setTick((value) => value + 1);
    } catch (cause) { setIssueError(errorText(cause)); }
    finally { setBusyId(null); }
  };
  const submitCompletion = async () => {
    if (!completionId || !completionPhoto || completionLocationState === 'checking' || busyId) return;
    setBusyId(completionId); setCompletionError(''); setNotice('');
    try {
      await fieldApi.submitCompletion(completionId, completionNote.trim(),
        completionPhoto, completionLocation);
      setNotice('أُرسل إنجاز العمل إلى الموظف للمراجعة. ستظل الحالة «قيد المعالجة» حتى يؤكد الحل.');
      closeCompletion(); setDetailsId(null);
      setTick((value) => value + 1);
    } catch (cause) { setCompletionError(errorText(cause)); }
    finally { setBusyId(null); }
  };
  const detailsReport = items.find((report) => report.id === detailsId);
  const imageReport = items.find((report) => report.id === imageId);
  const openImage = (id) => { setImageZoom(1); setImageId(id); };
  // What needs the worker first: work under way, then claimed, then free to claim.
  const groups = tab === 'resolved' ? [{ key: 'resolved', items }] : [
    { key: 'working', title: 'قيد العمل', items: items.filter((report) => report.status === 'in_progress') },
    { key: 'claimed', title: 'استلمتها ولم تبدأ', items: items.filter((report) => report.status === 'new' && report.accepted_at) },
    { key: 'open', title: 'متاحة للاستلام', items: items.filter((report) => report.status === 'new' && !report.accepted_at) },
  ].filter((group) => group.items.length);
  const TABS = [['reports', 'العمل'], ['verifications', 'التحقق'], ['resolved', 'المنتهية']];
  const heading = { reports: 'بلاغات جهتك', verifications: 'طلبات التحقق', resolved: 'البلاغات المنتهية' }[tab];
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (imageId !== null) setImageId(null);
      else if (issueId !== null && busyId === null) setIssueId(null);
      else if (completionId !== null && busyId === null) closeCompletion();
      else if (detailsId !== null) setDetailsId(null);
      else if (confirmId !== null && busyId === null) setConfirmId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [imageId, issueId, completionId, detailsId, confirmId, busyId]);
  return <main className="field-layout" dir="rtl"><header className="field-header wk-header"><Brand compact /><div><AccountMenu user={user} onPassword={onPassword} onLogout={onLogout} className="wk-account"><span className="wk-avatar"><UserRound size={20} /></span><span className="wk-user">{user.full_name || user.staff_username}</span><span className="sr-only">بيانات الحساب</span></AccountMenu></div></header>
    <div className="field-content rl wk">
      <header className="wk-head">
        <div><span className="eyebrow">{agencies[user.agency] || 'جهة العمل'}</span>
          <h1>{heading}{counts[tab] !== undefined && <span className="pr-count num">{number(counts[tab])}</span>}</h1></div>
        <button type="button" className="pr-refresh" onClick={() => setTick((value) => value + 1)}><RefreshCw size={16} />{loadedAt ? <span className="num">{clockTime.format(loadedAt)}</span> : 'تحديث'}<span className="sr-only">تحديث البلاغات</span></button>
      </header>
      <div className="wk-tabs" role="tablist" aria-label="مهام جهة العمل">{TABS.map(([key, label]) => <button type="button" key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => { setTab(key); setPage(1); }}>{label}{counts[key] !== undefined && <small className="num">{number(counts[key])}</small>}</button>)}</div>
      {tab === 'verifications' ? <FieldVerificationQueue onChanged={() => setCountTick((value) => value + 1)} /> : <>
      {notice && <div className="field-notice" role="status"><Check size={17} />{notice}</div>}
      {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((value) => value + 1)}>إعادة المحاولة</button></div>}
      {loading ? <LoadingState /> : items.length === 0 ? <EmptyState icon={FolderOpen} title={tab === 'resolved' ? 'لا توجد بلاغات منتهية' : 'لا توجد بلاغات لدى جهة عملك'} detail={tab === 'resolved' ? 'ستظهر هنا البلاغات التي يؤكد الموظف حلها.' : 'ستظهر هنا البلاغات التي تُعتمد وتُسند تلقائيًا إلى جهتك.'} /> : groups.map((group) => <section className="wk-group" key={group.key} aria-label={group.title || heading}>
        {group.title && <h2>{group.title}<small className="num">{number(group.items.length)}</small></h2>}
        <div className="wk-grid">{group.items.map((report) => <article className="wk-card" key={report.id}>
          <ReportSummary report={report} when={tab === 'resolved' ? report.updated_at : report.created_at} onPhoto={() => openImage(report.id)} />
          <WorkSteps report={report} />
          {report.field_issue_pending && <p className="field-return-note"><CircleAlert size={16} />ملاحظتك قيد مراجعة الموظف: {report.field_issue_note}</p>}
          {report.status !== 'resolved' && report.completion_return_note && <p className="field-return-note"><CircleAlert size={16} />أعاده الموظف للعمل: {report.completion_return_note}</p>}
          {report.field_issue_pending ? <p className="wk-waiting">بانتظار مراجعة الموظف</p> : <>
            {report.status === 'new' && (report.accepted_at
              ? <button type="button" className="wk-primary" disabled={busyId === report.id} onClick={() => setConfirmId(report.id)}><Clock3 size={18} />بدأنا العمل</button>
              : <button type="button" className="wk-primary" disabled={busyId === report.id} onClick={() => perform(report.id, 'accept')}><Check size={18} />استلام البلاغ</button>)}
            {report.status === 'in_progress' && (report.completion_pending
              ? <p className="wk-waiting">بانتظار تأكيد الموظف</p>
              : <button type="button" className="wk-primary" disabled={busyId === report.id} onClick={() => { closeCompletion(); setCompletionId(report.id); }}><CheckCheck size={18} />تم إنجاز العمل</button>)}
          </>}
          <div className="wk-secondaries">
            {report.status !== 'resolved' && <a className="wk-secondary" href={mapLink(report)} target="_blank" rel="noopener noreferrer"><Navigation size={17} />الموقع</a>}
            <button type="button" className="wk-secondary" onClick={() => setDetailsId(report.id)}><Eye size={17} />التفاصيل</button>
          </div>
        </article>)}</div>
      </section>)}
      {totalPages > 1 && <div className="wk-pages"><button type="button" className="wk-secondary" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span className="num">{number(page)} / {number(totalPages)}</span><button type="button" className="wk-secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</button></div>}
      </>}
    </div>
    {detailsReport && <div className="modal-layer"><button className="modal-backdrop" aria-label="إغلاق التفاصيل" onClick={() => setDetailsId(null)} /><section className="field-detail-modal wk-detail" role="dialog" aria-modal="true" aria-label={`تفاصيل البلاغ ${detailsReport.id}`}>
      <div className="wk-detail-head"><div><h2>{categoryName(detailsReport.category)}<span className="num">#{detailsReport.id}</span></h2><StatusPill report={detailsReport} /></div><button type="button" className="wk-icon" onClick={() => setDetailsId(null)} aria-label="إغلاق التفاصيل"><X size={20} /></button></div>
      {imageUrl(detailsReport.image_url) && <button type="button" className="wk-detail-photo" onClick={() => openImage(detailsReport.id)} aria-label="عرض الصورة كاملة"><img src={imageUrl(detailsReport.image_url)} alt={`صورة البلاغ ${detailsReport.id}`} /></button>}
      {detailsReport.field_issue_pending && <p className="field-return-note"><CircleAlert size={16} />الملاحظة بانتظار قرار الموظف: {detailsReport.field_issue_note}</p>}
      <div className="wk-detail-block"><h3>وصف المشكلة</h3><p>{detailsReport.description || 'لا يوجد وصف إضافي.'}</p></div>
      <div className="wk-detail-block"><h3>موقع المشكلة</h3><p>{detailsReport.address_text || 'لم يُضف عنوان نصي.'}</p><small dir="ltr">{Number(detailsReport.latitude).toFixed(6)}, {Number(detailsReport.longitude).toFixed(6)}</small><a className="wk-secondary" href={mapLink(detailsReport)} target="_blank" rel="noopener noreferrer"><Navigation size={17} />فتح الموقع على الخريطة</a></div>
      <div className="wk-detail-block"><h3>مواعيد البلاغ</h3><dl className="wk-dates"><div><dt>قُدّم البلاغ</dt><dd>{fmtDate(detailsReport.created_at)}</dd></div><div><dt>أُسند إلى جهة العمل</dt><dd>{fmtDate(detailsReport.assigned_at)}</dd></div>{detailsReport.accepted_at && <div><dt>استُلم البلاغ</dt><dd>{fmtDate(detailsReport.accepted_at)}</dd></div>}{detailsReport.work_started_at && <div><dt>بدأ العمل</dt><dd>{fmtDate(detailsReport.work_started_at)}</dd></div>}</dl></div>
      {['new', 'in_progress'].includes(detailsReport.status) && !detailsReport.completion_pending && !detailsReport.field_issue_pending && <div className="wk-detail-foot"><button type="button" className="wk-secondary wk-danger" onClick={() => { setIssueReason(''); setIssueNote(''); setIssueError(''); setIssueId(detailsReport.id); }}><CircleAlert size={17} />الإبلاغ عن مشكلة في البلاغ</button></div>}
    </section></div>}
    {issueId && <div className="modal-layer field-issue-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && setIssueId(null)} /><section className="confirm-modal field-issue-modal" role="dialog" aria-modal="true" aria-label="الإبلاغ عن مشكلة"><span className="modal-icon danger"><CircleAlert size={25} /></span><h3>الإبلاغ عن مشكلة في البلاغ</h3><p>اختر السبب واكتب ما وجدته في الموقع. سيُحال البلاغ للموظف للمراجعة، ولن يُرفض تلقائيًا.</p><label>سبب الملاحظة<select value={issueReason} onChange={(e) => setIssueReason(e.target.value)}><option value="">اختر السبب</option>{Object.entries(fieldIssueReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>ملاحظتك للموظف<textarea value={issueNote} maxLength={500} onChange={(e) => setIssueNote(e.target.value)} rows={4} placeholder="اشرح المشكلة التي وجدتها بوضوح" /><small>{issueNote.length}/500</small></label>{issueError && <p className="completion-camera-error" role="alert">{issueError}</p>}<div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId) || !issueReason || !issueNote.trim()} onClick={submitIssue}>{busyId ? 'جارٍ الإرسال...' : 'إرسال الملاحظة للمراجعة'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={() => setIssueId(null)}>إلغاء</button></div></section></div>}
    {completionId && <div className="modal-layer field-issue-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && closeCompletion()} /><section className="confirm-modal field-issue-modal completion-modal" role="dialog" aria-modal="true" aria-label="إبلاغ الموظف بإنجاز العمل"><span className="modal-icon"><CheckCheck size={25} /></span><h3>توثيق إنجاز العمل</h3><p>التقط صورة بعد الإصلاح ليراها الموظف بجانب صورة البلاغ الأصلية. تبقى الحالة «قيد المعالجة» حتى يؤكد الحل.</p>{completionPhoto ? <div className="completion-captured"><img src={completionPreview} alt="صورة الإصلاح قبل الإرسال" /><button type="button" className="button button-quiet" disabled={Boolean(busyId)} onClick={() => { locationRequest.current += 1; setCompletionPhoto(null); setCompletionLocation(null); setCompletionLocationState('idle'); }}><RefreshCw size={16} />إعادة التصوير</button></div> : <CompletionCamera onCapture={captureCompletionPhoto} />}{completionPhoto && <p className="completion-location-state">{completionLocationState === 'checking' ? 'جارٍ تحديد موقع الجهاز...' : completionLocationState === 'ready' ? `سُجل موقع الجهاز بدقة تقريبية ${Math.round(completionLocation.accuracy)} م.` : 'تعذّر تحديد موقع الجهاز؛ سيظهر ذلك للموظف.'}</p>}<label>وصف العمل المنجز (اختياري)<textarea value={completionNote} maxLength={500} onChange={(event) => setCompletionNote(event.target.value)} rows={4} placeholder="اكتب ما أُنجز في الموقع إن أردت" /><small>{completionNote.length}/500</small></label>{completionError && <p className="completion-camera-error" role="alert">{completionError}</p>}<div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId) || !completionPhoto || completionLocationState === 'checking'} onClick={submitCompletion}>{busyId ? 'جارٍ الإرسال...' : 'إرسال الإنجاز للمراجعة'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={closeCompletion}>إلغاء</button></div></section></div>}
    {confirmId && <div className="modal-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && setConfirmId(null)} /><div className="confirm-modal" role="dialog" aria-modal="true" aria-label="تأكيد بدء العمل"><span className="modal-icon"><Clock3 size={25} /></span><h3>هل بدأتم العمل فعليًا؟</h3><p>عند التأكيد ستظهر حالة البلاغ للمواطن «قيد المعالجة» وسيُسجل وقت البدء باسم حسابك.</p><div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId)} onClick={() => perform(confirmId, 'start')}>{busyId ? 'جارٍ الحفظ...' : 'نعم، بدأنا العمل'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={() => setConfirmId(null)}>إلغاء</button></div></div></div>}
    {imageReport && imageUrl(imageReport.image_url) && <div className="image-modal" role="dialog" aria-modal="true" aria-label={`صورة البلاغ ${imageReport.id} كاملة`}><button className="image-modal-close" onClick={() => setImageId(null)} aria-label="إغلاق الصورة"><X size={22} /></button><div className="image-modal-stage"><img src={imageUrl(imageReport.image_url)} alt={`صورة البلاغ ${imageReport.id} بحجم كامل`} style={{ transform: `scale(${imageZoom})` }} /></div><div className="image-zoom-controls"><button onClick={() => setImageZoom((zoom) => Math.max(1, zoom - 0.5))} aria-label="تصغير الصورة">−</button><span>{imageZoom.toFixed(1)}×</span><button onClick={() => setImageZoom((zoom) => Math.min(4, zoom + 0.5))} aria-label="تكبير الصورة">+</button></div></div>}
  </main>;
}

