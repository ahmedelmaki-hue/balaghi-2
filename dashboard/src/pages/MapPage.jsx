// The staff map of every non-rejected report, beside a list of what is in view.
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowLeft, CircleAlert, Clock3, Crosshair, MapPin, Menu, Minus, Plus, RefreshCw,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { categories, fmtDate, number, categoryName, errorText, CategoryIcon, StatusPill, ReportThumbnail } from '../shared.jsx';

const TRIPOLI = [32.8872, 13.1913];
const relativeTime = new Intl.RelativeTimeFormat('ar-LY', { numeric: 'auto' });
const clockTime = new Intl.DateTimeFormat('ar-LY', { timeStyle: 'short' });
function since(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return relativeTime.format(-minutes, 'minute');
  if (minutes < 60 * 24) return relativeTime.format(-Math.round(minutes / 60), 'hour');
  return relativeTime.format(-Math.round(minutes / 1440), 'day');
}

// The category icon drawn inside each pin, so a pin is not told apart by colour
// alone. Shapes from Lucide (ISC licence), the same icons the dashboard uses.
const PIN_ICONS = {
  pothole: '<rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/><path d="m8 6 8 8"/>',
  water_leak: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  garbage: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
};
const pinHtml = (report, stage, state) => `<span class="mp-pin is-${stage} ${state}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PIN_ICONS[report.category] || ''}</svg></span>`;

const STAGES = [
  { value: '', label: 'الكل' },
  { value: 'pending', label: 'بانتظار المراجعة' },
  { value: 'new', label: 'جديد' },
  { value: 'in_progress', label: 'قيد المعالجة' },
  { value: 'resolved', label: 'تم الحل' },
];

