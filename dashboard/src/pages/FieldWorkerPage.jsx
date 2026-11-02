// The field worker's phone-sized page: checks, claims, start, concerns, finished work.
import React, { useEffect, useRef, useState } from 'react';
import {
  Check, CheckCheck, CircleAlert, Clock3, Eye, FolderOpen, KeyRound, LogOut, MapPin, RefreshCw, ShieldCheck, X,
} from 'lucide-react';
import { fieldApi, imageUrl } from '../api.js';
import CompletionCamera from '../CompletionCamera.jsx';
import { agencies, fieldIssueReasons, verificationResults, fmtDate, number, categoryName, errorText, Brand, CategoryIcon, StatusPill, EmptyState, LoadingState } from '../shared.jsx';

function FieldVerificationQueue() {
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
  useEffect(() => {
    let active = true;
    setLoading(true);
    fieldApi.verifications({ page })
      .then((result) => {
        if (!active) return;
        if (page > Math.max(result.total_pages, 1)) {
          setPage(Math.max(result.total_pages, 1));
          return;
        }
        setItems(result.items); setTotalPages(result.total_pages || 1); setError('');
      })
      .catch((cause) => { if (active) setError(errorText(cause)); })
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
      setTick((value) => value + 1);
    } catch (cause) { setError(errorText(cause)); setTick((value) => value + 1); }
    finally { setBusyId(null); }
  };
  return <section className="verification-queue" aria-label="طلبات التحقق قبل الاعتماد">
    <p className="verification-hint">هذه البلاغات غير منشورة. افحص المشكلة في الموقع، ثم أرسل النتيجة للموظف. التحقق لا يعني بدء أعمال الإصلاح.</p>
    {notice && <div className="field-notice" role="status"><Check size={17} />{notice}</div>}
    {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((value) => value + 1)}>إعادة المحاولة</button></div>}
    {loading ? <LoadingState /> : items.length === 0 ? <EmptyState icon={ShieldCheck} title="لا توجد طلبات تحقق حاليًا" detail="ستظهر هنا البلاغات التي يحيلها الموظف إلى جهة عملك قبل اعتمادها." /> : <div className="verification-grid">{items.map((item) => <article className="panel verification-card" key={item.verification_id}>
      <div className="verification-card-head"><div><span className="eyebrow">طلب تحقق · بلاغ #{item.id}</span><h2>{categoryName(item.category)}</h2></div><small>{fmtDate(item.requested_at)}</small></div>
      {imageUrl(item.image_url) && <button className="verification-photo" onClick={() => setPreview(item)} aria-label={`عرض صورة البلاغ ${item.id} كاملة`}><img src={imageUrl(item.image_url)} alt={`صورة البلاغ ${item.id}`} /></button>}
      <p><strong>وصف البلاغ:</strong> {item.description || 'لا يوجد وصف إضافي.'}</p>
      <p className="verification-request-note"><strong>سبب طلب التحقق:</strong> {item.request_note}</p>
      <a className="button button-quiet verification-map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(item.latitude)},${Number(item.longitude)}`)}`} target="_blank" rel="noopener noreferrer"><MapPin size={17} />فتح موقع المشكلة</a>
      {!item.claimed_by ? <button className="button button-gold" disabled={busyId === item.id} onClick={() => act(item, 'claim')}>استلام مهمة التحقق</button> : <div className="verification-response"><label>نتيجة التحقق<select value={drafts[item.id]?.result || ''} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], result: event.target.value } }))}><option value="">اختر النتيجة</option>{Object.entries(verificationResults).filter(([key]) => key !== 'cancelled').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>ملاحظتك للموظف<textarea value={drafts[item.id]?.note || ''} maxLength={500} rows={3} placeholder="اكتب ما تحققت منه في الموقع" onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], note: event.target.value } }))} /></label><button className="button button-gold" disabled={busyId === item.id || !drafts[item.id]?.result || !drafts[item.id]?.note?.trim()} onClick={() => act(item, 'respond')}>{busyId === item.id ? 'جارٍ الإرسال...' : 'إرسال النتيجة للموظف'}</button></div>}
    </article>)}</div>}
    {totalPages > 1 && <div className="field-pages"><button className="button button-quiet" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span>{number(page)} / {number(totalPages)}</span><button className="button button-quiet" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</button></div>}
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
  useEffect(() => {
    let active = true;
    setLoading(true);
    fieldApi.assigned({ page, view: tab === 'resolved' ? 'resolved' : 'active' })
      .then((result) => { if (active) {
        if (page > Math.max(result.total_pages, 1)) { setPage(Math.max(result.total_pages, 1)); return; }
        setItems(result.items); setTotalPages(result.total_pages || 1); setError('');
      } })
      .catch((cause) => { if (active) setError(errorText(cause)); })
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
  return <main className="field-layout" dir="rtl"><header className="field-header"><Brand compact /><div><span>{user.full_name || user.staff_username}</span><button className="button button-quiet" onClick={onPassword} aria-label="تغيير كلمة المرور" title="تغيير كلمة المرور"><KeyRound size={16} /></button><button className="button button-quiet" onClick={onLogout}><LogOut size={16} />خروج</button></div></header>
    <div className="field-content"><div className="field-intro"><span className="eyebrow">مساحة العمل الميداني</span><h1>{tab === 'verifications' ? 'طلبات التحقق قبل الاعتماد' : tab === 'resolved' ? 'البلاغات المنتهية' : 'بلاغات جهة عملك'}</h1><p>{agencies[user.agency] || 'البلاغات المسندة إلى جهتك'} · {tab === 'verifications' ? 'هذه الطلبات تنتظر فحصًا ميدانيًا قبل قرار النشر.' : tab === 'resolved' ? 'البلاغات التي أكّد الموظف حلها بعد إنجازك للعمل.' : 'استلم البلاغ أولًا، ثم أكد بدء العمل عند وصولك وبدء المعالجة فعليًا. عندها تتغير حالة البلاغ للمواطن.'}</p>{tab !== 'verifications' && <button className="button button-quiet" onClick={() => setTick((value) => value + 1)}><RefreshCw size={16} />تحديث البلاغات</button>}</div>
      <div className="field-work-tabs" role="tablist" aria-label="مهام جهة العمل"><button role="tab" aria-selected={tab === 'reports'} className={`button ${tab === 'reports' ? 'button-gold' : 'button-quiet'}`} onClick={() => { setTab('reports'); setPage(1); }}>بلاغات العمل</button><button role="tab" aria-selected={tab === 'resolved'} className={`button ${tab === 'resolved' ? 'button-gold' : 'button-quiet'}`} onClick={() => { setTab('resolved'); setPage(1); }}>البلاغات المنتهية</button><button role="tab" aria-selected={tab === 'verifications'} className={`button ${tab === 'verifications' ? 'button-gold' : 'button-quiet'}`} onClick={() => { setTab('verifications'); setPage(1); }}>طلبات التحقق قبل الاعتماد</button></div>
      {tab === 'verifications' ? <FieldVerificationQueue /> : <>
      {notice && <div className="field-notice" role="status"><Check size={17} />{notice}</div>}
      {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((value) => value + 1)}>إعادة المحاولة</button></div>}
      {loading ? <LoadingState /> : items.length === 0 ? <EmptyState icon={FolderOpen} title={tab === 'resolved' ? 'لا توجد بلاغات منتهية' : 'لا توجد بلاغات لدى جهة عملك'} detail={tab === 'resolved' ? 'ستظهر هنا البلاغات التي يؤكد الموظف حلها.' : 'ستظهر هنا البلاغات التي تُعتمد وتُسند تلقائيًا إلى جهتك.'} /> : <div className="field-grid">{items.map((report) => <article className="field-card" key={report.id}>
        {imageUrl(report.image_url) ? <button type="button" className="field-card-image field-card-image-open" onClick={() => openImage(report.id)} aria-label={`فتح صورة البلاغ ${report.id} بحجم كامل`}><img src={imageUrl(report.image_url)} alt={`صورة البلاغ ${report.id}`} /></button> : <div className="field-card-image"><CategoryIcon category={report.category} size={38} /></div>}
        <div className="field-card-content">
          <div className="field-card-actions">{report.field_issue_pending ? <span className="field-progress-label">بانتظار مراجعة الموظف</span> : <>{report.status === 'new' && (report.accepted_at ? <button type="button" className="button button-gold" disabled={busyId === report.id} onClick={() => setConfirmId(report.id)}><Clock3 size={17} />بدأنا العمل</button> : <button type="button" className="button button-gold" disabled={busyId === report.id} onClick={() => perform(report.id, 'accept')}><Check size={17} />استلام البلاغ</button>)}{report.status === 'in_progress' && (report.completion_pending ? <span className="field-progress-label">بانتظار تأكيد الموظف</span> : <button type="button" className="button button-gold" disabled={busyId === report.id} onClick={() => { closeCompletion(); setCompletionId(report.id); }}><CheckCheck size={17} />تم إنجاز العمل</button>)}</>}<button type="button" className="button button-quiet" onClick={() => setDetailsId(report.id)}><Eye size={17} />تفاصيل البلاغ</button></div>
          {report.field_issue_pending && <p className="field-return-note"><CircleAlert size={16} />ملاحظتك قيد مراجعة الموظف: {report.field_issue_note}</p>}
          {report.status !== 'resolved' && report.completion_return_note && <p className="field-return-note"><CircleAlert size={16} />أعاده الموظف للعمل: {report.completion_return_note}</p>}
        </div></article>)}</div>}
      {totalPages > 1 && <div className="field-pages"><button className="button button-quiet" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span>{number(page)} / {number(totalPages)}</span><button className="button button-quiet" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</button></div>}
      </>}
    </div>
    {detailsReport && <div className="modal-layer"><button className="modal-backdrop" aria-label="إغلاق التفاصيل" onClick={() => setDetailsId(null)} /><section className="field-detail-modal" role="dialog" aria-modal="true" aria-label={`تفاصيل البلاغ ${detailsReport.id}`}><div className="field-detail-head"><div><span className="eyebrow">بلاغ #{detailsReport.id}</span><h2>{categoryName(detailsReport.category)}</h2></div><button className="field-detail-close" onClick={() => setDetailsId(null)} aria-label="إغلاق التفاصيل"><X size={20} /></button></div><StatusPill report={detailsReport} />{detailsReport.field_issue_pending && <p className="field-return-note"><CircleAlert size={16} />الملاحظة بانتظار قرار الموظف: {detailsReport.field_issue_note}</p>}<div className="field-detail-section"><h3>وصف المشكلة</h3><p>{detailsReport.description || 'لا يوجد وصف إضافي.'}</p></div><div className="field-detail-section"><h3>موقع المشكلة</h3><p>{detailsReport.address_text || 'لم يُضف عنوان نصي.'}</p><small dir="ltr">{Number(detailsReport.latitude).toFixed(6)}, {Number(detailsReport.longitude).toFixed(6)}</small><a className="button button-quiet" href={`https://www.google.com/maps/search/?api=1&query=${Number(detailsReport.latitude)},${Number(detailsReport.longitude)}`} target="_blank" rel="noreferrer"><MapPin size={16} />فتح الموقع على الخريطة</a></div><div className="field-detail-section"><h3>مواعيد البلاغ</h3><div className="field-detail-dates"><span>قُدّم البلاغ <strong>{fmtDate(detailsReport.created_at)}</strong></span><span>أُسند إلى جهة العمل <strong>{fmtDate(detailsReport.assigned_at)}</strong></span>{detailsReport.accepted_at && <span>استُلم البلاغ <strong>{fmtDate(detailsReport.accepted_at)}</strong></span>}{detailsReport.work_started_at && <span>بدأ العمل <strong>{fmtDate(detailsReport.work_started_at)}</strong></span>}</div></div>{['new', 'in_progress'].includes(detailsReport.status) && !detailsReport.completion_pending && !detailsReport.field_issue_pending && <button type="button" className="button button-danger-quiet field-issue-button" onClick={() => { setIssueReason(''); setIssueNote(''); setIssueError(''); setIssueId(detailsReport.id); }}><CircleAlert size={17} />الإبلاغ عن مشكلة في البلاغ</button>}</section></div>}
    {issueId && <div className="modal-layer field-issue-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && setIssueId(null)} /><section className="confirm-modal field-issue-modal" role="dialog" aria-modal="true" aria-label="الإبلاغ عن مشكلة"><span className="modal-icon danger"><CircleAlert size={25} /></span><h3>الإبلاغ عن مشكلة في البلاغ</h3><p>اختر السبب واكتب ما وجدته في الموقع. سيُحال البلاغ للموظف للمراجعة، ولن يُرفض تلقائيًا.</p><label>سبب الملاحظة<select value={issueReason} onChange={(e) => setIssueReason(e.target.value)}><option value="">اختر السبب</option>{Object.entries(fieldIssueReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>ملاحظتك للموظف<textarea value={issueNote} maxLength={500} onChange={(e) => setIssueNote(e.target.value)} rows={4} placeholder="اشرح المشكلة التي وجدتها بوضوح" /><small>{issueNote.length}/500</small></label>{issueError && <p className="completion-camera-error" role="alert">{issueError}</p>}<div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId) || !issueReason || !issueNote.trim()} onClick={submitIssue}>{busyId ? 'جارٍ الإرسال...' : 'إرسال الملاحظة للمراجعة'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={() => setIssueId(null)}>إلغاء</button></div></section></div>}
    {completionId && <div className="modal-layer field-issue-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && closeCompletion()} /><section className="confirm-modal field-issue-modal completion-modal" role="dialog" aria-modal="true" aria-label="إبلاغ الموظف بإنجاز العمل"><span className="modal-icon"><CheckCheck size={25} /></span><h3>توثيق إنجاز العمل</h3><p>التقط صورة بعد الإصلاح ليراها الموظف بجانب صورة البلاغ الأصلية. تبقى الحالة «قيد المعالجة» حتى يؤكد الحل.</p>{completionPhoto ? <div className="completion-captured"><img src={completionPreview} alt="صورة الإصلاح قبل الإرسال" /><button type="button" className="button button-quiet" disabled={Boolean(busyId)} onClick={() => { locationRequest.current += 1; setCompletionPhoto(null); setCompletionLocation(null); setCompletionLocationState('idle'); }}><RefreshCw size={16} />إعادة التصوير</button></div> : <CompletionCamera onCapture={captureCompletionPhoto} />}{completionPhoto && <p className="completion-location-state">{completionLocationState === 'checking' ? 'جارٍ تحديد موقع الجهاز...' : completionLocationState === 'ready' ? `سُجل موقع الجهاز بدقة تقريبية ${Math.round(completionLocation.accuracy)} م.` : 'تعذّر تحديد موقع الجهاز؛ سيظهر ذلك للموظف.'}</p>}<label>وصف العمل المنجز (اختياري)<textarea value={completionNote} maxLength={500} onChange={(event) => setCompletionNote(event.target.value)} rows={4} placeholder="اكتب ما أُنجز في الموقع إن أردت" /><small>{completionNote.length}/500</small></label>{completionError && <p className="completion-camera-error" role="alert">{completionError}</p>}<div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId) || !completionPhoto || completionLocationState === 'checking'} onClick={submitCompletion}>{busyId ? 'جارٍ الإرسال...' : 'إرسال الإنجاز للمراجعة'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={closeCompletion}>إلغاء</button></div></section></div>}
    {confirmId && <div className="modal-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && setConfirmId(null)} /><div className="confirm-modal" role="dialog" aria-modal="true" aria-label="تأكيد بدء العمل"><span className="modal-icon"><Clock3 size={25} /></span><h3>هل بدأتم العمل فعليًا؟</h3><p>عند التأكيد ستظهر حالة البلاغ للمواطن «قيد المعالجة» وسيُسجل وقت البدء باسم حسابك.</p><div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId)} onClick={() => perform(confirmId, 'start')}>{busyId ? 'جارٍ الحفظ...' : 'نعم، بدأنا العمل'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={() => setConfirmId(null)}>إلغاء</button></div></div></div>}
    {imageReport && imageUrl(imageReport.image_url) && <div className="image-modal" role="dialog" aria-modal="true" aria-label={`صورة البلاغ ${imageReport.id} كاملة`}><button className="image-modal-close" onClick={() => setImageId(null)} aria-label="إغلاق الصورة"><X size={22} /></button><div className="image-modal-stage"><img src={imageUrl(imageReport.image_url)} alt={`صورة البلاغ ${imageReport.id} بحجم كامل`} style={{ transform: `scale(${imageZoom})` }} /></div><div className="image-zoom-controls"><button onClick={() => setImageZoom((zoom) => Math.max(1, zoom - 0.5))} aria-label="تصغير الصورة">−</button><span>{imageZoom.toFixed(1)}×</span><button onClick={() => setImageZoom((zoom) => Math.min(4, zoom + 0.5))} aria-label="تكبير الصورة">+</button></div></div>}
  </main>;
}

