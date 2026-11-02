// The staff map of every non-rejected report.
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowLeft, CircleAlert, Clock3, MapPin, MapPinned, Minus, Plus, RefreshCw, X,
} from 'lucide-react';
import { staffApi } from '../api.js';
import { fmtDate, number, categoryName, errorText, StatusPill, ReportThumbnail, PageHeading } from '../shared.jsx';

export function MapPage({ onOpen, refreshKey, onMenu }) {
  const container = useRef(null);
  const map = useRef(null);
  const markerLayer = useRef(null);
  const [bounds, setBounds] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [tick, setTick] = useState(0);
  const mapStatus = (report) => !report.approved_at ? 'pending' : report.status;
  const filtered = status ? items.filter((report) => mapStatus(report) === status) : items;
  const statusFilters = [
    { value: '', label: 'الكل', count: items.length },
    { value: 'pending', label: 'بانتظار المراجعة', count: items.filter((item) => mapStatus(item) === 'pending').length },
    { value: 'new', label: 'جديد', count: items.filter((item) => mapStatus(item) === 'new').length },
    { value: 'in_progress', label: 'قيد المعالجة', count: items.filter((item) => mapStatus(item) === 'in_progress').length },
    { value: 'resolved', label: 'تم الحل', count: items.filter((item) => mapStatus(item) === 'resolved').length },
  ];
  const selected = filtered.find((report) => report.id === selectedId);
  const resetView = () => map.current?.setView([32.8872, 13.1913], 12);
  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = L.map(container.current, { zoomControl: false }).setView([32.8872, 13.1913], 12);
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
    if (!bounds || !markerLayer.current) return;
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
        setItems(loaded); setTruncated(Boolean(cursor)); setError('');
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
      const tone = mapStatus(report) === 'in_progress' ? 'in-progress' : mapStatus(report);
      const marker = L.marker([Number(report.latitude), Number(report.longitude)], {
        icon: L.divIcon({ className: '', html: `<span class="map-marker ${tone} ${selectedId === report.id ? 'is-selected' : ''}"><span></span></span>`, iconSize: [42, 48], iconAnchor: [21, 44] }),
      });
      marker.on('click', () => setSelectedId(report.id));
      marker.addTo(layer);
    });
  }, [items, status, selectedId]);
  useEffect(() => {
    if (!selectedId) { setSelectedDetail(null); setDetailError(''); return; }
    let active = true;
    setSelectedDetail(null); setDetailError('');
    staffApi.report(selectedId)
      .then((result) => { if (active) setSelectedDetail(result.report); })
      .catch((cause) => { if (active) setDetailError(errorText(cause)); });
    return () => { active = false; };
  }, [selectedId, refreshKey]);
  return <><PageHeading eyebrow="الموقع الجغرافي" title="الخريطة التفاعلية للبلاغات" subtitle="تابع مواقع البلاغات في النطاق المعروض، بما فيها البلاغات المنتظرة للمراجعة الداخلية." action="تحديث الخريطة" onAction={() => setTick((n) => n + 1)} onMenu={onMenu} />
    <section className="map-workspace">
      <div className="map-workspace-head"><div><strong><MapPin size={19} />{truncated ? `${number(items.length)}+` : number(items.length)} بلاغ في النطاق المعروض</strong><span>تظهر البلاغات المنتظرة للموظفين فقط، وتبقى خريطة المواطن للبلاغات المعتمدة.</span></div><div className="map-head-actions"><label>التصنيف<select value={category} onChange={(e) => { setCategory(e.target.value); setSelectedId(null); }}><option value="">جميع التصنيفات</option><option value="pothole">الحفر</option><option value="water_leak">تسرب مياه</option><option value="garbage">قمامة</option></select></label><button className="button button-quiet" onClick={() => { setCategory(''); setStatus(''); setSelectedId(null); resetView(); }}><RefreshCw size={15} />إعادة الضبط</button></div></div>
      <div className="map-filter-bar" role="group" aria-label="تصفية البلاغات حسب الحالة">{statusFilters.map((filter) => <button key={filter.value} className={`map-filter-chip ${filter.value || 'all'} ${status === filter.value ? 'active' : ''}`} aria-pressed={status === filter.value} onClick={() => { setStatus(filter.value); setSelectedId(null); }}><i />{filter.label}<b>{number(filter.count)}</b></button>)}</div>
      {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((n) => n + 1)}>إعادة المحاولة</button></div>}
      {truncated && <div className="inline-note">يوجد أكثر من ٥٠٠٠ بلاغ في هذا النطاق. قرّب الخريطة لعرض البقية.</div>}
      <div className="map-shell map-dashboard-shell"><div className="map-canvas" ref={container} aria-label="خريطة البلاغات للموظفين" />
        <div className="map-floating-controls"><button aria-label="تكبير الخريطة" onClick={() => map.current?.zoomIn()}><Plus size={19} /></button><button aria-label="تصغير الخريطة" onClick={() => map.current?.zoomOut()}><Minus size={19} /></button><button className="map-reset-view" onClick={resetView} title="العودة إلى طرابلس"><MapPinned size={18} /></button></div>
        {loading && <span className="map-loading"><span className="spinner" />جارٍ تحديث البلاغات...</span>}
        {!loading && !error && filtered.length === 0 && <span className="map-empty">لا توجد بلاغات بهذه الحالة في النطاق المعروض.</span>}
        {selected && <div className="map-selected"><button className="map-selected-close" aria-label="إغلاق المعاينة" onClick={() => setSelectedId(null)}><X size={18} /></button><div className="map-preview-heading"><span className="eyebrow">معاينة البلاغ #{selected.id}</span><StatusPill report={selectedDetail || selected} /></div><div className="map-preview-body"><ReportThumbnail key={selected.id} report={selectedDetail || selected} /><div><strong>{categoryName(selected.category)}</strong><p>{selectedDetail?.description || 'جارٍ تحميل وصف البلاغ...'}</p><small><MapPin size={13} />{selectedDetail?.address_text || `${Number(selected.latitude).toFixed(5)}، ${Number(selected.longitude).toFixed(5)}`}</small><small><Clock3 size={13} />{fmtDate(selected.created_at)}</small></div></div>{detailError && <small className="map-preview-error">{detailError}</small>}<button className="button button-navy" onClick={() => onOpen(selected.id)}>فتح تفاصيل البلاغ<ArrowLeft size={17} /></button></div>}
      </div>
    </section>
  </>;
}

