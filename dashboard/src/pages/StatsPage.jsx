// Report counts by stage and category.
import React, { useEffect, useState } from 'react';
import {
  BarChart3, CircleAlert,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { categories, number, errorText, CategoryIcon, EmptyState, LoadingState, PageHeading } from '../shared.jsx';

export function StatsPage({ refreshKey, onMenu }) {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([staffApi.overview(), staffApi.reports({ review: 'pending', limit: 1 })])
      .then(([stats, queue]) => { if (active) { setData(stats); setPending(queue.total); setError(''); } })
      .catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [refreshKey, tick]);
  const byStatus = Object.fromEntries((data?.byStatus || []).map((item) => [item.status, item.count]));
  const byCategory = Object.fromEntries((data?.byCategory || []).map((item) => [item.category, item.count]));
  const rows = [
    { label: 'بانتظار المراجعة', value: pending, tone: 'amber' },
    { label: 'جديد', value: Math.max(0, (byStatus.new || 0) - pending), tone: 'red' },
    { label: 'قيد المعالجة', value: byStatus.in_progress || 0, tone: 'blue' },
    { label: 'تم الحل', value: byStatus.resolved || 0, tone: 'green' },
    { label: 'مرفوض', value: byStatus.rejected || 0, tone: 'gray' },
  ];
  return <><PageHeading eyebrow="قراءة البيانات" title="الإحصاءات" subtitle="صورة واضحة عن توزيع البلاغات الفعلية في النظام." action="تحديث الإحصاءات" onAction={() => setTick((n) => n + 1)} onMenu={onMenu} />
    {error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل الإحصاءات" detail={error} onRetry={() => setTick((n) => n + 1)} /> : !data ? <LoadingState /> : <>
      <div className="stats-intro"><span className="stats-intro-icon"><BarChart3 size={27} /></span><div><span>إجمالي البلاغات المسجلة</span><strong>{number(data.total)}</strong></div><p>تشمل البلاغات المعتمدة والمنتظرة والمرفوضة.</p></div>
      <div className="charts-grid"><section className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">حسب الحالة</span><h2>مراحل متابعة البلاغات</h2></div></div><div className="bar-list">{rows.map((row) => <div className="bar-row" key={row.label}><div><span>{row.label}</span><strong>{number(row.value)}</strong></div><div className="bar-track"><span className={`bar-fill ${row.tone}`} style={{ width: `${data.total ? Math.max(0, row.value / data.total * 100) : 0}%` }} /></div></div>)}</div></section>
        <section className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">حسب التصنيف</span><h2>أنواع المشكلات</h2></div></div><div className="category-stats">{Object.entries(categories).map(([key, item]) => <div className="category-stat" key={key}><CategoryIcon category={key} size={22} /><div><strong>{item.label}</strong><small>{number(byCategory[key] || 0)} بلاغ</small></div><div className="category-stat-bar"><span style={{ width: `${data.total ? (byCategory[key] || 0) / data.total * 100 : 0}%` }} /></div></div>)}</div><p className="chart-footnote">التصنيفات تشمل جميع البلاغات المسجلة، بما فيها المنتظرة والمرفوضة.</p></section></div>
    </>}
  </>;
}

