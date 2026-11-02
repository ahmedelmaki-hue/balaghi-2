// The overview: what waits for the staff member's decision.
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowLeft, ChartPie, CircleAlert, CircleCheck, ClipboardList, Clock, Hourglass, Images, Inbox,
  Layers, MapPin, MapPinned, Menu, RefreshCw, Search, Wrench,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { categories, categoryAgency, fmtDate, number, reportSearchId, categoryName, errorText, VerificationState, ReportThumbnail, EmptyState, LoadingState } from '../shared.jsx';

const relativeTime = new Intl.RelativeTimeFormat('ar-LY', { numeric: 'auto' });
const clockTime = new Intl.DateTimeFormat('ar-LY', { timeStyle: 'short' });
// The API reads ?date= as a day in Tripoli, so "today" must be Tripoli's day too.
const tripoliDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' });
const statusColors = { new: '#c93636', in_progress: '#2d8bc4', resolved: '#4b9a67' };

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

const percent = (part, whole) => (whole ? Math.round(part / whole * 100) : 0);

function location(report) {
  if (report.address_text) return report.address_text;
  const lat = Number(report.latitude);
  const lng = Number(report.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'الموقع غير متاح';
}

function StatCard({ tone, icon: Icon, label, value, badge, note, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag type={onClick ? 'button' : undefined} className={`ov-stat is-${tone}`} onClick={onClick}>
    <span className="ov-stat-head"><span className="ov-stat-label">{label}</span><span className="ov-chip"><Icon size={18} /></span></span>
    <span className="ov-stat-value"><strong className="num">{number(value)}</strong>{badge && <em>{badge}</em>}</span>
    <small>{note}</small>
  </Tag>;
}

function OverviewMap({ onOpen, onNavigate, refreshKey }) {
  const container = useRef(null);
  const map = useRef(null);
  const markers = useRef(null);
  const [bounds, setBounds] = useState('');
  const [category, setCategory] = useState('');
  const [count, setCount] = useState(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!container.current) return undefined;
    const instance = L.map(container.current, { scrollWheelZoom: false }).setView([32.8872, 13.1913], 13);
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
    staffApi.publicMarkers(bounds, { category }).then((result) => {
      if (!active || !markers.current) return;
      markers.current.clearLayers();
      result.items.forEach((report) => {
        const lat = Number(report.latitude);
        const lng = Number(report.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const color = statusColors[report.status] || statusColors.new;
        L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
          .on('click', () => onOpen(report.id)).addTo(markers.current);
      });
      setCount(result.items.length);
      setMore(Boolean(result.next_cursor));
      setError(false);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [bounds, category, refreshKey, onOpen]);

  const filters = [['', 'الكل'], ...Object.entries(categories).map(([key, item]) => [key, item.label])];
  return <section className="ov-card ov-map-card" aria-labelledby="ov-map-title">
    <header className="ov-card-head">
      <span className="ov-chip is-navy"><MapPinned size={18} /></span>
      <div className="ov-card-title"><h2 id="ov-map-title">البلاغات المعتمدة على الخريطة</h2>
        <p>{error ? 'تعذّر تحميل البلاغات على الخريطة.' : count === null ? 'جارٍ تحميل البلاغات…' : `${more ? 'أكثر من ' : ''}${number(count)} بلاغ في النطاق المعروض`}</p></div>
      <div className="ov-segment" role="group" aria-label="تصفية الخريطة حسب التصنيف">
        {filters.map(([key, label]) => <button type="button" key={key || 'all'} className={category === key ? 'is-active' : ''} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}
      </div>
    </header>
    <div className="ov-map-wrap">
      <div className="ov-map" ref={container} aria-label="خريطة مصغّرة للبلاغات المعتمدة" />
      <p className="ov-legend" aria-label="ألوان الحالات على الخريطة">
        <b>الدليل:</b>
        <span><i className="ov-dot is-new" />جديد</span><span><i className="ov-dot is-progress" />قيد المعالجة</span><span><i className="ov-dot is-resolved" />تم الحل</span>
      </p>
    </div>
    <footer className="ov-card-foot">
      <span>تُحدَّث العلامات عند تحريك الخريطة</span>
      <button type="button" className="ov-link" onClick={() => onNavigate('map')}>فتح الخريطة الكاملة<ArrowLeft size={15} /></button>
    </footer>
  </section>;
}

// Category colours: brand gold, the water blue and brand navy. They stay apart for
// colour-blind readers too; every slice is also named with its count beside the ring.
const categoryColors = { pothole: '#b97d10', water_leak: '#2d8bc4', garbage: '#12323f' };
const RING = { size: 148, radius: 58, width: 18, gap: 2 };
// Short agency names for the legend; the full names live in shared.jsx.
const agencyShort = { roads_maintenance: 'مكتب الطرق والصيانة', water_sewer: 'شركة المياه والصرف الصحي', public_services: 'شركة الخدمات العامة' };

function CategoryDonut({ counts, total }) {
  const [active, setActive] = useState('');
  const circumference = 2 * Math.PI * RING.radius;
  const rows = Object.entries(categories).map(([key, item]) => ({ key, ...item, value: Number(counts[key]) || 0 }));
  const shown = rows.filter((row) => row.value > 0);
  let offset = 0;
  const slices = shown.map((row) => {
    const length = row.value / total * circumference;
    const slice = { ...row, dash: Math.max(0, length - (shown.length > 1 ? RING.gap : 0)), offset };
    offset += length;
    return slice;
  });
  const focus = rows.find((row) => row.key === active);
  const center = RING.size / 2;
  const summary = rows.map((row) => `${row.label} ${number(row.value)}`).join('، ');
  return <div className="ov-donut">
    <div className="ov-donut-ring">
      <svg viewBox={`0 0 ${RING.size} ${RING.size}`} role="img" aria-label={`توزيع ${number(total)} بلاغ: ${summary}`}>
        <circle cx={center} cy={center} r={RING.radius} fill="none" stroke="#f2eee6" strokeWidth={RING.width} />
        <g transform={`rotate(-90 ${center} ${center})`}>
          {slices.map((slice) => <circle key={slice.key} cx={center} cy={center} r={RING.radius} fill="none"
            stroke={categoryColors[slice.key]} strokeWidth={active === slice.key ? RING.width + 4 : RING.width}
            strokeDasharray={`${slice.dash} ${circumference - slice.dash}`} strokeDashoffset={-slice.offset}
            className={active && active !== slice.key ? 'is-dim' : ''}
            onMouseEnter={() => setActive(slice.key)} onMouseLeave={() => setActive('')} />)}
        </g>
      </svg>
      <span className="ov-donut-center" aria-hidden="true">
        {focus ? <><strong className="num">{number(percent(focus.value, total))}%</strong><small>{focus.label}</small></>
          : <><strong className="num">{number(total)}</strong><small>بلاغ مسجّل</small></>}
      </span>
    </div>
    <ul className="ov-donut-legend">
      {rows.map(({ key, label, icon: Icon, value }) => <li key={key} className={active === key ? 'is-active' : ''}
        onMouseEnter={() => setActive(key)} onMouseLeave={() => setActive('')}>
        <span className="ov-donut-icon" style={{ '--slice': categoryColors[key] }}><Icon size={17} /></span>
        <span className="ov-donut-name"><strong>{label}</strong><small title="الجهة التي يُحال إليها">{agencyShort[categoryAgency[key]]}</small></span>
        <span className="ov-donut-value"><b className="num">{number(value)}</b><em className="num">{number(percent(value, total))}%</em></span>
      </li>)}
    </ul>
  </div>;
}

function ActionCard({ tone, icon: Icon, title, count, countLabel, detail, action, onClick }) {
  return <section className="ov-card ov-action">
    <header className="ov-action-head">
      <span className={`ov-chip is-${tone}`}><Icon size={18} /></span>
      <span className={`ov-pill ${count ? `is-${tone}` : ''}`}>{number(count)} {countLabel}</span>
    </header>
    <h2>{title}</h2>
    <p>{detail}</p>
    <footer className="ov-card-foot"><span />
      <button type="button" className="ov-link" onClick={onClick}>{action}<ArrowLeft size={15} /></button>
    </footer>
  </section>;
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
      staffApi.reports({ date: tripoliDay.format(new Date()), limit: 1 }),
    ])
      .then(([stats, oldest, queue, unclaimed, today]) => {
        if (!active) return;
        setData({ stats, oldest, queue, unclaimed, today }); setError(''); setLoadedAt(new Date());
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
  const total = data?.stats.total || 0;
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
        <div><h1>نظرة عامة</h1>
          <p className="ov-finding">{finding}</p>
          <button type="button" className="ov-refresh" onClick={() => setTick((n) => n + 1)} aria-label="تحديث البيانات">
            {loadedAt && <span>آخر تحديث <b className="num">{clockTime.format(loadedAt)}</b></span>}<RefreshCw size={14} />تحديث
          </button></div>
      </div>
      <div className="ov-tools">
        <form className="ov-search" onSubmit={submitSearch} role="search">
          <Search size={16} />
          <input type="search" inputMode="numeric" value={search} onChange={(event) => { setSearch(event.target.value); setSearchError(''); }} placeholder="ابحث برقم البلاغ" aria-label="بحث برقم البلاغ" aria-invalid={Boolean(searchError)} />
          <button type="submit">فتح</button>
        </form>
        {oldest && <button type="button" className="ov-primary" onClick={() => onOpen(oldest.id)}>مراجعة الأقدم<ArrowLeft size={16} /></button>}
      </div>
    </header>
    {searchError && <p className="ov-search-error" role="alert">{searchError}</p>}

    {error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل النظرة العامة" detail={error} onRetry={() => setTick((n) => n + 1)} />
      : !data ? <LoadingState /> : <>
        <section className="ov-stats" aria-label="مسار البلاغ من الإرسال إلى الحل">
          <StatCard tone="pending" icon={Hourglass} label="بانتظار المراجعة والاعتماد" value={pending}
            note={pending ? `أقدم بلاغ ينتظر ${since(oldest.created_at)}` : 'لا شيء ينتظر الآن'} onClick={() => onNavigate('pending')} />
          <StatCard tone="new" icon={Inbox} label="جديد بانتظار الاستلام" value={publishedNew}
            badge={data.unclaimed.total ? `${number(data.unclaimed.total)} لم يُستلم` : null}
            note="معتمد ومُحال إلى الجهة المختصة" onClick={() => onNavigate('reports')} />
          <StatCard tone="progress" icon={Wrench} label="قيد المعالجة الميدانية" value={inProgress}
            badge={awaitingConfirmation ? `${number(awaitingConfirmation)} بانتظار التأكيد` : null}
            note="بدأ العامل الميداني العمل عليها" onClick={() => onNavigate(awaitingConfirmation ? 'completion' : 'reports')} />
          <StatCard tone="resolved" icon={CircleCheck} label="تم حلها" value={resolved}
            badge={approvedTotal ? `${number(percent(resolved, approvedTotal))}%` : null}
            note="نسبة الحل من البلاغات المعتمدة" onClick={() => onNavigate('reports')} />
          <StatCard tone="total" icon={Layers} label="إجمالي البلاغات المسجلة" value={total}
            badge={data.today.total ? `+${number(data.today.total)} اليوم` : null}
            note={`منها ${number(counts.rejected || 0)} مرفوض`} onClick={() => onNavigate('reports')} />
        </section>

        <div className="ov-grid">
          <OverviewMap onOpen={onOpen} onNavigate={onNavigate} refreshKey={refreshKey + tick} />

          <section className="ov-card ov-queue" aria-labelledby="ov-queue-title">
            <header className="ov-card-head">
              <div className="ov-card-title"><h2 id="ov-queue-title">بانتظار الاعتماد
                <span className={`ov-pill ${data.queue.total ? 'is-pending' : ''}`}>{number(data.queue.total)} {category ? `في «${categoryName(category)}»` : 'بلاغ'}</span></h2>
                <p>الأقدم أولًا</p></div>
              <button type="button" className="ov-link" onClick={() => onNavigate('pending')}>عرض الكل<ArrowLeft size={15} /></button>
              <div className="ov-segment" role="group" aria-label="تصفية التصنيف">
                {filters.map(([key, label]) => <button type="button" key={key || 'all'} className={category === key ? 'is-active' : ''} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}
              </div>
            </header>
            {data.queue.items.length ? <ol className="ov-items">
              {data.queue.items.map((report) => <li key={report.id} className={`ov-item is-${report.category}`}>
                <div className="ov-item-top">
                  <span className="ov-tag">{categoryName(report.category)}</span>
                  <span className="ov-item-id num">#{report.id}</span>
                  <time dateTime={report.created_at} title={fmtDate(report.created_at)}><Clock size={13} />{since(report.created_at)}</time>
                </div>
                <div className="ov-item-body">
                  <ReportThumbnail report={report} />
                  <div><strong>{report.description || 'لم يُضف وصف.'}</strong>
                    <small><MapPin size={13} /><span className="num" dir={report.address_text ? 'auto' : 'ltr'}>{location(report)}</span></small>
                    <VerificationState report={report} /></div>
                </div>
                <button type="button" className="ov-item-action" onClick={() => onOpen(report.id)} aria-label={`مراجعة البلاغ ${report.id}`}>مراجعة واعتماد<ArrowLeft size={14} /></button>
              </li>)}
            </ol> : <p className="ov-empty">{category ? `لا بلاغات في «${categoryName(category)}» تنتظر الاعتماد.` : 'لا بلاغات تنتظر الاعتماد. ستظهر هنا فور إرسالها.'}</p>}
            <footer className="ov-card-foot">
              <span>عرض {number(data.queue.items.length)} من {number(data.queue.total)}</span>
            </footer>
          </section>
        </div>

        <div className="ov-bottom">
          <ActionCard tone="pending" icon={ClipboardList} title="ملاحظات العمال الميدانيين" count={fieldReview} countLabel="بانتظار قرارك"
            detail="بلاغات أوقفها العامل الميداني بسبب عائق في الموقع، تنتظر أن تقرر متابعتها أو رفضها."
            action="متابعة الملاحظات" onClick={() => onNavigate('fieldReview')} />
          <ActionCard tone="progress" icon={Images} title="إصلاحات بانتظار تأكيد الحل" count={awaitingConfirmation} countLabel="بانتظار التأكيد"
            detail="قارن صورة البلاغ بصورة الإصلاح التي أرسلها العامل، ثم أكّد الحل أو أعد البلاغ للعمل."
            action="فحص وتأكيد" onClick={() => onNavigate('completion')} />
          <section className="ov-card ov-action ov-distribution" aria-labelledby="ov-dist-title">
            <header className="ov-action-head">
              <span className="ov-chip is-navy"><ChartPie size={18} /></span>
              <span className="ov-pill">من {number(total)} بلاغ</span>
            </header>
            <h2 id="ov-dist-title">توزيع البلاغات حسب التصنيف</h2>
            <CategoryDonut counts={categoryCounts} total={total} />
            <footer className="ov-card-foot"><span />
              <button type="button" className="ov-link" onClick={() => onNavigate('stats')}>الإحصاءات التفصيلية<ArrowLeft size={15} /></button>
            </footer>
          </section>
        </div>
      </>}
  </div>;
}
