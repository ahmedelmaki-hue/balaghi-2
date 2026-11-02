// The review queues and the full report list.
import React, { useEffect, useState } from 'react';
import {
  CheckCheck, ChevronLeft, ChevronRight, CircleAlert, Eye, MapPin, Menu, RefreshCw, Search,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { categories, fmtDate, number, reportSearchId, categoryName, errorText, CategoryIcon, StatusPill, AcceptanceState, VerificationState, ReportThumbnail, EmptyState, LoadingState, PageHeading, ReportTable } from '../shared.jsx';

export function PendingReviewPage({ fieldReviewQueue = false, completionQueue = false, onOpen, refreshKey, onMenu }) {
  const defaultSort = 'newest';
  const queueFilter = completionQueue ? { completion: 'pending' }
    : fieldReviewQueue ? { field_review: 'pending' } : { review: 'pending' };
  const heading = completionQueue ? 'بانتظار تأكيد الحل'
    : fieldReviewQueue ? 'بلاغات تحتاج مراجعة ميدانية' : 'قائمة البلاغات بانتظار المراجعة';
  const subtitle = fieldReviewQueue ? 'راجع ملاحظة العامل واتخذ قرارًا قبل عودة البلاغ إلى الخريطة.'
    : completionQueue ? 'راجع إنجاز جهة العمل ثم أكّد الحل أو أعد البلاغ للعمل مع سبب.'
      : 'افحص صورة كل بلاغ ووصفه وموقعه قبل اعتماده ونشره للمواطنين.';
  const [filters, setFilters] = useState({ category: '', date: '', sort: defaultSort, report_id: '', page: 1 });
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [counts, setCounts] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

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
        setResult(data); setError(''); setLoading(false);
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
  const start = result?.total ? (result.page - 1) * 10 + 1 : 0;
  const end = result?.total ? Math.min(result.page * 10, result.total) : 0;

  return <>
    <header className="pending-heading"><div className="pending-heading-copy"><button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button><div><span className="eyebrow">{completionQueue ? 'اعتماد الإصلاح' : fieldReviewQueue ? 'الملاحظات الميدانية' : 'مراجعة البلاغات'}</span><h1>{heading} <span>{counts ? `(${number(counts.all)} بلاغ)` : ''}</span></h1><p>{subtitle}</p></div></div><button className="button button-quiet" onClick={() => setTick((value) => value + 1)}><RefreshCw size={17} />تحديث القائمة</button></header>
    <section className="panel pending-filters" aria-label='تصفية البلاغات المنتظرة'><div className="pending-category-tabs">
      {[['', 'الكل', 'all'], ...Object.entries(categories).map(([key, item]) => [key, item.label, key])].map(([key, label, countKey]) => <button key={countKey} className={`pending-tab ${filters.category === key ? 'active' : ''}`} onClick={() => change('category', key)} aria-pressed={filters.category === key}><span>{label}</span>{counts && <small>{number(counts[countKey] || 0)}</small>}</button>)}
    </div><div className="pending-controls"><form className="pending-search" onSubmit={submitSearch}><Search size={17} /><input type="search" inputMode="numeric" value={search} onChange={(event) => { setSearch(event.target.value); setSearchError(''); if (!event.target.value && filters.report_id) change('report_id', ''); }} placeholder="ابحث برقم البلاغ" aria-label="ابحث برقم البلاغ" /><button type="submit">بحث</button></form><label>{completionQueue ? 'تاريخ إرسال الإنجاز' : fieldReviewQueue ? 'تاريخ الملاحظة' : 'تاريخ تقديم البلاغ'}<input type="date" value={filters.date} onChange={(event) => change('date', event.target.value)} /></label><label>الترتيب<select value={filters.sort} onChange={(event) => change('sort', event.target.value)}><option value="newest">الأحدث أولًا</option><option value="oldest">الأقدم أولًا</option></select></label><button className="pending-reset" onClick={reset}>إعادة ضبط</button></div>
      {searchError && <p className="pending-search-error" role="alert">{searchError}</p>}
    </section>
    <section className="panel pending-results"><div className="panel-heading"><div><span className="eyebrow">{completionQueue ? 'طلبات الإنجاز' : fieldReviewQueue ? 'قائمة المراجعة الميدانية' : 'قائمة الفحص'}</span><h2>{completionQueue ? 'بلاغات أنجزتها جهة العمل وتنتظر قرارك' : fieldReviewQueue ? 'بلاغات أوقفها العامل للمراجعة' : 'بلاغات تحتاج قرارًا فرديًا'}</h2></div><span className="count-chip">{number(result?.total || 0)} نتيجة</span></div>
      {loading ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل البلاغات" detail={error} onRetry={() => setTick((value) => value + 1)} /> : !result?.items.length ? <EmptyState title={completionQueue ? 'لا توجد بلاغات بانتظار تأكيد الحل' : fieldReviewQueue ? 'لا توجد ملاحظات ميدانية معلّقة' : 'لا توجد بلاغات مطابقة'} detail={filters.report_id ? 'رقم البلاغ غير موجود ضمن هذه القائمة.' : completionQueue ? 'ستظهر هنا البلاغات التي يؤكد العامل إنجازها.' : fieldReviewQueue ? 'ستظهر هنا البلاغات التي يبلّغ العامل عن وجود مشكلة فيها.' : 'جرّب تغيير عوامل التصفية أو انتظر وصول بلاغات جديدة.'} /> : <>
        <div className="table-scroll"><table className="pending-table"><thead><tr><th>رقم البلاغ</th><th>صورة المعاينة</th><th>التصنيف والوصف</th><th>الموقع</th><th>{completionQueue ? 'وقت إرسال الإنجاز' : fieldReviewQueue ? 'وقت الملاحظة' : 'وقت الإرسال'}</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{result.items.map((report) => <tr key={report.id}><td><strong className="pending-report-id">#{report.id}</strong></td><td><button className="pending-photo-button" onClick={() => onOpen(report.id)} aria-label={`عرض تفاصيل البلاغ ${report.id}`}><ReportThumbnail report={report} /></button></td><td><div className="pending-description"><span><CategoryIcon category={report.category} size={17} /><strong>{categoryName(report.category)}</strong></span><p>{report.description || 'لا يوجد وصف إضافي.'}</p></div></td><td><span className="pending-location"><MapPin size={15} />{report.address_text || 'الموقع محدد على الخريطة'}</span></td><td className="pending-date">{fmtDate(completionQueue ? report.completion_submitted_at : fieldReviewQueue ? report.field_issue_raised_at : report.created_at)}</td><td><span className="status-stack"><StatusPill report={report} /><VerificationState report={report} /><AcceptanceState report={report} /></span></td><td><button className="pending-review-button" onClick={() => onOpen(report.id)}>{completionQueue ? <CheckCheck size={16} /> : fieldReviewQueue ? <CircleAlert size={16} /> : <Eye size={16} />}{completionQueue ? 'مراجعة الإنجاز' : fieldReviewQueue ? 'مراجعة الملاحظة' : 'فحص واتخاذ قرار'}</button></td></tr>)}</tbody></table></div>
        <div className="pagination pending-pagination"><span>عرض {number(start)}–{number(end)} من {number(result.total)} بلاغ</span><div><button className="icon-button" aria-label="الصفحة السابقة" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}><ChevronRight size={18} /></button><span>صفحة {number(result.page)} من {number(Math.max(result.total_pages, 1))}</span><button className="icon-button" aria-label="الصفحة التالية" disabled={filters.page >= result.total_pages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}><ChevronLeft size={18} /></button></div></div>
      </>}
    </section>
  </>;
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

