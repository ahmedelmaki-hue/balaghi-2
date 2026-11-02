// The overview: what waits for the staff member's decision.
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowLeft, CircleAlert, Menu, RefreshCw, Search,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { categories, fmtDate, number, reportSearchId, categoryName, errorText, VerificationState, ReportThumbnail, EmptyState, LoadingState } from '../shared.jsx';

const relativeTime = new Intl.RelativeTimeFormat('ar-LY', { numeric: 'auto' });
const clockTime = new Intl.DateTimeFormat('ar-LY', { timeStyle: 'short' });

// "قبل ساعتين", "أمس": how long a report has been waiting.
function since(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return relativeTime.format(-minutes, 'minute');
  if (minutes < 60 * 24) return relativeTime.format(-Math.round(minutes / 60), 'hour');
  return relativeTime.format(-Math.round(minutes / 1440), 'day');
}

// Arabic number agreement: بلاغ واحد ينتظر، بلاغان ينتظران، 3 بلاغات تنتظر، 11 بلاغًا ينتظر.
function waitingReports(count) {
  if (count === 1) return 'بلاغ واحد ينتظر';
  if (count === 2) return 'بلاغان ينتظران';
  if (count <= 10) return `${number(count)} بلاغات تنتظر`;
  return `${number(count)} بلاغًا ينتظر`;
}

