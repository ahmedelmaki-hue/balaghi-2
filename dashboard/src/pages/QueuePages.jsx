// The review queues and the full report list.
import React, { useEffect, useState } from 'react';
import {
  CheckCheck, ChevronLeft, ChevronRight, CircleAlert, Clock3, Copy, Eye, MapPin, Menu, RefreshCw, Search,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { categories, fmtDate, number, reportSearchId, categoryName, errorText, CategoryIcon, VerificationState, ReportThumbnail, EmptyState, LoadingState, PageHeading, ReportTable } from '../shared.jsx';

const relativeTime = new Intl.RelativeTimeFormat('ar-LY', { numeric: 'auto' });
const clockTime = new Intl.DateTimeFormat('ar-LY', { timeStyle: 'short' });
const tripoliDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' });
const DAY_MS = 24 * 3600e3;

// "قبل 3 ساعات", "أمس": how long a report has waited.
function since(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return relativeTime.format(-minutes, 'minute');
  if (minutes < 60 * 24) return relativeTime.format(-Math.round(minutes / 60), 'hour');
  return relativeTime.format(-Math.round(minutes / 1440), 'day');
}

// Section headings: اليوم، أمس، أقدم — by the Tripoli calendar day.
function dayGroup(value) {
  const day = tripoliDay.format(new Date(value));
  if (day === tripoliDay.format(new Date())) return 'اليوم';
  if (day === tripoliDay.format(new Date(Date.now() - DAY_MS))) return 'أمس';
  return 'أقدم';
}

export function PendingReviewPage({ fieldReviewQueue = false, completionQueue = false, onOpen, refreshKey, onMenu }) {
  const defaultSort = 'newest';
  const queueFilter = completionQueue ? { completion: 'pending' }
    : fieldReviewQueue ? { field_review: 'pending' } : { review: 'pending' };
  const reviewQueue = !fieldReviewQueue && !completionQueue;
  const heading = completionQueue ? 'بانتظار تأكيد الحل' : fieldReviewQueue ? 'تحتاج مراجعة موظف' : 'بانتظار المراجعة';
  const subtitle = fieldReviewQueue ? 'راجع ملاحظة العامل واتخذ قرارًا قبل عودة البلاغ إلى الخريطة.'
    : completionQueue ? 'راجع إنجاز جهة العمل ثم أكّد الحل أو أعد البلاغ للعمل مع سبب.'
      : 'افحص صورة كل بلاغ ووصفه وموقعه قبل اعتماده ونشره للمواطنين.';
  const timeOf = (report) => (completionQueue ? report.completion_submitted_at
    : fieldReviewQueue ? report.field_issue_raised_at : report.created_at) || report.created_at;
  const [filters, setFilters] = useState({ category: '', date: '', sort: defaultSort, report_id: '', page: 1 });
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [counts, setCounts] = useState(null);
  const [result, setResult] = useState(null);
  const [nearby, setNearby] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all(['', ...Object.keys(categories)].map((category) => staffApi.reports({ ...queueFilter, category, limit: 1 })))
      .then((responses) => {
        if (!active) return;
        setCounts(Object.fromEntries(['all', ...Object.keys(categories)].map((key, index) => [key, responses[index].total])));
      })
      .catch(() => { if (active) setCounts(null); });
    return () => { active = false; };
  }, [fieldReviewQueue, completionQueue, refreshKey, tick]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    staffApi.reports({ ...queueFilter, ...filters, limit: 10 })
      .then((data) => {
        if (!active) return;
        if (filters.page > Math.max(data.total_pages, 1)) {
          setFilters((current) => ({ ...current, page: Math.max(data.total_pages, 1) }));
          return;
        }
        setResult(data); setError(''); setLoading(false); setLoadedAt(new Date());
        // Possible duplicates, only before approval: one light lookup per report on the page.
        if (reviewQueue) {
          Promise.all(data.items.map((report) => staffApi.nearby(report.id)
            .then((found) => [report.id, found.items[0] || null]).catch(() => [report.id, null])))
            .then((pairs) => { if (active) setNearby(Object.fromEntries(pairs)); });
        }
      })
      .catch((cause) => { if (active) { setError(errorText(cause)); setLoading(false); } });
    return () => { active = false; };
  }, [fieldReviewQueue, completionQueue, filters, refreshKey, tick]);

  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const reset = () => {
    setFilters({ category: '', date: '', sort: defaultSort, report_id: '', page: 1 });
    setSearch('');
    setSearchError('');
  };
  const submitSearch = (event) => {
    event.preventDefault();
    const id = reportSearchId(search);
    if (id === null) {
      setSearchError('أدخل رقم بلاغ صحيحًا.');
      return;
    }
    setSearchError('');
    change('report_id', id);
  };
  const filtered = Boolean(filters.category || filters.date || filters.report_id || filters.sort !== defaultSort);
  const start = result?.total ? (result.page - 1) * 10 + 1 : 0;
  const end = result?.total ? Math.min(result.page * 10, result.total) : 0;
  const groups = [];
  (result?.items || []).forEach((report) => {
    const label = dayGroup(timeOf(report));
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(report); else groups.push({ label, items: [report] });
  });
  const action = completionQueue ? 'مراجعة الإنجاز' : fieldReviewQueue ? 'مراجعة الملاحظة' : 'فحص واتخاذ قرار';
  const ActionIcon = completionQueue ? CheckCheck : fieldReviewQueue ? CircleAlert : Eye;

  return <div className="pr">
    <header className="pr-head">
      <div className="pr-title">
        <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
        <div><span className="eyebrow">{completionQueue ? 'اعتماد الإصلاح' : fieldReviewQueue ? 'الملاحظات الميدانية' : 'مراجعة البلاغات'}</span>
          <h1>{heading}{counts && <span className="pr-count num">{number(counts.all)}</span>}</h1>
          <p>{subtitle}</p></div>
      </div>
      <button type="button" className="pr-refresh" onClick={() => setTick((value) => value + 1)}>
        <RefreshCw size={16} />{loadedAt ? <>تحديث · <span className="num">{clockTime.format(loadedAt)}</span></> : 'تحديث'}
      </button>
    </header>

    <section className="pr-toolbar" aria-label="تصفية البلاغات المنتظرة">
      <div className="pr-tabs" role="group" aria-label="التصنيف">
        {[['', 'الكل', 'all'], ...Object.entries(categories).map(([key, item]) => [key, item.label, key])].map(([key, label, countKey]) => <button type="button" key={countKey} className={filters.category === key ? 'is-active' : ''} onClick={() => change('category', key)} aria-pressed={filters.category === key}>{label}{counts && <small className="num">{number(counts[countKey] || 0)}</small>}</button>)}
      </div>
      <div className="pr-controls">
        <form className="pr-search" onSubmit={submitSearch} role="search"><Search size={16} /><input type="search" inputMode="numeric" value={search} onChange={(event) => { setSearch(event.target.value); setSearchError(''); if (!event.target.value && filters.report_id) change('report_id', ''); }} placeholder="رقم البلاغ" aria-label="ابحث برقم البلاغ" /><button type="submit">بحث</button></form>
        <label className="pr-field"><span>{completionQueue ? 'تاريخ الإنجاز' : fieldReviewQueue ? 'تاريخ الملاحظة' : 'تاريخ الإرسال'}</span><input type="date" value={filters.date} onChange={(event) => change('date', event.target.value)} /></label>
        <label className="pr-field"><span>الترتيب</span><select value={filters.sort} onChange={(event) => change('sort', event.target.value)}><option value="newest">الأحدث أولًا</option><option value="oldest">الأقدم أولًا</option></select></label>
        {filtered && <button type="button" className="pr-reset" onClick={reset}>مسح</button>}
      </div>
      {searchError && <p className="pr-search-error" role="alert">{searchError}</p>}
    </section>

    {loading ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل البلاغات" detail={error} onRetry={() => setTick((value) => value + 1)} /> : !result?.items.length ? <EmptyState title={completionQueue ? 'لا توجد بلاغات بانتظار تأكيد الحل' : fieldReviewQueue ? 'لا توجد ملاحظات ميدانية معلّقة' : 'لا توجد بلاغات مطابقة'} detail={filters.report_id ? 'رقم البلاغ غير موجود ضمن هذه القائمة.' : 'ستظهر هنا البلاغات فور وصولها.'} /> : <>
      {groups.map((group) => <section className="pr-group" key={group.label} aria-label={group.label}>
        <h2>{group.label}<small className="num">{number(group.items.length)}</small></h2>
        <ol className="pr-list">{group.items.map((report) => {
          const waitedLong = Date.now() - new Date(timeOf(report)).getTime() > DAY_MS;
          const twin = nearby[report.id];
          return <li key={report.id} className={`pr-item is-${report.category}`}>
            <button type="button" className="pr-photo" onClick={() => onOpen(report.id)} aria-label={`عرض تفاصيل البلاغ ${report.id}`}><ReportThumbnail report={report} /></button>
            <div className="pr-main">
              <div className="pr-meta">
                <span className="pr-tag"><CategoryIcon category={report.category} size={14} />{categoryName(report.category)}</span>
                <span className="pr-id num">#{report.id}</span>
                <time className={waitedLong ? 'is-late' : ''} dateTime={timeOf(report)} title={fmtDate(timeOf(report))}><Clock3 size={13} />{since(timeOf(report))}</time>
              </div>
              <p className={`pr-desc ${report.description ? '' : 'is-empty'}`}>{report.description || 'لم يُضف المواطن وصفًا.'}</p>
              <p className="pr-place"><MapPin size={14} />{report.address_text || 'الموقع محدد على الخريطة'}</p>
              {(twin || report.verification_requested_at) && <div className="pr-flags">
                <VerificationState report={report} />
                {twin && <span className="pr-twin"><Copy size={13} /><span>قد يكون مكررًا: بلاغ <bdi className="num">#{twin.id}</bdi> على بعد <bdi className="num">{number(twin.distance_m)}</bdi> م</span></span>}
              </div>}
            </div>
            <div className="pr-side">
              <button type="button" className="pr-action" onClick={() => onOpen(report.id)}><ActionIcon size={17} />{action}</button>
            </div>
          </li>;
        })}</ol>
      </section>)}
      <footer className="pr-pages"><span>عرض <span className="num">{number(start)}–{number(end)}</span> من <span className="num">{number(result.total)}</span></span><div><button className="icon-button" aria-label="الصفحة السابقة" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}><ChevronRight size={18} /></button><span>صفحة <span className="num">{number(result.page)}</span> من <span className="num">{number(Math.max(result.total_pages, 1))}</span></span><button className="icon-button" aria-label="الصفحة التالية" disabled={filters.page >= result.total_pages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}><ChevronLeft size={18} /></button></div></footer>
    </>}
  </div>;
}

