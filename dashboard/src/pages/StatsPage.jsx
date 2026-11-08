// Report statistics from real data only: arrivals and how they compare, how long
// each step takes, how far reports get, and where each category stands. The
// totals come from /stats/overview and the rest from /stats/insights.
import React, { useEffect, useRef, useState } from 'react';
import {
  Building2, CalendarDays, CircleAlert, Clock3, Gauge, Inbox, Menu, Printer, RefreshCw, Table2, TrendingDown, TrendingUp,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { categories, agencyNames, categoryAgency, number, errorText, CategoryIcon, EmptyState, LoadingState } from '../shared.jsx';

const clockTime = new Intl.DateTimeFormat('ar-LY', { timeStyle: 'short' });
const dayLabel = new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', timeZone: 'Africa/Tripoli' });
const fullDay = new Intl.DateTimeFormat('ar-LY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Tripoli' });
const weekdayName = new Intl.DateTimeFormat('ar-LY', { weekday: 'long', timeZone: 'Africa/Tripoli' });
const DAYS = 14;
// Saturday first, as the Libyan week starts.
const WEEK = [6, 0, 1, 2, 3, 4, 5];
const STAGES = [
  { key: 'pending', label: 'بانتظار المراجعة' },
  { key: 'new', label: 'جديد' },
  { key: 'in_progress', label: 'قيد المعالجة' },
  { key: 'resolved', label: 'تم الحل' },
];
const percent = (part, whole) => (whole ? Math.round(part / whole * 100) : 0);

function duration(minutes) {
  if (minutes === null) return '—';
  if (minutes < 60) return `${number(Math.max(1, Math.round(minutes)))} دقيقة`;
  if (minutes < 60 * 48) return `${number(Math.round(minutes / 60 * 10) / 10)} ساعة`;
  return `${number(Math.round(minutes / 1440 * 10) / 10)} يوم`;
}

function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// A smooth line through the points (Catmull-Rom as cubic Béziers).
function smoothPath(points) {
  return points.map(([px, py], index) => {
    if (!index) return `M${px},${py}`;
    const [x0, y0] = points[index - 2] || points[index - 1];
    const [x1, y1] = points[index - 1];
    const [x3, y3] = points[index + 1] || [px, py];
    return `C${x1 + (px - x0) / 6},${y1 + (py - y0) / 6} ${px - (x3 - x1) / 6},${py - (y3 - y1) / 6} ${px},${py}`;
  }).join(' ');
}

