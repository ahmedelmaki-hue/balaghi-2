// One report's details and every staff decision on it.
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Check, CheckCheck, CircleAlert, Clock3, Eye, Image as ImageIcon, MapPin, MapPinned, RefreshCw, RotateCcw, ShieldCheck, X,
} from 'lucide-react';
import { imageUrl, staffApi } from './api.js';
import { buildReportTimeline } from './reportTimeline.js';
import { categories, agencies, agencyTeams, categoryAgency, fieldIssueReasons, verificationResults, fmtDate, number, categoryName, errorText, localPhone, StatusPill, LoadingState } from './shared.jsx';

function LocationCorrectionPicker({ latitude, longitude, onChange }) {
  const container = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!container.current) return undefined;
    const initialLat = Number(latitude); const initialLng = Number(longitude);
    const point = [Number.isFinite(initialLat) ? initialLat : 32.88,
      Number.isFinite(initialLng) ? initialLng : 13.19];
    const instance = L.map(container.current).setView(point, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(instance);
    const pin = L.circleMarker(point, { radius: 10, color: '#fff', weight: 3,
      fillColor: '#c99313', fillOpacity: 1 }).addTo(instance);
    instance.on('click', (event) => change.current(
      event.latlng.lat.toFixed(6), event.latlng.lng.toFixed(6)
    ));
    map.current = instance; marker.current = pin;
    const timer = setTimeout(() => instance.invalidateSize(), 0);
    return () => { clearTimeout(timer); instance.remove(); map.current = null; marker.current = null; };
  }, []);
  useEffect(() => {
    const lat = Number(latitude); const lng = Number(longitude);
    if (marker.current && Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      marker.current.setLatLng([lat, lng]);
    }
  }, [latitude, longitude]);
  return <div className="field-review-map" ref={container} aria-label="اختر الموقع الصحيح بالضغط على الخريطة" />;
}

