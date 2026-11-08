// Export of the reports the current filters select: an Excel file or a printed report.
// Citizens' names and phones are left out on purpose; files travel easily.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, CircleAlert, Download, FileSpreadsheet, Printer, X } from 'lucide-react';
import { staffApi } from './api.js';
import { buildXlsx } from './xlsx.js';
import { agencyNames, categoryName, errorText, fmtDate, number, reportStatusName } from './shared.jsx';

const dayOnly = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'medium', timeZone: 'Africa/Tripoli' });
const sortableDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' });
const dayText = (value) => (value ? dayOnly.format(new Date(value)) : '—');
// Excel gets 2026-11-04: it sorts correctly and carries no hidden direction marks.
const dayCell = (value) => (value ? sortableDay.format(new Date(value)) : '—');

const COLUMNS = [
  ['رقم البلاغ', (report) => Number(report.id), 11],
  ['التصنيف', (report) => categoryName(report.category), 13],
  ['الموقع', (report) => report.address_text || 'محدد على الخريطة', 36],
  ['الحالة', (report) => reportStatusName(report), 18],
  ['الجهة', (report) => agencyNames[report.assigned_agency] || '—', 34],
  ['العامل', (report) => report.assigned_worker_name || '—', 20],
  ['تاريخ الإرسال', (report) => dayText(report.created_at), 14, (report) => dayCell(report.created_at)],
  ['بدأ العمل', (report) => dayText(report.work_started_at), 14, (report) => dayCell(report.work_started_at)],
];

function saveExcel(reports) {
  const bytes = buildXlsx({
    sheet: 'البلاغات',
    titles: COLUMNS.map(([title]) => title),
    rows: reports.map((report) => COLUMNS.map(([, read, , readCell]) => (readCell || read)(report))),
    widths: COLUMNS.map(([, , width]) => width),
  });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `balaghi-reports-${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function PrintSheet({ reports, summary, onClose }) {
  useEffect(() => {
    document.body.classList.add('px-open');
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.classList.remove('px-open'); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return createPortal(<div className="px-layer" role="dialog" aria-modal="true" aria-label="معاينة تقرير البلاغات">
    <div className="px-toolbar">
      <strong>معاينة الطباعة</strong>
      <div>
        <button type="button" className="px-print" onClick={() => window.print()}><Printer size={17} />طباعة أو حفظ PDF</button>
        <button type="button" className="px-close" onClick={onClose} aria-label="إغلاق المعاينة"><X size={19} /></button>
      </div>
    </div>
    <article className="px-sheet">
      <header className="px-sheet-head">
        <div><strong className="px-brand">بلاغي<i /></strong><span>بلدية طرابلس المركز</span></div>
        <div className="px-issued"><span>تاريخ الإصدار</span><strong>{fmtDate(new Date())}</strong></div>
      </header>
      <h1>تقرير البلاغات</h1>
      <dl className="px-facts">
        <div><dt>الفلاتر</dt><dd>{summary}</dd></div>
        <div><dt>عدد البلاغات</dt><dd className="num">{number(reports.length)}</dd></div>
      </dl>
      <div className="px-table-wrap"><table className="px-table">
        <thead><tr>{COLUMNS.map(([title]) => <th scope="col" key={title}>{title}</th>)}</tr></thead>
        <tbody>{reports.map((report) => <tr key={report.id}>{COLUMNS.map(([title, read]) => <td key={title}>{read(report)}</td>)}</tr>)}</tbody>
      </table></div>
    </article>
  </div>, document.body);
}

// Button and menu for a page; \`query\` is what the list sends and \`summary\` describes it in words.
export function ReportExport({ query, summary, total }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!box.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const run = async (use) => {
    setOpen(false); setBusy(true); setError('');
    try {
      const { items } = await staffApi.exportReports(query);
      use(items);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  return <div className="px-export" ref={box}>
    <button type="button" className="pr-refresh" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((value) => !value)}><Download size={16} />{busy ? 'جارٍ التجهيز…' : 'تصدير'}<ChevronDown size={15} /></button>
    {open && <div className="px-menu" role="menu">
      <p>{total === undefined ? 'البلاغات المطابقة للفلاتر' : <><span className="num">{number(total)}</span> بلاغ مطابق للفلاتر</>}</p>
      <button type="button" role="menuitem" onClick={() => run(saveExcel)}><FileSpreadsheet size={18} /><span><strong>ملف Excel</strong><small>للعمل على الأرقام أو إرسالها</small></span></button>
      <button type="button" role="menuitem" onClick={() => run(setSheet)}><Printer size={18} /><span><strong>طباعة</strong><small>تقرير مرتب، ويمكن حفظه PDF</small></span></button>
    </div>}
    {error && <p className="px-error" role="alert"><CircleAlert size={15} />{error}</p>}
    {sheet && <PrintSheet reports={sheet} summary={summary} onClose={() => setSheet(null)} />}
  </div>;
}