function OverviewMap({ onOpen, onNavigate, refreshKey, categoryCounts, totalReports }) {
  const container = useRef(null);
  const map = useRef(null);
  const markers = useRef(null);
  const [bounds, setBounds] = useState('');
  const [count, setCount] = useState(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!container.current) return undefined;
    const instance = L.map(container.current, {
      zoomControl: false, scrollWheelZoom: false,
    }).setView([32.8872, 13.1913], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(instance);
    const layer = L.layerGroup().addTo(instance);
    map.current = instance;
    markers.current = layer;
    const updateBounds = () => {
      const view = instance.getBounds();
      setBounds(`${view.getWest()},${view.getSouth()},${view.getEast()},${view.getNorth()}`);
    };
    instance.on('moveend', updateBounds);
    instance.invalidateSize();
    updateBounds();
    return () => {
      instance.off('moveend', updateBounds);
      instance.remove();
      map.current = null;
      markers.current = null;
    };
  }, []);

  useEffect(() => {
    if (!bounds || !markers.current) return undefined;
    let active = true;
    staffApi.publicMarkers(bounds).then((result) => {
      if (!active || !markers.current) return;
      markers.current.clearLayers();
      result.items.forEach((report) => {
        const lat = Number(report.latitude);
        const lng = Number(report.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const color = { new: '#c93636', in_progress: '#2d8bc4', resolved: '#4b9a67' }[report.status] || '#c93636';
        L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
          .on('click', () => onOpen(report.id)).addTo(markers.current);
      });
      setCount(result.items.length);
      setMore(Boolean(result.next_cursor));
      setError(false);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [bounds, refreshKey, onOpen]);

  const largest = Math.max(1, ...Object.keys(categories).map((key) => Number(categoryCounts[key]) || 0));
  return <section className="ov-card ov-map-card" aria-labelledby="ov-map-title">
    <header className="ov-card-head">
      <div><h2 id="ov-map-title">البلاغات المعتمدة على الخريطة</h2>
        <p>{error ? 'تعذّر تحميل البلاغات على الخريطة.' : count === null ? 'جارٍ تحميل البلاغات…' : `${more ? 'أكثر من ' : ''}${number(count)} بلاغ في النطاق المعروض`}</p></div>
      <button type="button" className="ov-link" onClick={() => onNavigate('map')}>فتح الخريطة<ArrowLeft size={15} /></button>
    </header>
    <div className="ov-map" ref={container} aria-label="خريطة مصغّرة للبلاغات المعتمدة" />
    <p className="ov-legend" aria-label="ألوان الحالات على الخريطة">
      <span><i className="ov-dot is-new" />جديد</span><span><i className="ov-dot is-progress" />قيد المعالجة</span><span><i className="ov-dot is-resolved" />تم الحل</span>
    </p>
    <div className="ov-categories">
      <h3>حسب التصنيف<small>من {number(totalReports)} بلاغ مسجّل</small></h3>
      {Object.entries(categories).map(([key, item]) => {
        const value = Number(categoryCounts[key]) || 0;
        return <div className="ov-category" key={key}>
          <span className="ov-category-name">{item.label}</span>
          <span className="ov-category-value num">{number(value)}</span>
          <span className="ov-category-bar" aria-hidden="true"><i style={{ width: `${value / largest * 100}%` }} /></span>
        </div>;
      })}
    </div>
  </section>;
}

function FlowStage({ label, tone, value, note, lead = false, onClick }) {
  return <button type="button" className={`ov-stage ${lead ? 'is-lead' : ''}`} onClick={onClick}>
    <span className="ov-stage-label"><i className={`ov-dot is-${tone}`} />{label}</span>
    <strong className="num">{number(value)}</strong>
    <small>{note}</small>
  </button>;
}

export function OverviewPage({ user, onOpen, onNavigate, refreshKey, onMenu }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [loadedAt, setLoadedAt] = useState(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      staffApi.overview(),
      staffApi.reports({ review: 'pending', sort: 'oldest', limit: 1 }),
      staffApi.reports({ review: 'pending', category, sort: 'oldest', limit: 5 }),
      staffApi.reports({ acceptance: 'pending', limit: 1 }),
    ])
      .then(([stats, oldest, queue, unclaimed]) => {
        if (!active) return;
        setData({ stats, oldest, queue, unclaimed }); setError(''); setLoadedAt(new Date());
      })
      .catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [refreshKey, tick, category]);

  const counts = Object.fromEntries((data?.stats.byStatus || []).map((item) => [item.status, item.count]));
  const categoryCounts = Object.fromEntries((data?.stats.byCategory || []).map((item) => [item.category, item.count]));
  const pending = data?.oldest.total || 0;
  const oldest = data?.oldest.items[0];
  const publishedNew = Math.max(0, (counts.new || 0) - pending);
  const inProgress = counts.in_progress || 0;
  const resolved = counts.resolved || 0;
  const awaitingConfirmation = data?.stats.pending_completion || 0;
  const fieldReview = data?.stats.pending_field_review || 0;
  const approvedTotal = publishedNew + inProgress + resolved;
  const finding = !data ? 'جارٍ تحميل ما ينتظر قرارك…'
    : pending ? `${waitingReports(pending)} قرار الاعتماد، أقدمها أُرسل ${since(oldest.created_at)}.`
      : 'لا توجد بلاغات تنتظر قرار الاعتماد الآن.';
  const submitSearch = (event) => {
    event.preventDefault();
    const id = reportSearchId(search);
    if (!id) {
      setSearchError('أدخل رقم بلاغ صحيحًا.');
      return;
    }
    setSearchError('');
    onOpen(id);
  };
  const filters = [['', 'الكل'], ...Object.entries(categories).map(([key, item]) => [key, item.label])];

  return <div className="ov">
    <header className="ov-head">
      <div className="ov-title">
        <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
        <div><h1>نظرة عامة</h1><p className="ov-finding">{finding}</p></div>
      </div>
      <div className="ov-tools">
        <form className="ov-search" onSubmit={submitSearch} role="search">
          <Search size={16} />
          <input type="search" inputMode="numeric" value={search} onChange={(event) => { setSearch(event.target.value); setSearchError(''); }} placeholder="رقم البلاغ" aria-label="بحث برقم البلاغ" aria-invalid={Boolean(searchError)} />
          <button type="submit">فتح</button>
        </form>
        <button type="button" className="ov-refresh" onClick={() => setTick((n) => n + 1)} aria-label="تحديث البيانات" title="تحديث البيانات">
          <RefreshCw size={16} />{loadedAt && <span>آخر تحديث {clockTime.format(loadedAt)}</span>}
        </button>
        {oldest && <button type="button" className="ov-primary" onClick={() => onOpen(oldest.id)}>مراجعة الأقدم<ArrowLeft size={16} /></button>}
      </div>
    </header>
    {searchError && <p className="ov-search-error" role="alert">{searchError}</p>}

    {error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل النظرة العامة" detail={error} onRetry={() => setTick((n) => n + 1)} />
      : !data ? <LoadingState /> : <>
        <section className="ov-flow" aria-label="مسار البلاغ من الإرسال إلى الحل">
          <FlowStage lead label="بانتظار المراجعة" tone="pending" value={pending}
            note={pending ? `أقدمها ${since(oldest.created_at)}` : 'لا شيء ينتظر الآن'} onClick={() => onNavigate('pending')} />
          <FlowStage label="جديد" tone="new" value={publishedNew}
            note={data.unclaimed.total ? `${number(data.unclaimed.total)} لم يستلمها عامل بعد` : 'كلها مستلمة'} onClick={() => onNavigate('reports')} />
          <FlowStage label="قيد المعالجة" tone="progress" value={inProgress}
            note={awaitingConfirmation ? `${number(awaitingConfirmation)} بانتظار تأكيد الحل` : 'لا إنجاز ينتظر التأكيد'}
            onClick={() => onNavigate(awaitingConfirmation ? 'completion' : 'reports')} />
          <FlowStage label="تم الحل" tone="resolved" value={resolved}
            note={approvedTotal ? `${number(Math.round(resolved / approvedTotal * 100))}% من البلاغات المعتمدة` : '—'} onClick={() => onNavigate('reports')} />
          <div className="ov-stage ov-stage-total">
            <span className="ov-stage-label">كل البلاغات</span>
            <strong className="num">{number(data.stats.total)}</strong>
            <small>منها {number(counts.rejected || 0)} مرفوض</small>
          </div>
        </section>

        <div className="ov-grid">
          <div className="ov-column">
            <section className="ov-card ov-queue" aria-labelledby="ov-queue-title">
              <header className="ov-card-head">
                <div><h2 id="ov-queue-title">بانتظار الاعتماد</h2>
                  <p>الأقدم أولًا · {number(data.queue.total)} {category ? `في «${categoryName(category)}»` : 'بلاغ'}</p></div>
                <div className="ov-segment" role="group" aria-label="تصفية التصنيف">
                  {filters.map(([key, label]) => <button type="button" key={key || 'all'} className={category === key ? 'is-active' : ''} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}
                </div>
              </header>
              {data.queue.items.length ? <ol className="ov-rows">
                {data.queue.items.map((report) => <li key={report.id}>
                  <button type="button" className="ov-row" onClick={() => onOpen(report.id)} aria-label={`مراجعة البلاغ ${report.id}`}>
                    <ReportThumbnail report={report} />
                    <span className="ov-row-main">
                      <strong>بلاغ #{report.id} · {categoryName(report.category)}</strong>
                      <small>{report.description || report.address_text || 'لم يُضف وصف.'}</small>
                    </span>
                    <span className="ov-row-meta">
                      <time dateTime={report.created_at} title={fmtDate(report.created_at)}>{since(report.created_at)}</time>
                      <VerificationState report={report} />
                    </span>
                    <span className="ov-row-action">مراجعة<ArrowLeft size={14} /></span>
                  </button>
                </li>)}
              </ol> : <p className="ov-empty">{category ? `لا بلاغات في «${categoryName(category)}» تنتظر الاعتماد.` : 'لا بلاغات تنتظر الاعتماد. ستظهر هنا فور إرسالها.'}</p>}
              <footer className="ov-card-foot">
                <span>عرض {number(data.queue.items.length)} من {number(data.queue.total)}</span>
                <button type="button" className="ov-link" onClick={() => onNavigate('pending')}>كل البلاغات المنتظرة<ArrowLeft size={15} /></button>
              </footer>
            </section>

            <section className="ov-card ov-other" aria-labelledby="ov-other-title">
              <header className="ov-card-head"><div><h2 id="ov-other-title">قرارات أخرى تنتظرك</h2></div></header>
              <ul className="ov-decisions">
                <li><button type="button" onClick={() => onNavigate('fieldReview')}>
                  <span><strong>ملاحظات العمال الميدانيين</strong><small>بلاغات أوقفها العامل حتى تقرر متابعتها أو رفضها</small></span>
                  <b className={`num ${fieldReview ? 'is-due' : ''}`}>{number(fieldReview)}</b><ArrowLeft size={15} />
                </button></li>
                <li><button type="button" onClick={() => onNavigate('completion')}>
                  <span><strong>إصلاحات بانتظار تأكيد الحل</strong><small>قارن صورة البلاغ بصورة الإصلاح ثم أكّد أو أعد للعمل</small></span>
                  <b className={`num ${awaitingConfirmation ? 'is-due' : ''}`}>{number(awaitingConfirmation)}</b><ArrowLeft size={15} />
                </button></li>
              </ul>
            </section>
          </div>
          <OverviewMap onOpen={onOpen} onNavigate={onNavigate} refreshKey={refreshKey + tick} categoryCounts={categoryCounts} totalReports={data.stats.total} />
        </div>
      </>}
  </div>;
}