export function MapPage({ onOpen, refreshKey, onMenu }) {
  const container = useRef(null);
  const map = useRef(null);
  const markerLayer = useRef(null);
  const listRef = useRef(null);
  const [bounds, setBounds] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [tick, setTick] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const stageOf = (report) => (!report.approved_at ? 'pending' : report.status);
  const filtered = status ? items.filter((report) => stageOf(report) === status) : items;
  const countOf = (value) => (value ? items.filter((item) => stageOf(item) === value).length : items.length);
  const resetView = () => map.current?.setView(TRIPOLI, 13);

  useEffect(() => {
    if (!container.current || map.current) return undefined;
    const instance = L.map(container.current, { zoomControl: false }).setView(TRIPOLI, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(instance);
    const layer = L.layerGroup().addTo(instance);
    map.current = instance; markerLayer.current = layer;
    const updateBounds = () => { const b = instance.getBounds(); setBounds(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`); };
    instance.on('moveend', updateBounds);
    updateBounds();
    return () => { instance.off('moveend', updateBounds); instance.remove(); map.current = null; markerLayer.current = null; };
  }, []);

  useEffect(() => {
    if (!bounds || !markerLayer.current) return undefined;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const loaded = [];
        let cursor;
        do {
          const data = await staffApi.staffMarkers(bounds, { category, cursor });
          loaded.push(...data.items);
          cursor = data.next_cursor;
        } while (cursor && loaded.length < 5000 && active);
        if (!active) return;
        setItems(loaded); setTruncated(Boolean(cursor)); setError(''); setLoadedAt(new Date());
      } catch (cause) { if (active) setError(errorText(cause)); }
      finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [bounds, category, refreshKey, tick]);

  useEffect(() => {
    const layer = markerLayer.current;
    if (!layer) return;
    layer.clearLayers();
    filtered.forEach((report) => {
      const state = selectedId === report.id ? 'is-selected' : hoverId === report.id ? 'is-hover' : '';
      const marker = L.marker([Number(report.latitude), Number(report.longitude)], {
        icon: L.divIcon({ className: '', html: pinHtml(report, stageOf(report), state), iconSize: [36, 44], iconAnchor: [18, 42] }),
        keyboard: true, title: `بلاغ ${report.id} · ${categoryName(report.category)}`,
        zIndexOffset: state ? 1000 : 0,
      });
      marker.on('click', () => setSelectedId(report.id));
      marker.addTo(layer);
    });
  }, [items, status, selectedId, hoverId]);

  // A pin picked on the map scrolls its row into view in the list.
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-report="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setSelectedDetail(null); setDetailError(''); return undefined; }
    let active = true;
    setSelectedDetail(null); setDetailError('');
    staffApi.report(selectedId)
      .then((result) => { if (active) setSelectedDetail(result.report); })
      .catch((cause) => { if (active) setDetailError(errorText(cause)); });
    return () => { active = false; };
  }, [selectedId, refreshKey]);

  const pick = (report) => {
    setSelectedId(report.id);
    map.current?.panTo([Number(report.latitude), Number(report.longitude)], { animate: true });
  };

  return <div className="mp">
    <header className="pr-head">
      <div className="pr-title">
        <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
        <div><span className="eyebrow">الموقع الجغرافي</span>
          <h1>خريطة البلاغات<span className="pr-count num">{truncated ? `${number(items.length)}+` : number(items.length)}</span></h1>
          <p>البلاغات في النطاق المعروض، بما فيها المنتظرة للمراجعة. المواطن يرى المعتمدة فقط.</p></div>
      </div>
      <button type="button" className="pr-refresh" onClick={() => setTick((n) => n + 1)}>
        <RefreshCw size={16} />{loadedAt ? <>تحديث · <span className="num">{clockTime.format(loadedAt)}</span></> : 'تحديث'}
      </button>
    </header>

    <section className="rl-filters mp-filters" aria-label="تصفية الخريطة">
      <div className="rl-stages" role="group" aria-label="المرحلة">
        {STAGES.map((stage) => <button type="button" key={stage.value || 'all'} className={`${status === stage.value ? 'is-active' : ''} ${stage.value ? `is-${stage.value === 'in_progress' ? 'progress' : stage.value}` : ''}`} aria-pressed={status === stage.value} onClick={() => { setStatus(stage.value); setSelectedId(null); }}>
          {stage.value && <i className="rl-dot" aria-hidden="true" />}{stage.label}<small className="num">{number(countOf(stage.value))}</small>
        </button>)}
      </div>
      <label className="pr-field"><span>التصنيف</span><select value={category} onChange={(event) => { setCategory(event.target.value); setSelectedId(null); }}><option value="">الكل</option>{Object.entries(categories).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
    </section>

    {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((n) => n + 1)}>إعادة المحاولة</button></div>}
    {truncated && <div className="inline-note">يوجد أكثر من ٥٠٠٠ بلاغ في هذا النطاق. قرّب الخريطة لعرض البقية.</div>}

    <div className="mp-body">
      <aside className="mp-list" aria-label="البلاغات في النطاق المعروض">
        <h2>في النطاق المعروض<small className="num">{number(filtered.length)}</small></h2>
        {filtered.length === 0 ? <p className="mp-list-empty">{loading ? 'جارٍ تحميل البلاغات…' : 'لا توجد بلاغات بهذه الحالة هنا. حرّك الخريطة أو غيّر الفلتر.'}</p>
          : <ol ref={listRef}>{filtered.map((report) => {
            const open = selectedId === report.id;
            return <li key={report.id} data-report={report.id} className={open ? 'is-open' : ''}>
              <button type="button" className="mp-row" onClick={() => (open ? setSelectedId(null) : pick(report))} onMouseEnter={() => setHoverId(report.id)} onMouseLeave={() => setHoverId(null)} onFocus={() => setHoverId(report.id)} onBlur={() => setHoverId(null)} aria-expanded={open}>
                <span className={`mp-row-icon is-${stageOf(report)}`}><CategoryIcon category={report.category} size={16} /></span>
                <span className="mp-row-main"><strong><span className="num">#{report.id}</span> · {categoryName(report.category)}</strong><small><Clock3 size={12} />{since(report.created_at)}</small></span>
                <StatusPill report={report} />
              </button>
              {open && <div className="mp-preview">
                <ReportThumbnail key={report.id} report={selectedDetail || report} />
                <div>
                  <p>{selectedDetail ? (selectedDetail.description || 'لم يُضف المواطن وصفًا.') : 'جارٍ تحميل التفاصيل…'}</p>
                  <small><MapPin size={13} />{selectedDetail?.address_text || 'الموقع محدد على الخريطة'}</small>
                  <small><Clock3 size={13} />{fmtDate(report.created_at)}</small>
                  {detailError && <small className="mp-preview-error">{detailError}</small>}
                </div>
                <button type="button" className="rl-open" onClick={() => onOpen(report.id)}>فتح تفاصيل البلاغ<ArrowLeft size={16} /></button>
              </div>}
            </li>;
          })}</ol>}
      </aside>

      <div className="mp-map">
        <div className="mp-canvas" ref={container} aria-label="خريطة البلاغات للموظفين" />
        <div className="mp-controls" role="group" aria-label="التحكم بالخريطة">
          <button type="button" aria-label="تكبير الخريطة" onClick={() => map.current?.zoomIn()}><Plus size={18} /></button>
          <button type="button" aria-label="تصغير الخريطة" onClick={() => map.current?.zoomOut()}><Minus size={18} /></button>
          <button type="button" aria-label="العودة إلى طرابلس المركز" title="العودة إلى طرابلس المركز" onClick={resetView}><Crosshair size={18} /></button>
        </div>
        {loading && <span className="mp-loading"><span className="spinner" />جارٍ التحديث…</span>}
        <p className="mp-legend" aria-label="ألوان الحالات على الخريطة">
          <span><i className="rl-dot is-pending" />بانتظار المراجعة</span><span><i className="rl-dot is-new" />جديد</span><span><i className="rl-dot is-progress" />قيد المعالجة</span><span><i className="rl-dot is-resolved" />تم الحل</span>
        </p>
      </div>
    </div>
  </div>;
}