export function DetailDrawer({ id, onClose, onUpdated, onToast, onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [expandedImage, setExpandedImage] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [tick, setTick] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [nearby, setNearby] = useState(null);
  const detailMap = useRef(null);
  const nearbyLayer = useRef(null);
  const mapContainer = useRef(null);
  useEffect(() => {
    let active = true;
    setData(null); setError('');
    staffApi.report(id).then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [id, tick]);
  // Possible duplicates load on their own, so a failure never hides the report.
  useEffect(() => {
    let active = true;
    setNearby(null);
    staffApi.nearby(id).then((result) => { if (active) setNearby(result); }).catch(() => {});
    return () => { active = false; };
  }, [id, tick]);
  useEffect(() => {
    if (data?.report) {
      setSelectedCategory(data.report.category);
      setLatitude(String(data.report.latitude));
      setLongitude(String(data.report.longitude));
    }
  }, [data]);
  useEffect(() => {
    if (!data?.report || !mapContainer.current || detailMap.current) return;
    const point = [Number(data.report.latitude), Number(data.report.longitude)];
    const instance = L.map(mapContainer.current, { zoomControl: false, dragging: false, scrollWheelZoom: false }).setView(point, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(instance);
    L.circleMarker(point, { radius: 10, color: '#fff', weight: 3, fillColor: '#126477', fillOpacity: 1 }).addTo(instance);
    detailMap.current = instance;
    nearbyLayer.current = L.layerGroup().addTo(instance);
    return () => { instance.remove(); detailMap.current = null; nearbyLayer.current = null; };
  }, [data]);
  useEffect(() => {
    const layer = nearbyLayer.current;
    if (!layer) return;
    layer.clearLayers();
    (nearby?.items || []).forEach((item) => {
      L.circleMarker([Number(item.latitude), Number(item.longitude)], { radius: 7, color: '#fff', weight: 2, fillColor: '#e5a93c', fillOpacity: 1 })
        .bindTooltip(`بلاغ #${item.id} · ${number(item.distance_m)} م`).addTo(layer);
    });
  }, [nearby, data]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (expandedImage) setExpandedImage(null);
        else if (modal) setModal(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedImage, modal, onClose]);
  const report = data?.report;
  const pendingFieldIssue = data?.field_reviews?.find((item) => !item.decision);
  const pendingCompletion = data?.completions?.find((item) => !item.decision);
  const latestVerification = data?.verifications?.[0];
  const verificationOpen = Boolean(latestVerification && !latestVerification.result);
  const verificationNeedsLocation = latestVerification?.result === 'wrong_location' &&
    !latestVerification.corrected_at;
  const pending = report?.status === 'new' && !report?.approved_at;
  const approvedNew = report?.status === 'new' && Boolean(report?.approved_at);
  const inProgress = report?.status === 'in_progress';
  const timeline = report ? buildReportTimeline(report, data?.status_history, data?.field_reviews, {
    agencyName: agencies[report.assigned_agency] || 'جهة العمل المختصة',
    reasonNames: fieldIssueReasons,
  }, data?.completions) : [];
  const submitAction = async () => {
    if (!report || !modal || busy || (modal === 'reject' && (!reason.trim() || reason.trim().length > 500)) ||
        (modal === 'release' && !reason.trim()) ||
        (modal === 'completionReturn' && !reason.trim()) ||
        (modal === 'fieldReject' && !reason.trim()) ||
        (['fieldCorrect', 'verifyLocation'].includes(modal) && (!latitude.trim() || !longitude.trim())) ||
        (modal === 'verifyLocation' && Number(latitude) === Number(report.latitude) &&
          Number(longitude) === Number(report.longitude)) ||
        (modal === 'category' && (selectedCategory === report.category || verificationOpen)) ||
        (['approve', 'verifyRequest'].includes(modal) && selectedCategory !== report.category) ||
        (['verifyRequest', 'verifyCancel'].includes(modal) && !reason.trim())) return;
    setBusy(true); setError('');
    try {
      if (modal === 'approve') await staffApi.approve(id);
      else if (modal === 'category') await staffApi.correctCategory(id, selectedCategory);
      else if (modal === 'verifyRequest') await staffApi.requestVerification(id, reason.trim());
      else if (modal === 'verifyCancel') await staffApi.cancelVerification(id, reason.trim());
      else if (modal === 'verifyLocation') await staffApi.correctVerificationLocation(id, latitude.trim(), longitude.trim());
      else if (modal === 'reject') await staffApi.changeStatus(id, 'rejected', reason.trim());
      else if (modal === 'release') await staffApi.releaseReport(id, reason.trim());
      else if (modal === 'fieldContinue') await staffApi.reviewFieldIssue(id, { decision: 'continue', note: reason.trim() });
      else if (modal === 'fieldCorrect') await staffApi.reviewFieldIssue(id, {
        decision: 'correct_location', latitude: latitude.trim(), longitude: longitude.trim(), note: reason.trim(),
      });
      else if (modal === 'fieldReject') await staffApi.reviewFieldIssue(id, { decision: 'reject', note: reason.trim() });
      else if (modal === 'completionConfirm') await staffApi.reviewCompletion(id, 'confirmed');
      else if (modal === 'completionReturn') await staffApi.reviewCompletion(id, 'returned', reason.trim());
      setModal(null); setReason(''); onUpdated();
      onToast({ approve: 'تم اعتماد البلاغ ونشره وإسناده تلقائيًا إلى جهة العمل المختصة.', category: 'تم تصحيح تصنيف البلاغ.', verifyRequest: 'أُرسل طلب التحقق إلى جهة العمل وبقي البلاغ غير منشور.', verifyCancel: 'أُلغي طلب التحقق ويمكنك اتخاذ قرار بشأن البلاغ.', verifyLocation: 'تم تصحيح موقع البلاغ؛ راجعه قبل الاعتماد.', reject: 'تم رفض البلاغ وحفظ السبب.', release: 'أُعيد البلاغ إلى قائمة جهة العمل ليستلمه عامل آخر.', completionConfirm: 'تم تأكيد الحل وإغلاق البلاغ.', completionReturn: 'أُعيد البلاغ إلى جهة العمل مع سبب المراجعة.', fieldContinue: 'تمت مراجعة الملاحظة واستؤنف البلاغ.', fieldCorrect: 'تم تصحيح الموقع واستؤنف البلاغ.', fieldReject: 'تم رفض البلاغ بعد المراجعة الميدانية.' }[modal]);
      if (['approve', 'verifyRequest', 'fieldContinue', 'fieldCorrect', 'fieldReject', 'completionConfirm', 'completionReturn', 'release'].includes(modal)) onClose();
      else setTick((n) => n + 1);
    } catch (cause) { setError(errorText(cause)); setModal(null); setTick((n) => n + 1); }
    finally { setBusy(false); }
  };
  const image = imageUrl(report?.image_url);
  const nearbyItems = nearby?.items || [];
  const repairs = (data?.completions || []).filter((item) => item.after_image_url);
  const repairDecision = (item) => (item.decision === 'confirmed' ? 'مؤكد' : item.decision === 'returned' ? 'أُعيد للعمل' : 'بانتظار قرارك');
  const duplicateReason = (otherId) => `مكرر: سبق الإبلاغ عن المشكلة نفسها في البلاغ #${otherId}.`;
  return <div className="drawer-layer"><button className="drawer-backdrop" aria-label="إغلاق التفاصيل" onClick={onClose} /><aside className="detail-drawer dd" role="dialog" aria-modal="true" aria-label={`تفاصيل البلاغ ${id}`}>
    <div className="drawer-head dd-head"><div><span className="eyebrow">{pending ? 'فحص البلاغ' : 'تفاصيل البلاغ'}</span><h2>بلاغ #{id}{report && <span className="dd-head-cat">{categoryName(report.category)}</span>}</h2>{report && <small className="dd-head-date">أُرسل {fmtDate(report.created_at)}</small>}</div><div className="drawer-head-actions">{report && <StatusPill report={report} />}<button className="icon-button" aria-label="تحديث تفاصيل البلاغ" title="تحديث التفاصيل" onClick={() => setTick((value) => value + 1)}><RefreshCw size={19} /></button><button className="icon-button" aria-label="إغلاق التفاصيل" onClick={onClose}><X size={20} /></button></div></div>
    {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((n) => n + 1)}>تحديث</button></div>}
    {!report ? (error ? null : <LoadingState />) : <><div className="drawer-content dd-content">
      {report.assigned_worker_id && report.assigned_worker_active === false && ['new', 'in_progress'].includes(report.status) && <div className="inline-note" role="status">العامل الذي استلم هذا البلاغ ({report.assigned_worker_name || report.assigned_worker_username}) حسابه معطّل. أعد البلاغ إلى قائمة الجهة ليستلمه عامل آخر.</div>}

      {pending && <section className="dd-decide" aria-labelledby="dd-decide-title">
        <h3 id="dd-decide-title">بانتظار مراجعتك</h3>
        <p>تأكد من الصورة والموقع والتصنيف، ثم اعتمد البلاغ أو اطلب تحققًا ميدانيًا أو ارفضه.</p>
        {nearbyItems.length > 0 && <a className="dd-decide-warn" href="#nearby-title"><CircleAlert size={15} />قد يكون مكررًا: <span className="num">{number(nearbyItems.length)}</span> بلاغ قريب من التصنيف نفسه</a>}
        <div className="dd-category"><label className="assignment-picker">التصنيف<select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} disabled={verificationOpen}>{Object.entries(categories).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label><span>الجهة عند الاعتماد: <strong>{agencies[categoryAgency[selectedCategory]]}</strong></span>{selectedCategory !== report.category && <button className="button button-quiet" disabled={busy || verificationOpen} onClick={() => setModal('category')}>حفظ التصنيف</button>}</div>
        {selectedCategory !== report.category && <small>احفظ التصنيف قبل اعتماد البلاغ أو طلب التحقق.</small>}
        {verificationOpen && <small>أكمل طلب التحقق أو ألغِه قبل تغيير التصنيف.</small>}
      </section>}
      {pendingFieldIssue && <section className="dd-decide is-issue" aria-labelledby="dd-issue-title">
        <h3 id="dd-issue-title">ملاحظة الفريق · تحتاج قرارك</h3>
        <p><strong>{fieldIssueReasons[pendingFieldIssue.reason]}</strong> · {agencyTeams[report.assigned_agency] || 'فريق جهة العمل'}</p>
        <p>{pendingFieldIssue.note}</p><small>{fmtDate(pendingFieldIssue.raised_at)}</small>
      </section>}
      {pendingCompletion && <section className="dd-decide is-done" aria-labelledby="dd-done-title">
        <h3 id="dd-done-title">إنجاز العمل · بانتظار تأكيدك</h3>
        <p>أبلغ {pendingCompletion.worker_name || pendingCompletion.worker_username || 'العامل الميداني'} بإتمام العمل.{pendingCompletion.note && <> وصف العمل: {pendingCompletion.note}</>}</p><small>وقت الإرسال: {fmtDate(pendingCompletion.submitted_at)}</small>
      </section>}

      {repairs.length > 0 && <section className="dd-block dd-repair" aria-labelledby="dd-repair-title"><h4 id="dd-repair-title">صور الإصلاح</h4>
        <div className="dd-compare">
          <figure><button type="button" className="dd-photo" onClick={() => { if (image) { setExpandedImage(image); setZoom(1); } }} disabled={!image} aria-label="عرض صورة البلاغ قبل الإصلاح">{image ? <img src={image} alt="صورة المشكلة قبل الإصلاح" /> : <span><ImageIcon size={28} />لا توجد صورة</span>}</button>
            <figcaption><span><strong>قبل</strong> · صورة البلاغ</span><small>{fmtDate(report.created_at)}</small></figcaption></figure>
          <figure><button type="button" className="dd-photo" onClick={() => { setExpandedImage(imageUrl(repairs[0].after_image_url)); setZoom(1); }} aria-label="عرض صورة الإصلاح"><img src={imageUrl(repairs[0].after_image_url)} alt={`صورة الإصلاح المرسلة في ${fmtDate(repairs[0].submitted_at)}`} /></button>
            <figcaption><span><strong>بعد</strong> · {repairDecision(repairs[0])}</span><small>{fmtDate(repairs[0].submitted_at)}</small>
              {repairs[0].photo_latitude !== null && repairs[0].photo_longitude !== null ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${repairs[0].photo_latitude},${repairs[0].photo_longitude}`)}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} />موقع الجهاز عند التصوير{repairs[0].photo_accuracy_m !== null ? ` · دقة ${number(Math.round(Number(repairs[0].photo_accuracy_m)))} م` : ''}</a> : <small>لم يتوفر موقع الجهاز عند التصوير.</small>}</figcaption></figure>
        </div>
        {repairs.length > 1 && <div className="dd-attempts"><span>محاولات سابقة</span>{repairs.slice(1).map((item) => <button type="button" key={item.id} onClick={() => { setExpandedImage(imageUrl(item.after_image_url)); setZoom(1); }} aria-label={`عرض صورة الإصلاح المرسلة في ${fmtDate(item.submitted_at)}`}><img src={imageUrl(item.after_image_url)} alt="" /><span>{repairDecision(item)}<small>{fmtDate(item.submitted_at)}</small></span></button>)}</div>}
        <p className="dd-repair-hint">قارن الصورتين والموقع قبل تأكيد الحل؛ الصورة وحدها لا تثبت اكتمال العمل.</p>
      </section>}

      <div className={`dd-media ${repairs.length ? 'is-map-only' : ''}`}>
        {!repairs.length && <>
        <button className="detail-image" onClick={() => { if (image) { setExpandedImage(image); setZoom(1); } }} disabled={!image} aria-label="عرض صورة البلاغ كاملة">
          {image ? <img src={image} alt={`صورة البلاغ ${id}`} /> : <span><ImageIcon size={32} />لا توجد صورة متاحة</span>}
          {image && <span className="image-expand"><Eye size={16} />عرض الصورة كاملة</span>}
        </button></>}
        <div className="dd-place">
          <div className="detail-map" ref={mapContainer} />
          <p className="detail-location"><MapPin size={15} />{report.address_text || 'الموقع محدد بالإحداثيات'}</p>
          <div className="dd-place-foot"><small className="coordinates" dir="ltr">{Number(report.latitude).toFixed(6)}, {Number(report.longitude).toFixed(6)}</small><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(report.latitude)},${Number(report.longitude)}`)}`} target="_blank" rel="noopener noreferrer"><MapPinned size={15} />فتح في Google Maps</a></div>
        </div>
      </div>

      <section className="dd-block"><h4>وصف المشكلة</h4><p className={report.description ? '' : 'is-empty'}>{report.description || 'لم يُضف المواطن وصفًا.'}</p></section>

      <section className="dd-block"><h4>البيانات <span className="private-tag">للموظف فقط</span></h4><dl className="dd-facts">
        <div><dt>مقدم البلاغ</dt><dd>{report.reporter_name || 'غير محدد'}</dd></div>
        <div><dt>رقم الهاتف</dt><dd dir="ltr">{report.reporter_phone ? localPhone(report.reporter_phone) : '—'}</dd></div>
        {report.approved_at && report.status !== 'rejected' && <>
          <div><dt>جهة العمل</dt><dd>{report.assigned_agency ? agencies[report.assigned_agency] || report.assigned_agency : 'لم تُحدّد'}</dd></div>
          <div><dt>الاستلام</dt><dd>{report.assigned_worker_id ? `${report.assigned_worker_name || report.assigned_worker_username || 'عامل'} · ${report.work_started_at ? 'بدأ العمل' : 'استلمه'}` : 'بانتظار الاستلام'}</dd></div>
          {report.assigned_at && <div><dt>تاريخ الإسناد</dt><dd>{fmtDate(report.assigned_at)}</dd></div>}
        </>}
      </dl></section>

      {report.status === 'rejected' && <section className="dd-block rejection-reason"><h4>سبب الرفض</h4><p>{report.rejection_reason || 'لم يُسجل سبب.'}</p></section>}

      {(nearbyItems.length > 0 || (pending && nearby)) && <section className={`detail-section nearby-section ${pending && nearbyItems.length ? 'is-warning' : ''}`} aria-labelledby="nearby-title"><h4 id="nearby-title">بلاغات قريبة من التصنيف نفسه{nearbyItems.length > 0 && <span className="nearby-count">{number(nearbyItems.length)}</span>}</h4>
        {nearbyItems.length ? <><ul className="nearby-list">{nearbyItems.map((item) => <li key={item.id}><button type="button" onClick={() => onOpen?.(item.id)} aria-label={`فتح البلاغ ${item.id}`}>
          <span className="nearby-thumb">{imageUrl(item.image_url) ? <img src={imageUrl(item.image_url)} alt="" /> : <ImageIcon size={18} />}</span>
          <span className="nearby-main"><strong>بلاغ #{item.id}</strong><small>على بعد {number(item.distance_m)} م · {fmtDate(item.created_at)}</small>{item.description && <em>{item.description}</em>}</span>
          <StatusPill report={item} /></button></li>)}</ul><small className="nearby-note">تظهر بلاغات التصنيف نفسه خلال {number(nearby.radius_m)} م التي لم تُرفض، والمحلولة منها خلال آخر 30 يومًا فقط. النقاط الذهبية على الخريطة أعلاه.</small></>
          : <p className="nearby-empty">لا توجد بلاغات أخرى من التصنيف نفسه خلال {number(nearby.radius_m)} م.</p>}
      </section>}

      {latestVerification && <section className="detail-section verification-summary"><h4>التحقق الميداني قبل الاعتماد</h4><p>جهة التحقق: <strong>{agencyTeams[latestVerification.agency] || agencies[latestVerification.agency]}</strong></p><p>سبب الطلب: {latestVerification.request_note}</p><small>أُرسل الطلب: {fmtDate(latestVerification.requested_at)}</small><p><strong>{verificationOpen ? (latestVerification.claimed_at ? 'استلم الفريق المهمة، بانتظار النتيجة' : 'بانتظار استلام جهة العمل') : verificationResults[latestVerification.result]}</strong></p>{latestVerification.result_note && <p>ملاحظة النتيجة: {latestVerification.result_note}</p>}{latestVerification.completed_at && <small>وقت الرد: {fmtDate(latestVerification.completed_at)}</small>}</section>}
      {latestVerification?.corrected_at && <section className="detail-section verification-summary"><h4>تصحيح الموقع قبل النشر</h4><p>صحح الموظف موقع البلاغ بعد رد جهة العمل.</p><small>{fmtDate(latestVerification.corrected_at)}</small></section>}

      <section className="dd-block"><h4>سجل المتابعة</h4><div className="timeline">{timeline.map((event) => <div className="timeline-item" key={event.key}><i /><span><strong>{event.title}</strong><small>{fmtDate(event.at)}{event.actor ? ` · ${event.actor}` : ''}</small>{event.detail && <em>{event.detail}</em>}</span></div>)}</div></section>
    </div>
      {(pending || approvedNew || inProgress) && <div className={`drawer-actions ${pendingFieldIssue ? 'field-review-actions' : ''}`}>
        {pendingFieldIssue ? <><button className="button button-gold" onClick={() => setModal('fieldContinue')}><Check size={18} />متابعة البلاغ</button><button className="button button-quiet" onClick={() => setModal('fieldCorrect')}><MapPin size={18} />تصحيح الموقع</button><button className="button button-danger-quiet" onClick={() => setModal('fieldReject')}>رفض البلاغ</button></> : <>
          {pending && (verificationOpen ? <button className="button button-quiet" onClick={() => { setReason(''); setModal('verifyCancel'); }}><X size={18} />إلغاء طلب التحقق</button> : <><button className="button button-gold" disabled={verificationNeedsLocation || selectedCategory !== report.category} onClick={() => setModal('approve')}><Check size={18} />اعتماد البلاغ ونشره</button>{verificationNeedsLocation && <button className="button button-quiet" onClick={() => setModal('verifyLocation')}><MapPin size={18} />تصحيح الموقع قبل النشر</button>}<button className="button button-quiet" disabled={selectedCategory !== report.category} onClick={() => { setReason(''); setModal('verifyRequest'); }}><MapPin size={18} />طلب تحقق ميداني</button><button className="button button-danger-quiet" onClick={() => setModal('reject')}>رفض البلاغ</button></>)}
          {approvedNew && <>{report.assigned_worker_id && !pendingFieldIssue && <button className="button button-quiet" onClick={() => { setReason(''); setModal('release'); }}><RotateCcw size={18} />إعادة إلى قائمة الجهة</button>}<button className="button button-danger-quiet" onClick={() => setModal('reject')}>رفض البلاغ</button></>}
          {inProgress && (pendingCompletion ? <><button className="button button-gold" onClick={() => setModal('completionConfirm')}><CheckCheck size={18} />تأكيد الحل</button><button className="button button-quiet" onClick={() => { setReason(''); setModal('completionReturn'); }}><Clock3 size={18} />إعادته للعمل</button></> : <>{!pendingFieldIssue && <button className="button button-quiet" onClick={() => { setReason(''); setModal('release'); }}><RotateCcw size={18} />إعادة إلى قائمة الجهة</button>}<button className="button button-danger-quiet" onClick={() => setModal('reject')}>رفض البلاغ</button></>)}
        </>}
      </div>}
    </>}
  </aside>
    {modal && <div className="modal-layer"><button className="modal-backdrop" aria-label="إلغاء الإجراء" onClick={() => !busy && setModal(null)} /><div className="confirm-modal" role="dialog" aria-modal="true" aria-label="تأكيد الإجراء">
      <span className={`modal-icon ${['reject', 'fieldReject'].includes(modal) ? 'danger' : ''}`}>{['reject', 'fieldReject'].includes(modal) ? <CircleAlert size={25} /> : <ShieldCheck size={25} />}</span>
      <h3>{{ approve: 'اعتماد هذا البلاغ؟', verifyRequest: 'طلب تحقق ميداني قبل النشر؟', verifyCancel: 'إلغاء طلب التحقق؟', verifyLocation: 'تصحيح موقع البلاغ قبل النشر', category: 'تصحيح تصنيف البلاغ؟', reject: 'رفض هذا البلاغ؟', release: 'إعادة البلاغ إلى قائمة جهة العمل؟', completionConfirm: 'تأكيد حل البلاغ؟', completionReturn: 'إعادة البلاغ للعمل؟', fieldContinue: 'متابعة البلاغ؟', fieldCorrect: 'تصحيح موقع البلاغ؟', fieldReject: 'رفض البلاغ بعد المراجعة؟' }[modal]}</h3>
      <p>{{ approve: `سيظهر البلاغ للمواطنين بحالة «جديد»، ويُسند تلقائيًا إلى ${agencies[categoryAgency[report?.category]] || 'جهة العمل المختصة'}.`, verifyRequest: `سيصل طلب التحقق إلى ${agencies[categoryAgency[report?.category]] || 'جهة العمل المختصة'}، ويبقى البلاغ غير منشور حتى تقرر اعتماده أو رفضه.`, verifyCancel: 'سيُغلق طلب التحقق المفتوح، ويمكنك اتخاذ قرار بشأن البلاغ أو إرسال طلب جديد.', category: 'سيُستخدم التصنيف الصحيح لتحديد جهة العمل عند الاعتماد وطلب التحقق الميداني.', reject: report?.approved_at ? 'سيُزال البلاغ من الخريطة العامة، وسيظهر سبب الرفض لصاحبه.' : 'لن يظهر البلاغ على الخريطة العامة، وسيظهر سبب الرفض لصاحبه.', release: report?.status === 'in_progress' ? 'سيُفك البلاغ عن عامله الحالي ويعود إلى قائمة الجهة، وتعود حالته للمواطن «جديد» حتى يبدأ عامل آخر العمل.' : 'سيُفك البلاغ عن عامله الحالي ويعود إلى قائمة الجهة ليستلمه عامل آخر.', completionConfirm: 'راجِع ما أرسله العامل. عند التأكيد ستظهر الحالة للمواطن «تم الحل».', completionReturn: 'سيبقى البلاغ «قيد المعالجة» ويعود للعامل لاستكمال العمل. اكتب سببًا واضحًا.', fieldContinue: 'ستنتهي المراجعة ويعود البلاغ إلى الخريطة والعامل الحالي.', fieldCorrect: 'احرص على إدخال إحداثيات الموقع الصحيح. سيعود البلاغ للعامل الحالي بحالته السابقة.', fieldReject: 'سيُزال البلاغ من الخريطة، وسيظهر سبب الرفض لصاحبه.' }[modal]}</p>
      {['fieldCorrect', 'verifyLocation'].includes(modal) && <><p>اضغط على الموقع الصحيح في الخريطة، أو عدّل الإحداثيات يدويًا. يجب أن يكون داخل نطاق طرابلس المركز.</p><LocationCorrectionPicker latitude={latitude} longitude={longitude} onChange={(lat, lng) => { setLatitude(lat); setLongitude(lng); }} /><div className="field-review-coordinates"><label>خط العرض<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label><label>خط الطول<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label></div></>}
      {modal === 'reject' && nearbyItems.length > 0 && <div className="nearby-reasons"><small>رفض كمكرر:</small>{nearbyItems.slice(0, 3).map((item) => <button type="button" key={item.id} className={reason === duplicateReason(item.id) ? 'is-active' : ''} onClick={() => setReason(duplicateReason(item.id))}>مكرر للبلاغ #{item.id}</button>)}</div>}
      {['reject', 'fieldReject', 'fieldContinue', 'fieldCorrect', 'verifyRequest', 'verifyCancel', 'completionReturn', 'release'].includes(modal) && <label className="reason-label">{['reject', 'fieldReject'].includes(modal) ? 'سبب الرفض' : modal === 'release' ? 'سبب الإعادة' : modal === 'verifyRequest' ? 'سبب طلب التحقق' : modal === 'verifyCancel' ? 'سبب إلغاء الطلب' : modal === 'completionReturn' ? 'سبب إعادة العمل' : 'ملاحظة القرار'} {['reject', 'fieldReject', 'verifyRequest', 'verifyCancel', 'completionReturn', 'release'].includes(modal) && <span>إلزامي</span>}<textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={['reject', 'fieldReject'].includes(modal) ? 'اكتب سببًا واضحًا يفهمه مقدم البلاغ' : modal === 'verifyRequest' ? 'ما الذي يحتاج إلى فحص في الموقع؟' : modal === 'verifyCancel' ? 'لماذا أُلغي طلب التحقق؟' : modal === 'completionReturn' ? 'ما الذي يحتاج إلى استكمال؟' : modal === 'release' ? 'مثل: العامل أنهى عقده أو في إجازة' : 'ملاحظة اختيارية للمتابعة الداخلية'} rows={4} /><small>{reason.length}/500</small></label>}
      <div className="modal-actions"><button className={`button ${['reject', 'fieldReject'].includes(modal) ? 'button-danger' : 'button-gold'}`} disabled={busy || (['reject', 'fieldReject', 'verifyRequest', 'verifyCancel', 'completionReturn', 'release'].includes(modal) && !reason.trim()) || (['fieldCorrect', 'verifyLocation'].includes(modal) && (!latitude.trim() || !longitude.trim())) || (modal === 'verifyLocation' && Number(latitude) === Number(report.latitude) && Number(longitude) === Number(report.longitude))} onClick={submitAction}>{busy ? 'جارٍ الحفظ...' : { approve: 'اعتماد البلاغ ونشره بحالة جديد', verifyRequest: 'إرسال طلب التحقق', verifyCancel: 'تأكيد إلغاء الطلب', verifyLocation: 'حفظ الموقع المصحح', category: 'حفظ التصنيف', reject: 'تأكيد الرفض', completionConfirm: 'تأكيد الحل', completionReturn: 'إعادته للعمل', release: 'إعادة إلى قائمة الجهة', fieldContinue: 'متابعة البلاغ', fieldCorrect: 'تأكيد تصحيح الموقع', fieldReject: 'تأكيد الرفض' }[modal]}</button><button className="button button-quiet" disabled={busy} onClick={() => setModal(null)}>إلغاء</button></div>
    </div></div>}
    {expandedImage && <div className="image-modal" role="dialog" aria-modal="true" aria-label="عرض الصورة كاملة"><button className="image-modal-close" onClick={() => setExpandedImage(null)} aria-label="إغلاق الصورة"><X size={22} /></button><div className="image-modal-stage"><img src={expandedImage} alt={`صورة البلاغ ${id}`} style={{ transform: `scale(${zoom})` }} /></div><div className="image-zoom-controls"><button onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>−</button><span>{zoom.toFixed(1)}×</span><button onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>+</button></div></div>}
  </div>;
}