// Two weeks of arrivals, right to left like the page, with the daily average
// dashed and the busiest day called out.
function ArrivalsChart({ days, average }) {
  const [hover, setHover] = useState(null);
  const [ref, width] = useWidth(720);
  const height = width < 520 ? 210 : 260;
  const pad = { top: 34, right: 30, bottom: 30, left: 16 };
  const top = Math.max(4, Math.ceil(Math.max(...days.map((day) => day.count)) * 1.25));
  const x = (index) => width - pad.right - 10 - index * ((width - pad.left - pad.right - 20) / (days.length - 1));
  const y = (value) => pad.top + (1 - value / top) * (height - pad.top - pad.bottom);
  const points = days.map((day, index) => [x(index), y(day.count)]);
  const line = smoothPath(points);
  const area = `${line} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const peakIndex = days.reduce((best, day, index) => (day.count > days[best].count ? index : best), 0);
  const ticks = [0, Math.round(top / 2), top];
  const point = hover === null ? null : days[hover];
  const every = width < 520 ? 3 : 2;
  return <div className="st-chart" ref={ref} onMouseLeave={() => setHover(null)}>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} direction="ltr" role="img" aria-label={`البلاغات الواردة في آخر ${DAYS} يومًا: ${days.map((day) => `${dayLabel.format(day.date)} ${day.count}`).join('، ')}`}>
      <defs><linearGradient id="st-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#12323f" stopOpacity=".22" /><stop offset="100%" stopColor="#12323f" stopOpacity="0" /></linearGradient></defs>
      {ticks.map((value) => <g key={value}>
        <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} className="st-gridline" />
        <text x={width - pad.right + 10} y={y(value) + 4} className="st-axis" textAnchor="start">{number(value)}</text>
      </g>)}
      <path d={area} fill="url(#st-fill)" />
      <line x1={pad.left} x2={width - pad.right} y1={y(average)} y2={y(average)} className="st-avg" />
      <text x={pad.left + 4} y={y(average) - 6} className="st-avg-label" direction="rtl" textAnchor="end">المتوسط {number(Math.round(average * 10) / 10)}</text>
      <path d={line} className="st-line" />
      {days[peakIndex].count > 0 && <g className="st-peak">
        <rect x={x(peakIndex) - 34} y={y(days[peakIndex].count) - 30} width={68} height={20} rx={10} />
        <text x={x(peakIndex)} y={y(days[peakIndex].count) - 16} textAnchor="middle" direction="rtl">الأعلى {number(days[peakIndex].count)}</text>
      </g>}
      {days.map((day, index) => <g key={day.key}>
        {(days.length - 1 - index) % every === 0 && <text x={x(index)} y={height - 8} className="st-axis" textAnchor="middle" direction="rtl">{dayLabel.format(day.date)}</text>}
        <circle cx={x(index)} cy={y(day.count)} r={hover === index ? 6 : index === days.length - 1 ? 5 : 3.5} className={index === days.length - 1 ? 'st-dot is-today' : 'st-dot'} />
        <rect x={x(index) - 20} y={pad.top} width={40} height={height - pad.top - pad.bottom} className="st-hit" onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={0} aria-label={`${fullDay.format(day.date)}: ${day.count} بلاغ`} />
      </g>)}
      {point && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={y(0)} className="st-cross" />}
    </svg>
    {point && <div className="st-tooltip" style={{ left: `${x(hover) / width * 100}%`, top: `${y(point.count) / height * 100}%` }}>
      <strong className="num">{number(point.count)} بلاغ</strong><small>{fullDay.format(point.date)}</small>
    </div>}
  </div>;
}

// A small ring for a share, with the number written in the middle.
function Ring({ value, tone = 'resolved', size = 64 }) {
  const radius = size / 2 - 6;
  const length = 2 * Math.PI * radius;
  return <svg className={`st-ring is-${tone}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={radius} className="st-ring-track" />
    <circle cx={size / 2} cy={size / 2} r={radius} className="st-ring-fill" strokeDasharray={`${length * value / 100} ${length}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="st-ring-text">{number(value)}%</text>
  </svg>;
}

export function StatsPage({ refreshKey, onMenu }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([staffApi.overview(), staffApi.insights()]).then(([overview, insights]) => {
      if (!active) return;
      // Noon UTC is the same calendar day in Tripoli, so labels never slip a day.
      const all = insights.days.map((day) => ({ key: day.day, date: new Date(`${day.day}T12:00:00Z`), count: day.count }));
      const stageCount = (category, stage) => insights.breakdown
        .find((row) => row.category === category && row.stage === stage)?.count || 0;
      setData({
        overview, unclaimed: insights.unclaimed,
        previous: all.slice(0, -DAYS), days: all.slice(-DAYS), month: all,
        times: insights.median_minutes,
        categories: Object.keys(categories).map((key) => ({
          key,
          stages: Object.fromEntries(STAGES.map((stage) => [stage.key, stageCount(key, stage.key)])),
          rejected: stageCount(key, 'rejected'),
        })),
      });
      setError(''); setLoadedAt(new Date());
    }).catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [refreshKey, tick]);

  if (error) return <div className="st"><EmptyState icon={CircleAlert} title="تعذّر تحميل الإحصاءات" detail={error} onRetry={() => setTick((n) => n + 1)} /></div>;
  const head = <header className="pr-head">
    <div className="pr-title">
      <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
      <div><span className="eyebrow">قراءة البيانات</span><h1>الإحصاءات</h1>
        <p>من بيانات النظام الفعلية، لحظة فتح الصفحة.</p></div>
    </div>
    <div className="ac-head-actions">
      <button type="button" className="pr-refresh st-print" onClick={() => window.print()}><Printer size={16} />طباعة</button>
      <button type="button" className="pr-refresh" onClick={() => setTick((n) => n + 1)}>
        <RefreshCw size={16} />{loadedAt ? <>تحديث · <span className="num">{clockTime.format(loadedAt)}</span></> : 'تحديث'}
      </button>
    </div>
  </header>;
  if (!data) return <div className="st">{head}<LoadingState /></div>;

  const counts = Object.fromEntries((data.overview.byStatus || []).map((item) => [item.status, item.count]));
  const pendingReview = data.overview.pending_review || 0;
  const approvedNew = Math.max(0, (counts.new || 0) - pendingReview);
  const approved = approvedNew + (counts.in_progress || 0) + (counts.resolved || 0);
  const claimed = approved - data.unclaimed;
  const started = (counts.in_progress || 0) + (counts.resolved || 0);
  const sent = data.overview.total;
  const fieldNotes = data.overview.pending_field_review || 0;
  const completions = data.overview.pending_completion || 0;
  const waiting = pendingReview + fieldNotes + completions;
  const thisPeriod = data.days.reduce((sum, day) => sum + day.count, 0);
  const lastPeriod = data.previous.reduce((sum, day) => sum + day.count, 0);
  const change = lastPeriod ? Math.round((thisPeriod - lastPeriod) / lastPeriod * 100) : null;
  const weekdays = WEEK.map((dayIndex) => ({ dayIndex, count: data.month.filter((day) => new Date(`${day.key}T12:00:00Z`).getUTCDay() === dayIndex).reduce((sum, day) => sum + day.count, 0) }));
  const busiest = weekdays.reduce((best, day) => (day.count > best.count ? day : best), weekdays[0]);
  const weekdayMax = Math.max(1, busiest.count);
  const sampleDate = (dayIndex) => new Date(Date.UTC(2026, 0, 3 + ((dayIndex + 1) % 7)));
  const funnel = [
    { label: 'أُرسلت', value: sent, note: 'كل البلاغات' },
    { label: 'اعتُمدت', value: approved, time: data.times.approve, timeLabel: 'حتى الاعتماد' },
    { label: 'استُلمت', value: claimed, time: data.times.claim, timeLabel: 'حتى الاستلام' },
    { label: 'بدأ العمل', value: started, time: data.times.start, timeLabel: 'حتى البدء' },
    { label: 'حُلّت', value: counts.resolved || 0 },
  ];

  return <div className="st">
    {head}

    <section className="st-tiles" aria-label="الأرقام الرئيسية">
      <article className="st-tile">
        <div className="st-tile-top"><span className="st-icon"><Inbox size={18} /></span><span>الواردة · آخر {number(DAYS)} يومًا</span></div>
        <strong className="num">{number(thisPeriod)}</strong>
        {change === null ? <small>لا يوجد ما يُقارن به</small> : <small className={`st-delta ${change >= 0 ? 'is-up' : 'is-down'}`}>{change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}<span className="num">{number(Math.abs(change))}%</span> مقارنة بـ <span className="num">{number(lastPeriod)}</span> في الأسبوعين السابقين</small>}
      </article>
      <article className="st-tile st-tile-ring">
        <div><div className="st-tile-top"><span className="st-icon is-resolved"><Gauge size={18} /></span><span>نسبة الحل</span></div>
          <small><span className="num">{number(counts.resolved || 0)}</span> من <span className="num">{number(approved)}</span> بلاغًا معتمدًا</small></div>
        <Ring value={percent(counts.resolved || 0, approved)} />
      </article>
      <article className="st-tile">
        <div className="st-tile-top"><span className="st-icon is-progress"><Clock3 size={18} /></span><span>زمن الاعتماد المعتاد</span></div>
        <strong>{duration(data.times.approve)}</strong>
        <small>من وصول البلاغ حتى نشره · الوسيط لكل البلاغات</small>
      </article>
      <article className="st-tile">
        <div className="st-tile-top"><span className="st-icon is-pending"><CalendarDays size={18} /></span><span>ينتظر قرار الموظفين</span></div>
        <strong className="num">{number(waiting)}</strong>
        <div className="st-split" aria-hidden="true">{[[pendingReview, 'pending'], [fieldNotes, 'new'], [completions, 'in_progress']].filter(([value]) => value > 0).map(([value, tone]) => <i key={tone} className={`st-seg is-${tone}`} style={{ flexGrow: value }} />)}</div>
        <small>مراجعة <span className="num">{number(pendingReview)}</span> · ملاحظات <span className="num">{number(fieldNotes)}</span> · إنجاز <span className="num">{number(completions)}</span></small>
      </article>
    </section>

    <div className="st-grid">
      <section className="st-card" aria-labelledby="st-arrivals">
        <header className="st-card-head"><div><h2 id="st-arrivals">البلاغات الواردة</h2><p>كل يوم في آخر {number(DAYS)} يومًا، بتوقيت طرابلس</p></div>
          <span className="st-chip">اليوم <b className="num">{number(data.days[data.days.length - 1].count)}</b></span></header>
        <ArrivalsChart days={data.days} average={thisPeriod / DAYS} />
      </section>
      <section className="st-card" aria-labelledby="st-week">
        <header className="st-card-head"><div><h2 id="st-week">أيام الأسبوع</h2><p>آخر أربعة أسابيع</p></div></header>
        <p className="st-week-lead">أكثر الأيام بلاغات: <strong>{weekdayName.format(sampleDate(busiest.dayIndex))}</strong></p>
        <ol className="st-week">{weekdays.map((day) => <li key={day.dayIndex} className={day.dayIndex === busiest.dayIndex ? 'is-top' : ''}>
          <span className="st-week-bar"><i style={{ height: `${Math.max(4, day.count / weekdayMax * 100)}%` }} /></span>
          <b className="num">{number(day.count)}</b>
          <small>{weekdayName.format(sampleDate(day.dayIndex)).replace('ال', '')}</small>
        </li>)}</ol>
      </section>
    </div>

    <section className="st-card" aria-labelledby="st-journey">
      <header className="st-card-head"><div><h2 id="st-journey">رحلة البلاغ</h2><p>كم بلاغًا وصل إلى كل مرحلة، والوقت المعتاد بين المراحل (الوسيط لكل البلاغات)</p></div></header>
      <ol className="st-funnel">{funnel.map((step, index) => <li key={step.label}>
        {step.time !== undefined && <span className="st-funnel-time"><Clock3 size={12} />{duration(step.time)}<small>{step.timeLabel}</small></span>}
        <div className="st-funnel-step" style={{ '--share': `${Math.max(6, percent(step.value, sent))}%` }}>
          <span className="st-funnel-label">{step.label}</span>
          <strong className="num">{number(step.value)}</strong>
          <small>{index ? <><span className="num">{number(percent(step.value, sent))}%</span> من المُرسلة</> : step.note}</small>
          <i aria-hidden="true" />
        </div>
      </li>)}</ol>
    </section>

    <section className="st-card" aria-labelledby="st-breakdown">
      <header className="st-card-head"><div><h2 id="st-breakdown">التصنيفات والجهات</h2><p>أين يقف كل نوع من المشكلات، ونسبة ما حلّته جهته</p></div>
        <button type="button" className={`rl-toggle ${asTable ? 'is-on' : ''}`} aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}><Table2 size={16} />{asTable ? 'عرض كبطاقات' : 'عرض كجدول'}</button>
      </header>
      {asTable ? <div className="st-scroll"><table className="st-table">
        <thead><tr><th scope="col">التصنيف</th>{STAGES.map((stage) => <th scope="col" key={stage.key}>{stage.label}</th>)}<th scope="col">مرفوض</th></tr></thead>
        <tbody>{data.categories.map((item) => <tr key={item.key}><th scope="row">{categories[item.key].label}</th>{STAGES.map((stage) => <td key={stage.key} className="num">{number(item.stages[stage.key])}</td>)}<td className="num">{number(item.rejected)}</td></tr>)}</tbody>
      </table></div> : <>
        <div className="st-cats">{data.categories.map((item) => {
          const total = STAGES.reduce((sum, stage) => sum + item.stages[stage.key], 0);
          const done = total - item.stages.pending;
          const open = item.stages.new + item.stages.in_progress;
          return <article key={item.key} className={`st-cat is-${item.key}`}>
            <div className="st-cat-hero">
              <span className="st-cat-icon"><CategoryIcon category={item.key} size={24} /></span>
              <div className="st-cat-name"><h3>{categories[item.key].label}</h3><small><Building2 size={13} />{agencyNames[categoryAgency[item.key]]}</small></div>
              <div className="st-cat-ring"><Ring value={percent(item.stages.resolved, done)} size={78} /><small>نسبة الحل</small></div>
            </div>
            <dl className="st-cat-figures">
              <div><dt>كل البلاغات</dt><dd className="num">{number(total)}</dd></div>
              <div className="is-open"><dt>لدى الجهة الآن</dt><dd className="num">{number(open)}</dd></div>
              <div><dt>مرفوضة</dt><dd className="num">{number(item.rejected)}</dd></div>
            </dl>
            <div className="st-cat-strip" aria-hidden="true">{STAGES.filter((stage) => item.stages[stage.key] > 0).map((stage) => <i key={stage.key} className={`st-seg is-${stage.key}`} style={{ flexGrow: item.stages[stage.key] }} />)}</div>
            <ul className="st-cat-stages">{STAGES.map((stage) => <li key={stage.key}>
              <span className="st-cat-stage"><i className={`st-swatch is-${stage.key}`} />{stage.label}</span>
              <span className="st-cat-track"><b className={`st-seg is-${stage.key}`} style={{ width: `${percent(item.stages[stage.key], total)}%` }} /></span>
              <strong className="num">{number(item.stages[stage.key])}</strong>
            </li>)}</ul>
          </article>;
        })}</div>
      </>}
    </section>
  </div>;
}