export function ReportsPage({ pendingOnly, onOpen, refreshKey, onMenu }) {
  const [filters, setFilters] = useState({ review: pendingOnly ? 'pending' : '', status: '', acceptance: '', category: '', date: '', report_id: '', page: 1 });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  useEffect(() => { setFilters({ review: pendingOnly ? 'pending' : '', status: '', acceptance: '', category: '', date: '', report_id: '', page: 1 }); setSearch(''); setSearchError(''); }, [pendingOnly]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    staffApi.reports(filters).then((data) => { if (active) { setResult(data); setError(''); setLoading(false); } })
      .catch((cause) => { if (active) { setError(errorText(cause)); setLoading(false); } });
    return () => { active = false; };
  }, [filters, refreshKey, tick]);
  const change = (key, value) => setFilters((prev) => ({ ...prev, [key]: value, ...(key === 'review' ? { status: '' } : {}), page: 1 }));
  const submitSearch = (event) => {
    event.preventDefault();
    const id = reportSearchId(search);
    if (id === null) { setSearchError('أدخل رقم بلاغ صحيحًا.'); return; }
    setSearchError('');
    change('report_id', id);
  };
  const reset = () => { setFilters({ review: pendingOnly ? 'pending' : '', status: '', acceptance: '', category: '', date: '', report_id: '', page: 1 }); setSearch(''); setSearchError(''); };
  return <>
    <PageHeading eyebrow="إدارة البلاغات" title={pendingOnly ? 'بانتظار المراجعة' : 'جميع البلاغات'}
      subtitle={pendingOnly ? 'راجع صحة البلاغ وصورته وموقعه قبل ظهوره للمواطنين.' : 'تتبّع البلاغات المعتمدة والمنتظرة والمرفوضة من مكان واحد.'}
      action="تحديث القائمة" onAction={() => setTick((n) => n + 1)} onMenu={onMenu} />
    <section className="panel reports-panel"><div className="panel-heading"><div><span className="eyebrow">قائمة البلاغات</span><h2>{pendingOnly ? 'بلاغات تحتاج قرارًا' : 'سجل البلاغات'}</h2></div><span className="count-chip">{number(result?.total || 0)} بلاغ</span></div>
      <div className="reports-search-row"><form className="pending-search reports-search" onSubmit={submitSearch}><Search size={17} /><input type="search" inputMode="numeric" value={search} onChange={(event) => { setSearch(event.target.value); setSearchError(''); if (!event.target.value && filters.report_id) change('report_id', ''); }} placeholder="ابحث برقم البلاغ" aria-label="ابحث برقم البلاغ" /><button type="submit">بحث</button></form>{searchError && <span className="pending-search-error" role="alert">{searchError}</span>}</div>
      <div className="filters" aria-label="فلاتر البلاغات">
        {!pendingOnly && <label>المراجعة<select value={filters.review} onChange={(e) => change('review', e.target.value)}><option value="">كل البلاغات</option><option value="pending">بانتظار المراجعة</option><option value="approved">معتمد</option><option value="rejected">مرفوض</option></select></label>}
        {!pendingOnly && <label>الحالة<select value={filters.status} onChange={(e) => change('status', e.target.value)}><option value="">كل الحالات</option><option value="new">جديد</option><option value="in_progress">قيد المعالجة</option><option value="resolved">تم الحل</option><option value="rejected">مرفوض</option></select></label>}
        {!pendingOnly && <label>الاستلام<select value={filters.acceptance} onChange={(e) => change('acceptance', e.target.value)}><option value="">الكل</option><option value="pending">لم يُستلم بعد</option></select></label>}
        <label>التصنيف<select value={filters.category} onChange={(e) => change('category', e.target.value)}><option value="">كل التصنيفات</option><option value="pothole">الحفر</option><option value="water_leak">تسرب مياه</option><option value="garbage">قمامة</option></select></label>
        <label>تاريخ الإرسال<input type="date" value={filters.date} onChange={(e) => change('date', e.target.value)} /></label>
        {(filters.category || filters.date || filters.status || filters.acceptance || filters.report_id || (!pendingOnly && filters.review)) && <button className="clear-filters" onClick={reset}>مسح الفلاتر</button>}
      </div>
      {loading ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل البلاغات" detail={error} onRetry={() => setTick((n) => n + 1)} />
        : !result?.items.length ? <EmptyState title="لا توجد بلاغات مطابقة" detail={filters.report_id ? 'لا يوجد بلاغ بهذا الرقم ضمن الفلاتر المحددة.' : 'جرّب تغيير الفلاتر أو انتظر وصول بلاغات جديدة.'} />
          : <><ReportTable items={result.items} onOpen={onOpen} /><div className="pagination"><span>صفحة {number(result.page)} من {number(Math.max(result.total_pages, 1))}</span><div><button className="icon-button" aria-label="الصفحة السابقة" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}><ChevronRight size={18} /></button><button className="icon-button" aria-label="الصفحة التالية" disabled={filters.page >= result.total_pages} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}><ChevronLeft size={18} /></button></div></div></>}
    </section>
  </>;
}

