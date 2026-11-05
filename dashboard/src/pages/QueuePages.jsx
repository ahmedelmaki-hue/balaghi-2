// The review queues and the full report list.
import React, { useEffect, useState } from 'react';
import {
  ArrowUpLeft, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, Copy, Eye, MapPin, Menu, RefreshCw, Search, UserX,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { categories, agencyNames, fmtDate, number, reportSearchId, categoryName, errorText, CategoryIcon, StatusPill, AcceptanceState, VerificationState, ReportThumbnail, EmptyState, LoadingState } from '../shared.jsx';

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

// Stages of the full register, as the staff see them. Each maps to the list's filters.
const STAGES = [
  { key: '', label: 'الكل', filter: {} },
  { key: 'pending', label: 'بانتظار المراجعة', filter: { review: 'pending' }, tone: 'pending' },
  { key: 'new', label: 'جديد', filter: { review: 'approved', status: 'new' }, tone: 'new' },
  { key: 'in_progress', label: 'قيد المعالجة', filter: { status: 'in_progress' }, tone: 'progress' },
  { key: 'resolved', label: 'تم الحل', filter: { status: 'resolved' }, tone: 'resolved' },
  { key: 'rejected', label: 'مرفوض', filter: { review: 'rejected' }, tone: 'rejected' },
];
const EMPTY_FILTERS = { stage: '', acceptance: '', category: '', date: '', report_id: '', page: 1 };

export function ReportsPage({ onOpen, refreshKey, onMenu }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [result, setResult] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let active = true;
    staffApi.overview().then((data) => { if (active) setStats(data); }).catch(() => { if (active) setStats(null); });
    return () => { active = false; };
  }, [refreshKey, tick]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const stage = STAGES.find((item) => item.key === filters.stage) || STAGES[0];
    const { stage: _stage, ...rest } = filters;
    staffApi.reports({ ...rest, ...stage.filter })
      .then((data) => { if (active) { setResult(data); setError(''); setLoading(false); setLoadedAt(new Date()); } })
      .catch((cause) => { if (active) { setError(errorText(cause)); setLoading(false); } });
    return () => { active = false; };
  }, [filters, refreshKey, tick]);

  const counts = Object.fromEntries((stats?.byStatus || []).map((item) => [item.status, item.count]));
  const stageCount = {
    '': stats?.total, pending: stats?.pending_review,
    new: stats ? Math.max(0, (counts.new || 0) - (stats.pending_review || 0)) : undefined,
    in_progress: counts.in_progress, resolved: counts.resolved, rejected: counts.rejected,
  };
  const change = (key, value) => { setExpanded(null); setFilters((current) => ({ ...current, [key]: value, page: 1 })); };
  const reset = () => { setExpanded(null); setFilters(EMPTY_FILTERS); setSearch(''); setSearchError(''); };
  const submitSearch = (event) => {
    event.preventDefault();
    const id = reportSearchId(search);
    if (id === null) { setSearchError('أدخل رقم بلاغ صحيحًا.'); return; }
    setSearchError('');
    change('report_id', id);
  };
  const activeFilters = ['acceptance', 'category', 'date', 'report_id'].filter((key) => filters[key]).length;
  const start = result?.total ? (result.page - 1) * 25 + 1 : 0;
  const end = result?.total ? Math.min(result.page * 25, result.total) : 0;

  return <div className="rl">
    <header className="pr-head">
      <div className="pr-title">
        <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
        <div><span className="eyebrow">سجل البلاغات</span>
          <h1>جميع البلاغات{stats && <span className="pr-count num">{number(stats.total)}</span>}</h1>
          <p>كل بلاغ أرسله المواطنون، بحالته الحالية ومن استلمه.</p></div>
      </div>
      <button type="button" className="pr-refresh" onClick={() => setTick((value) => value + 1)}>
        <RefreshCw size={16} />{loadedAt ? <>تحديث · <span className="num">{clockTime.format(loadedAt)}</span></> : 'تحديث'}
      </button>
    </header>

    <section className="rl-filters" aria-label="تصفية البلاغات">
      <div className="rl-stages" role="group" aria-label="المرحلة">
        {STAGES.map((stage) => <button type="button" key={stage.key || 'all'} className={`${filters.stage === stage.key ? 'is-active' : ''} ${stage.tone ? `is-${stage.tone}` : ''}`} aria-pressed={filters.stage === stage.key} onClick={() => change('stage', stage.key)}>
          {stage.tone && <i className="rl-dot" aria-hidden="true" />}{stage.label}{stageCount[stage.key] !== undefined && <small className="num">{number(stageCount[stage.key] || 0)}</small>}
        </button>)}
      </div>
      <div className="rl-controls">
        <form className="pr-search" onSubmit={submitSearch} role="search"><Search size={16} /><input type="search" inputMode="numeric" value={search} onChange={(event) => { setSearch(event.target.value); setSearchError(''); if (!event.target.value && filters.report_id) change('report_id', ''); }} placeholder="رقم البلاغ" aria-label="ابحث برقم البلاغ" /><button type="submit">بحث</button></form>
        <label className="pr-field"><span>التصنيف</span><select value={filters.category} onChange={(event) => change('category', event.target.value)}><option value="">الكل</option>{Object.entries(categories).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
        <label className="pr-field"><span>تاريخ الإرسال</span><input type="date" value={filters.date} onChange={(event) => change('date', event.target.value)} /></label>
        <button type="button" className={`rl-toggle ${filters.acceptance ? 'is-on' : ''}`} aria-pressed={Boolean(filters.acceptance)} onClick={() => change('acceptance', filters.acceptance ? '' : 'pending')}><UserX size={16} />لم يُستلم بعد</button>
        {(activeFilters > 0 || filters.stage) && <span className="rl-active"><span className="num">{number(activeFilters + (filters.stage ? 1 : 0))}</span> فلتر مفعّل<button type="button" onClick={reset}>مسح الكل</button></span>}
      </div>
      {searchError && <p className="pr-search-error" role="alert">{searchError}</p>}
    </section>

    <section className="rl-card">
      {loading ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل البلاغات" detail={error} onRetry={() => setTick((n) => n + 1)} />
        : !result?.items.length ? <div className="rl-empty"><EmptyState title="لا توجد بلاغات مطابقة" detail={filters.report_id ? 'لا يوجد بلاغ بهذا الرقم ضمن الفلاتر المحددة.' : 'غيّر الفلاتر لرؤية بلاغات أخرى.'} />{(activeFilters > 0 || filters.stage) && <button type="button" className="pr-refresh" onClick={reset}>مسح الفلاتر</button>}</div>
          : <><div className="rl-scroll"><table className="rl-table">
            <thead><tr><th scope="col">البلاغ</th><th scope="col">التصنيف</th><th scope="col">الموقع</th><th scope="col">الحالة</th><th scope="col">تاريخ الإرسال</th><th scope="col"><span className="sr-only">إجراءات</span></th></tr></thead>
            <tbody>{result.items.map((report) => {
              const open = expanded === report.id;
              return <React.Fragment key={report.id}>
                <tr className={open ? 'is-open' : ''}>
                  <td data-label="البلاغ"><div className="rl-identity"><ReportThumbnail report={report} /><span><strong className="num">#{report.id}</strong><small>{report.reporter_name || 'مواطن'}</small></span></div></td>
                  <td data-label="التصنيف"><span className={`pr-tag rl-cat is-${report.category}`}><CategoryIcon category={report.category} size={14} />{categoryName(report.category)}</span></td>
                  <td data-label="الموقع" className="rl-place"><MapPin size={14} />{report.address_text || 'محدد على الخريطة'}</td>
                  <td data-label="الحالة"><span className="status-stack"><StatusPill report={report} /><AcceptanceState report={report} /></span></td>
                  <td data-label="تاريخ الإرسال" className="rl-date"><span>{fmtDate(report.created_at)}</span></td>
                  <td className="rl-actions">
                    <button type="button" className="rl-expand" aria-expanded={open} aria-label={open ? `إخفاء ملخص البلاغ ${report.id}` : `عرض ملخص البلاغ ${report.id}`} onClick={() => setExpanded(open ? null : report.id)}><ChevronDown size={18} /></button>
                    <button type="button" className="rl-open" onClick={() => onOpen(report.id)}>فتح<ArrowUpLeft size={15} /></button>
                  </td>
                </tr>
                {open && <tr className="rl-detail"><td colSpan={6}><div>
                  <p className={report.description ? '' : 'is-empty'}>{report.description || 'لم يُضف المواطن وصفًا.'}</p>
                  <dl>
                    <div><dt>الجهة</dt><dd>{report.assigned_agency ? agencyNames[report.assigned_agency] : 'لم يُعتمد بعد'}</dd></div>
                    <div><dt>العامل</dt><dd>{report.assigned_worker_name || '—'}</dd></div>
                    <div><dt>بدأ العمل</dt><dd>{report.work_started_at ? fmtDate(report.work_started_at) : '—'}</dd></div>
                  </dl>
                  <VerificationState report={report} />
                </div></td></tr>}
              </React.Fragment>;
            })}</tbody>
          </table></div>
          <footer className="pr-pages"><span>عرض <span className="num">{number(start)}–{number(end)}</span> من <span className="num">{number(result.total)}</span></span><div><button className="icon-button" aria-label="الصفحة السابقة" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}><ChevronRight size={18} /></button><span>صفحة <span className="num">{number(result.page)}</span> من <span className="num">{number(Math.max(result.total_pages, 1))}</span></span><button className="icon-button" aria-label="الصفحة التالية" disabled={filters.page >= result.total_pages} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}><ChevronLeft size={18} /></button></div></footer></>}
    </section>
  </div>;
}
