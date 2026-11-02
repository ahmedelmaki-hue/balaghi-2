import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowLeft, ArrowUpLeft, Ban, BarChart3, CalendarDays, Check, CheckCheck,
  ChevronLeft, ChevronRight, CircleAlert, Clock3, Construction, Contact, Copy, Droplets,
  Eye, FileClock, FolderOpen, History, Image as ImageIcon, KeyRound, LayoutDashboard, LogOut, MapPin,
  MapPinned, Menu, Minus, Pencil, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2,
  UserCog, UserPlus, UserRound, Users, X,
} from 'lucide-react';
import {
  ApiError, adminApi, changePassword, fieldApi, imageUrl, login, logout, restoreSession, staffApi,
} from './api.js';
import { buildReportTimeline } from './reportTimeline.js';
import CompletionCamera from './CompletionCamera.jsx';

const categories = {
  pothole: { label: 'الحفر', icon: Construction },
  water_leak: { label: 'تسرب مياه', icon: Droplets },
  garbage: { label: 'قمامة', icon: Trash2 },
};
const agencies = {
  public_services: 'شركة الخدمات العامة - لمشاكل تراكم النفايات',
  water_sewer: 'الشركة العامة للمياه و الصرف الصحي - لمشاكل تسربات المياه',
  roads_maintenance: 'مكتب الطرق و الصيانة - لمشاكل الحفر',
};
const agencyTeams = {
  public_services: 'فريق شركة الخدمات العامة',
  water_sewer: 'فريق الشركة العامة للمياه والصرف الصحي',
  roads_maintenance: 'فريق مكتب الطرق والصيانة',
};
const categoryAgency = {
  garbage: 'public_services', water_leak: 'water_sewer', pothole: 'roads_maintenance',
};
const statuses = {
  new: { label: 'جديد', className: 'new' },
  in_progress: { label: 'قيد المعالجة', className: 'in-progress' },
  resolved: { label: 'تم الحل', className: 'resolved' },
  rejected: { label: 'مرفوض', className: 'rejected' },
};
const fieldIssueReasons = {
  not_found: 'المشكلة غير موجودة', wrong_location: 'الموقع غير صحيح',
  duplicate: 'بلاغ مكرر', inaccessible: 'تعذّر الوصول', other: 'سبب آخر',
};
const verificationResults = {
  exists: 'المشكلة موجودة', wrong_location: 'الموقع غير صحيح',
  not_found: 'المشكلة غير موجودة', unable: 'تعذّر التحقق',
  cancelled: 'أُلغي طلب التحقق',
};
const navigation = [
  { key: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { key: 'pending', label: 'بانتظار المراجعة', icon: FileClock },
  { key: 'fieldReview', label:'تحتاج مراجعة موظف', icon: CircleAlert },
  { key: 'completion', label: 'بانتظار تأكيد الحل', icon: CheckCheck },
  { key: 'reports', label: 'جميع البلاغات', icon: ShieldCheck },
  { key: 'map', label: 'الخريطة', icon: MapPinned },
  { key: 'stats', label: 'الإحصاءات', icon: BarChart3 },
];
// Mirrors the server rules; the server still checks every request.
const permissionNames = {
  manage_staff: 'إدارة الموظفين',
  manage_workers: 'إدارة العمال الميدانيين',
  manage_citizens: 'إدارة المواطنين',
  view_audit: 'عرض سجل الإجراءات',
};
const rolePermission = { staff: 'manage_staff', field_worker: 'manage_workers' };
const hasPermission = (user, permission) => user.role === 'admin' &&
  (user.is_owner || (user.admin_permissions || []).includes(permission));
const canManageRole = (user, role) => (role === 'admin'
  ? user.role === 'admin' && user.is_owner : hasPermission(user, rolePermission[role]));
const manageableRoles = (user) => ['staff', 'field_worker', 'admin'].filter((role) => canManageRole(user, role));
const adminNavigation = [
  { key: 'accounts', label: (user) => accountsLabel(user), icon: Users, allowed: (user) => manageableRoles(user).length > 0 },
  { key: 'citizens', label: 'المواطنون', icon: Contact, allowed: (user) => hasPermission(user, 'manage_citizens') },
  { key: 'audit', label: 'سجل الإجراءات', icon: History, allowed: (user) => hasPermission(user, 'view_audit') },
];
// Named after what this administrator manages: «الموظفون», «العمال», or both.
function accountsLabel(user) {
  const roles = manageableRoles(user);
  if (roles.includes('staff') && !roles.includes('field_worker')) return 'الموظفون';
  if (roles.includes('field_worker') && !roles.includes('staff')) return 'العمال';
  return 'الموظفون والعمال';
}
const allowedAdminPages = (user) => adminNavigation.filter((item) => item.allowed(user))
  .map((item) => ({ ...item, label: typeof item.label === 'function' ? item.label(user) : item.label }));
const roleNames = {
  admin: 'مسؤول', staff: 'موظف', field_worker: 'عامل ميداني', citizen: 'مواطن',
};
const auditActions = {
  account_created: 'إنشاء حساب', account_updated: 'تعديل حساب',
  account_deactivated: 'تعطيل حساب', account_reactivated: 'إعادة تفعيل حساب',
  password_reset: 'إعادة تعيين كلمة المرور', password_changed: 'تغيير كلمة المرور',
};
const adminMessages = {
  'username already exists': 'اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.',
  'cannot change own role': 'لا يمكنك تغيير دورك بنفسك.',
  'cannot change own account status': 'لا يمكنك تعطيل حسابك بنفسك.',
  'use password change for your own account': 'غيّر كلمة مرورك من «تغيير كلمة المرور».',
  'worker has reports in progress': 'لدى هذا العامل بلاغات قيد المعالجة؛ لا يمكن تغيير دوره أو جهته الآن.',
  'account already has this status': 'حالة الحساب تغيّرت. حدّث القائمة.',
  'no changes': 'لم تُغيّر أي بيانات.',
  'field workers need a valid agency': 'اختر جهة العمل للعامل الميداني.',
  'reason required (1 to 500 characters)': 'اكتب السبب (حتى 500 حرف).',
  'current password incorrect': 'كلمة المرور الحالية غير صحيحة.',
  'password must be 10 to 72 characters': 'كلمة المرور الجديدة يجب أن تكون من 10 إلى 72 حرفًا.',
  'new password must differ': 'اختر كلمة مرور مختلفة عن الحالية.',
  'owner accounts are managed on the server': 'حساب المسؤول الرئيسي يُدار من الخادم فقط.',
  'permissions apply to other administrators only': 'الصلاحيات تُحدَّد للمسؤولين الآخرين فقط.',
  'invalid permissions': 'اختر صلاحيات صحيحة.',
  'too many attempts': 'محاولات كثيرة متتالية. انتظر بضع دقائق ثم حاول مجددًا.',
};
const accountRoleName = (account) => (account.role === 'admin' && account.is_owner
  ? 'مسؤول رئيسي' : roleNames[account.role]);

const fmtDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-LY', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
};
const number = (value) => new Intl.NumberFormat('ar-LY').format(Number(value) || 0);
const reportSearchId = (value) => {
  const id = value.trim().replace(/^#/, '');
  return !id || (/^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n) ? id : null;
};
const categoryName = (value) => categories[value]?.label || 'تصنيف غير معروف';
const statusName = (value) => statuses[value]?.label || '—';
const errorText = (error) => {
  if (error instanceof ApiError) {
    if (adminMessages[error.message]) return adminMessages[error.message];
    if (error.message === 'account disabled') return 'هذا الحساب معطّل. تواصل مع مسؤول النظام.';
    if (error.status === 401) return 'انتهت جلسة الدخول. سجّل الدخول مجددًا.';
    if (error.status === 403) return 'ليس لديك صلاحية لهذا الإجراء.';
    if (error.status === 404) return 'هذا البلاغ غير موجود.';
    if (error.status === 400) return 'تحقق من البيانات المدخلة وحاول مجددًا.';
    if (error.status === 409) return 'تغيّرت حالة البلاغ. حدّث التفاصيل وحاول مجددًا.';
    if (error.status === 422) return 'الموقع المختار خارج نطاق طرابلس المركز. اختر نقطة داخل الحدود.';
    if (error.status === 502 && error.message === 'image storage unavailable')
      return 'تعذّر تحميل صور البلاغات من التخزين المحلي (502).';
    if (error.status >= 500) return `حدث خطأ في الخادم (${error.status}).`;
    return `تعذّر تحميل البيانات (${error.status}): ${error.message}`;
  }
  return 'تعذّر وصول المتصفح إلى الخادم. تحقق من اتصال الصفحة ثم حاول مجددًا.';
};

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <img src="/balaghi_logo.png" alt="شعار بلاغي" />
    <div><strong>بلاغي<span className="brand-dot">.</span></strong><small>لوحة إدارة البلاغات</small></div>
  </div>;
}

function CategoryIcon({ category, size = 19 }) {
  const Icon = categories[category]?.icon || CircleAlert;
  return <span className="category-icon"><Icon size={size} strokeWidth={2.1} /></span>;
}

function StatusPill({ report }) {
  const style = report.status === 'rejected' ? 'rejected'
    : !report.approved_at ? 'pending' : statuses[report.status]?.className || 'pending';
  const label = report.status === 'rejected' ? 'مرفوض'
    : !report.approved_at ? 'بانتظار المراجعة' : statusName(report.status);
  return <span className={`status-pill ${style}`}><i />{label}</span>;
}

function AcceptanceState({ report }) {
  if (!report.approved_at || report.status !== 'new') return null;
  const worker = report.assigned_worker_name || report.assigned_worker_username;
  return <span className={`acceptance-state ${report.accepted_at ? 'accepted' : 'waiting'}`}>
    {report.accepted_at ? `استلمه ${worker || 'العامل الميداني'}` : 'بانتظار الاستلام'}
  </span>;
}

function VerificationState({ report }) {
  if (report.approved_at || report.status === 'rejected' ||
      !report.verification_requested_at || report.verification_result === 'cancelled') return null;
  return <span className={`verification-state ${report.verification_result ? 'answered' : 'waiting'}`}>
    {report.verification_result ? 'وصل رد التحقق' : 'قيد التحقق الميداني'}
  </span>;
}

function ReportThumbnail({ report }) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(report.image_url);
  return <span className="report-thumb">
    {src && !failed ? <img src={src} alt={`صورة البلاغ ${report.id}`} onError={() => setFailed(true)} />
      : <CategoryIcon category={report.category} size={23} />}
  </span>;
}

function EmptyState({ icon: Icon = FileClock, title, detail, onRetry }) {
  return <div className="empty-state">
    <span className="empty-icon"><Icon size={28} /></span>
    <h3>{title}</h3><p>{detail}</p>
    {onRetry && <button className="button button-quiet" onClick={onRetry}><RefreshCw size={16} />إعادة المحاولة</button>}
  </div>;
}

function LoadingState() {
  return <div className="loading-state"><span className="spinner" />جارٍ تحميل البيانات...</div>;
}

function LoginScreen({ onLogin, notice = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice);
  const submit = async (event) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true); setError('');
    try {
      const user = await login(username.trim(), password);
      onLogin(user);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401
        ? 'اسم المستخدم أو كلمة المرور غير صحيحة.' : errorText(cause));
    } finally { setBusy(false); }
  };
  return <main className="login-layout">
    <section className="login-story">
      <div className="login-story-inner">
        <div className="story-mark"><MapPin size={26} fill="currentColor" /></div>
        <span className="eyebrow">من البلاغ إلى الحل</span>
        <h1>كل بلاغ خطوة<br /><em>لمدينة أفضل.</em></h1>
        <p>مساحة واحدة لمراجعة البلاغات وإسنادها ومتابعة تنفيذها ميدانيًا.</p>
        <div className="story-flow">
          <span><i>١</i>استلام البلاغ</span><b /><span><i>٢</i>المراجعة</span><b /><span><i>٣</i>المعالجة</span>
        </div>
        <div className="story-glow story-glow-one" /><div className="story-glow story-glow-two" />
      </div>
      <div className="story-footer">بلاغي · لوحة الموظف</div>
    </section>
    <section className="login-form-side">
      <div className="login-card">
        <Brand />
        <div className="login-heading"><span className="eyebrow">مرحبًا بعودتك</span><h2>تسجيل دخول الموظف</h2>
          <p>استخدم اسم المستخدم وكلمة المرور المخصصين لك.</p></div>
        <form onSubmit={submit}>
          <label htmlFor="staff-username">اسم المستخدم</label>
          <div className="input-wrap"><UserRound size={19} /><input id="staff-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="اسم المستخدم" required /></div>
          <label htmlFor="staff-password">كلمة المرور</label>
          <div className="input-wrap"><ShieldCheck size={19} /><input id="staff-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="أدخل كلمة المرور" required /></div>
          {error && <div className="form-error" role="alert"><CircleAlert size={17} />{error}</div>}
          <button className="button button-gold login-submit" type="submit" disabled={busy}>
            {busy ? <><span className="spinner spinner-dark" />جارٍ التحقق...</> : <>دخول إلى اللوحة<ArrowLeft size={18} /></>}
          </button>
        </form>
        <p className="login-note"><KeyRound size={16} />نسيت كلمة المرور؟ تواصل مع مسؤول النظام.</p>
        <p className="login-note"><ShieldCheck size={16} />هذه اللوحة مخصصة للموظفين المخوّلين فقط.</p>
      </div>
    </section>
  </main>;
}

function Sidebar({ page, setPage, user, onLogout, onPassword, closeMobile, open, queueCounts }) {
  const items = user.role === 'admin' ? [...navigation, ...allowedAdminPages(user)] : navigation;
  return <>
    {open && <button className="sidebar-scrim" aria-label="إغلاق القائمة" onClick={closeMobile} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-head"><Brand /><button className="icon-button sidebar-close" aria-label="إغلاق القائمة" onClick={closeMobile}><X size={19} /></button></div>
      <div className="sidebar-caption">مساحة العمل</div>
      <nav aria-label="أقسام لوحة الموظف">
        {items.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} aria-current={page === key ? 'page' : undefined}
          onClick={() => { setPage(key); closeMobile(); }}><Icon size={19} /><span>{label}</span>{queueCounts[key] > 0 && <b className="nav-count">{number(queueCounts[key])}</b>}{page === key && <span className="nav-active-dot" />}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-user"><span className="user-avatar"><UserRound size={20} /></span><span><strong>{user.full_name || user.staff_username}</strong><small>{user.role === 'admin' ? accountRoleName(user) : 'موظف مخوّل'}</small></span></div>
        <button className="nav-item" onClick={() => { onPassword(); closeMobile(); }}><KeyRound size={19} /><span>تغيير كلمة المرور</span></button>
        <button className="nav-item logout" onClick={onLogout}><LogOut size={19} /><span>تسجيل الخروج</span></button>
      </div>
    </aside>
  </>;
}

function PageHeading({ eyebrow, title, subtitle, action, onAction, onMenu }) {
  return <header className="page-heading">
    <div className="page-heading-copy"><button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div></div>
    {action && <button className="button button-quiet refresh-action" onClick={onAction}><RefreshCw size={17} />{action}</button>}
  </header>;
}

function ReportTable({ items, onOpen, compact = false }) {
  return <div className="table-scroll"><table className="report-table"><thead><tr><th>البلاغ</th><th>التصنيف</th><th>الموقع</th><th>تاريخ الإرسال</th><th>الحالة</th><th aria-label="عرض التفاصيل" /></tr></thead>
    <tbody>{items.map((report) => <tr key={report.id} onClick={() => onOpen(report.id)}>
      <td><div className="report-identity"><ReportThumbnail report={report} /><span><strong>بلاغ #{report.id}</strong><small>{report.reporter_name || 'مواطن'}</small></span></div></td>
      <td><span className="category-cell"><CategoryIcon category={report.category} size={16} />{categoryName(report.category)}</span></td>
      <td className="location-cell"><MapPin size={15} />{report.address_text || 'موقع محدد على الخريطة'}</td>
      <td className="date-cell">{fmtDate(report.created_at)}</td>
      <td><span className="status-stack"><StatusPill report={report} /><AcceptanceState report={report} /></span></td>
      <td><button className="table-open" aria-label={`عرض تفاصيل البلاغ ${report.id}`} onClick={(e) => { e.stopPropagation(); onOpen(report.id); }}><ArrowUpLeft size={17} /></button></td>
    </tr>)}</tbody></table>{compact && items.length === 0 && <EmptyState title="لا توجد بلاغات بانتظار المراجعة" detail="ستظهر البلاغات الجديدة هنا فور إرسالها." />}</div>;
}

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

function OverviewPage({ user, onOpen, onNavigate, refreshKey, onMenu }) {
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

function PendingReviewPage({ fieldReviewQueue = false, completionQueue = false, onOpen, refreshKey, onMenu }) {
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

function ReportsPage({ pendingOnly, onOpen, refreshKey, onMenu }) {
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

function StatsPage({ refreshKey, onMenu }) {
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

function MapPage({ onOpen, refreshKey, onMenu }) {
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

function LocationCorrectionPicker({ latitude, longitude, onChange }) {
  const container = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!container.current) return undefined;
    const initialLat = Number(latitude); const initialLng = Number(longitude);
    const point = [Number.isFinite(initialLat) ? initialLat : 32.88,
      Number.isFinite(initialLng) ? initialLng : 13.19];
    const instance = L.map(container.current).setView(point, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(instance);
    const pin = L.circleMarker(point, { radius: 10, color: '#fff', weight: 3,
      fillColor: '#c99313', fillOpacity: 1 }).addTo(instance);
    instance.on('click', (event) => change.current(
      event.latlng.lat.toFixed(6), event.latlng.lng.toFixed(6)
    ));
    map.current = instance; marker.current = pin;
    const timer = setTimeout(() => instance.invalidateSize(), 0);
    return () => { clearTimeout(timer); instance.remove(); map.current = null; marker.current = null; };
  }, []);
  useEffect(() => {
    const lat = Number(latitude); const lng = Number(longitude);
    if (marker.current && Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      marker.current.setLatLng([lat, lng]);
    }
  }, [latitude, longitude]);
  return <div className="field-review-map" ref={container} aria-label="اختر الموقع الصحيح بالضغط على الخريطة" />;
}

function DetailDrawer({ id, onClose, onUpdated, onToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [expandedImage, setExpandedImage] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [tick, setTick] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const detailMap = useRef(null);
  const mapContainer = useRef(null);
  useEffect(() => {
    let active = true;
    setData(null); setError('');
    staffApi.report(id).then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [id, tick]);
  useEffect(() => {
    if (data?.report) {
      setSelectedCategory(data.report.category);
      setLatitude(String(data.report.latitude));
      setLongitude(String(data.report.longitude));
    }
  }, [data]);
  useEffect(() => {
    if (!data?.report || !mapContainer.current || detailMap.current) return;
    const point = [Number(data.report.latitude), Number(data.report.longitude)];
    const instance = L.map(mapContainer.current, { zoomControl: false, dragging: false, scrollWheelZoom: false }).setView(point, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(instance);
    L.circleMarker(point, { radius: 10, color: '#fff', weight: 3, fillColor: '#126477', fillOpacity: 1 }).addTo(instance);
    detailMap.current = instance;
    return () => { instance.remove(); detailMap.current = null; };
  }, [data]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (expandedImage) setExpandedImage(null);
        else if (modal) setModal(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedImage, modal, onClose]);
  const report = data?.report;
  const pendingFieldIssue = data?.field_reviews?.find((item) => !item.decision);
  const pendingCompletion = data?.completions?.find((item) => !item.decision);
  const latestVerification = data?.verifications?.[0];
  const verificationOpen = Boolean(latestVerification && !latestVerification.result);
  const verificationNeedsLocation = latestVerification?.result === 'wrong_location' &&
    !latestVerification.corrected_at;
  const pending = report?.status === 'new' && !report?.approved_at;
  const approvedNew = report?.status === 'new' && Boolean(report?.approved_at);
  const inProgress = report?.status === 'in_progress';
  const timeline = report ? buildReportTimeline(report, data?.status_history, data?.field_reviews, {
    agencyName: agencies[report.assigned_agency] || 'جهة العمل المختصة',
    reasonNames: fieldIssueReasons,
  }, data?.completions) : [];
  const submitAction = async () => {
    if (!report || !modal || busy || (modal === 'reject' && (!reason.trim() || reason.trim().length > 500)) ||
        (modal === 'release' && !reason.trim()) ||
        (modal === 'completionReturn' && !reason.trim()) ||
        (modal === 'fieldReject' && !reason.trim()) ||
        (['fieldCorrect', 'verifyLocation'].includes(modal) && (!latitude.trim() || !longitude.trim())) ||
        (modal === 'verifyLocation' && Number(latitude) === Number(report.latitude) &&
          Number(longitude) === Number(report.longitude)) ||
        (modal === 'category' && (selectedCategory === report.category || verificationOpen)) ||
        (['approve', 'verifyRequest'].includes(modal) && selectedCategory !== report.category) ||
        (['verifyRequest', 'verifyCancel'].includes(modal) && !reason.trim())) return;
    setBusy(true); setError('');
    try {
      if (modal === 'approve') await staffApi.approve(id);
      else if (modal === 'category') await staffApi.correctCategory(id, selectedCategory);
      else if (modal === 'verifyRequest') await staffApi.requestVerification(id, reason.trim());
      else if (modal === 'verifyCancel') await staffApi.cancelVerification(id, reason.trim());
      else if (modal === 'verifyLocation') await staffApi.correctVerificationLocation(id, latitude.trim(), longitude.trim());
      else if (modal === 'reject') await staffApi.changeStatus(id, 'rejected', reason.trim());
      else if (modal === 'release') await staffApi.releaseReport(id, reason.trim());
      else if (modal === 'fieldContinue') await staffApi.reviewFieldIssue(id, { decision: 'continue', note: reason.trim() });
      else if (modal === 'fieldCorrect') await staffApi.reviewFieldIssue(id, {
        decision: 'correct_location', latitude: latitude.trim(), longitude: longitude.trim(), note: reason.trim(),
      });
      else if (modal === 'fieldReject') await staffApi.reviewFieldIssue(id, { decision: 'reject', note: reason.trim() });
      else if (modal === 'completionConfirm') await staffApi.reviewCompletion(id, 'confirmed');
      else if (modal === 'completionReturn') await staffApi.reviewCompletion(id, 'returned', reason.trim());
      setModal(null); setReason(''); onUpdated();
      onToast({ approve: 'تم اعتماد البلاغ ونشره وإسناده تلقائيًا إلى جهة العمل المختصة.', category: 'تم تصحيح تصنيف البلاغ.', verifyRequest: 'أُرسل طلب التحقق إلى جهة العمل وبقي البلاغ غير منشور.', verifyCancel: 'أُلغي طلب التحقق ويمكنك اتخاذ قرار بشأن البلاغ.', verifyLocation: 'تم تصحيح موقع البلاغ؛ راجعه قبل الاعتماد.', reject: 'تم رفض البلاغ وحفظ السبب.', release: 'أُعيد البلاغ إلى قائمة جهة العمل ليستلمه عامل آخر.', completionConfirm: 'تم تأكيد الحل وإغلاق البلاغ.', completionReturn: 'أُعيد البلاغ إلى جهة العمل مع سبب المراجعة.', fieldContinue: 'تمت مراجعة الملاحظة واستؤنف البلاغ.', fieldCorrect: 'تم تصحيح الموقع واستؤنف البلاغ.', fieldReject: 'تم رفض البلاغ بعد المراجعة الميدانية.' }[modal]);
      if (['approve', 'verifyRequest', 'fieldContinue', 'fieldCorrect', 'fieldReject', 'completionConfirm', 'completionReturn', 'release'].includes(modal)) onClose();
      else setTick((n) => n + 1);
    } catch (cause) { setError(errorText(cause)); setModal(null); setTick((n) => n + 1); }
    finally { setBusy(false); }
  };
  const image = imageUrl(report?.image_url);
  return <div className="drawer-layer"><button className="drawer-backdrop" aria-label="إغلاق التفاصيل" onClick={onClose} /><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={`تفاصيل البلاغ ${id}`}>
    <div className="drawer-head"><div><span className="eyebrow">{pending ? 'فحص البلاغ' : 'تفاصيل البلاغ'}</span><h2>بلاغ #{id}</h2></div><div className="drawer-head-actions"><button className="icon-button" aria-label="تحديث تفاصيل البلاغ" title="تحديث التفاصيل" onClick={() => setTick((value) => value + 1)}><RefreshCw size={19} /></button><button className="icon-button" aria-label="إغلاق التفاصيل" onClick={onClose}><X size={20} /></button></div></div>
    {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((n) => n + 1)}>تحديث</button></div>}
    {!report ? (error ? null : <LoadingState />) : <><div className="drawer-content">
      {report.assigned_worker_id && report.assigned_worker_active === false && ['new', 'in_progress'].includes(report.status) && <div className="inline-note" role="status">العامل الذي استلم هذا البلاغ ({report.assigned_worker_name || report.assigned_worker_username}) حسابه معطّل. أعد البلاغ إلى قائمة الجهة ليستلمه عامل آخر.</div>}
      <button className="detail-image" onClick={() => { if (image) { setExpandedImage(image); setZoom(1); } }} disabled={!image} aria-label="عرض صورة البلاغ كاملة">
        {image ? <img src={image} alt={`صورة البلاغ ${id}`} /> : <span><ImageIcon size={32} />لا توجد صورة متاحة</span>}
        {image && <span className="image-expand"><Eye size={16} />عرض الصورة كاملة</span>}
      </button>
      <div className="detail-title"><div><CategoryIcon category={report.category} size={22} /><div><h3>{categoryName(report.category)}</h3><span>{fmtDate(report.created_at)}</span></div></div><StatusPill report={report} /></div>
      <section className="detail-section"><h4>وصف المشكلة</h4><p>{report.description || 'لم يُضف وصف لهذا البلاغ.'}</p></section>
      {pending && <section className="detail-section"><h4>تصنيف البلاغ قبل الاعتماد</h4><label className="assignment-picker">نوع المشكلة<select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} disabled={verificationOpen}>{Object.entries(categories).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label><p>جهة العمل عند الاعتماد: <strong>{agencies[categoryAgency[selectedCategory]]}</strong></p><button className="button button-quiet" disabled={busy || verificationOpen || selectedCategory === report.category} onClick={() => setModal('category')}>حفظ التصنيف</button>{selectedCategory !== report.category && <small>احفظ التصنيف قبل اعتماد البلاغ أو طلب التحقق.</small>}{verificationOpen && <small>أكمل طلب التحقق أو ألغِه قبل تغيير التصنيف.</small>}</section>}
      <section className="detail-section"><h4>الموقع الجغرافي</h4><p className="detail-location"><MapPin size={16} />{report.address_text || 'الموقع محدد بالإحداثيات'}</p><div className="detail-map" ref={mapContainer} /><small className="coordinates">{Number(report.latitude).toFixed(6)}، {Number(report.longitude).toFixed(6)}</small><a className="button button-quiet location-google-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(report.latitude)},${Number(report.longitude)}`)}`} target="_blank" rel="noopener noreferrer"><MapPinned size={16} />فتح الموقع في Google Maps</a></section>
      <section className="detail-section"><h4>مقدم البلاغ <span className="private-tag">للموظف فقط</span></h4><div className="info-grid"><div><small>الاسم</small><strong>{report.reporter_name || 'غير محدد'}</strong></div><div><small>رقم الهاتف</small><strong dir="ltr">{report.reporter_phone || '—'}</strong></div></div></section>
      {latestVerification && <section className="detail-section verification-summary"><h4>التحقق الميداني قبل الاعتماد</h4><p>جهة التحقق: <strong>{agencyTeams[latestVerification.agency] || agencies[latestVerification.agency]}</strong></p><p>سبب الطلب: {latestVerification.request_note}</p><small>أُرسل الطلب: {fmtDate(latestVerification.requested_at)}</small><p><strong>{verificationOpen ? (latestVerification.claimed_at ? 'استلم الفريق المهمة، بانتظار النتيجة' : 'بانتظار استلام جهة العمل') : verificationResults[latestVerification.result]}</strong></p>{latestVerification.result_note && <p>ملاحظة النتيجة: {latestVerification.result_note}</p>}{latestVerification.completed_at && <small>وقت الرد: {fmtDate(latestVerification.completed_at)}</small>}</section>}
      {latestVerification?.corrected_at && <section className="detail-section verification-summary"><h4>تصحيح الموقع قبل النشر</h4><p>صحح الموظف موقع البلاغ بعد رد جهة العمل.</p><small>{fmtDate(latestVerification.corrected_at)}</small></section>}
      {pendingFieldIssue && <section className="detail-section field-issue-highlight"><h4>ملاحظة الفريق · تحتاج قرارًا</h4><p><strong>{fieldIssueReasons[pendingFieldIssue.reason]}</strong> · {agencyTeams[report.assigned_agency] || 'فريق جهة العمل'}</p><p>{pendingFieldIssue.note}</p><small>{fmtDate(pendingFieldIssue.raised_at)}</small></section>}
      {pendingCompletion && <section className="detail-section completion-review-highlight"><h4>إنجاز العمل · بانتظار تأكيدك</h4><p>أبلغ {pendingCompletion.worker_name || pendingCompletion.worker_username || 'العامل الميداني'} بإتمام العمل.</p>{pendingCompletion.note && <p>وصف العمل: {pendingCompletion.note}</p>}<small>وقت الإرسال: {fmtDate(pendingCompletion.submitted_at)}</small></section>}
      {data.completions?.some((item) => item.after_image_url) && <section className="detail-section completion-evidence"><h4>صور الإصلاح للمراجعة</h4><div className="completion-photo-compare"><div><strong>قبل الإصلاح · صورة البلاغ</strong><button type="button" onClick={() => { setExpandedImage(image); setZoom(1); }}><img src={image} alt="صورة المشكلة قبل الإصلاح" /></button></div>{data.completions.filter((item) => item.after_image_url).map((item) => <div key={item.id}><strong>بعد الإصلاح · {item.decision === 'confirmed' ? 'مؤكد' : item.decision === 'returned' ? 'أُعيد للعمل' : 'بانتظار القرار'}</strong><button type="button" onClick={() => { setExpandedImage(imageUrl(item.after_image_url)); setZoom(1); }}><img src={imageUrl(item.after_image_url)} alt={`صورة الإصلاح المرسلة في ${fmtDate(item.submitted_at)}`} /></button><small>أُرسلت: {fmtDate(item.submitted_at)}</small>{item.photo_latitude !== null && item.photo_longitude !== null ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.photo_latitude},${item.photo_longitude}`)}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} />موقع الجهاز عند التصوير{item.photo_accuracy_m !== null ? ` · دقة تقريبية ${Math.round(Number(item.photo_accuracy_m))} م` : ''}</a> : <small>لم يتوفر موقع الجهاز عند التصوير.</small>}</div>)}</div><p className="completion-evidence-hint">قارن الصورتين والموقع قبل تأكيد الحل؛ الصورة وحدها لا تثبت اكتمال العمل.</p></section>}
      {report.approved_at && report.status !== 'rejected' && <section className="detail-section"><h4>إسناد البلاغ <span className="private-tag">للموظف فقط</span></h4>
        {report.assigned_agency ? <p>جهة العمل: <strong>{agencies[report.assigned_agency] || report.assigned_agency}</strong><br />الفريق المسؤول: <strong>{agencyTeams[report.assigned_agency] || 'فريق جهة العمل'}</strong> · {report.assigned_worker_id ? (report.work_started_at ? 'بدأ العمل' : 'تم استلام البلاغ') : 'بانتظار الاستلام'}</p> : <p>لم تُحدّد جهة عمل لهذا البلاغ القديم.</p>}
        {report.assigned_at && <small className="assignment-time">تاريخ الإسناد: {fmtDate(report.assigned_at)}</small>}
      </section>}
      {report.status === 'rejected' && <section className="detail-section rejection-reason"><h4>سبب الرفض</h4><p>{report.rejection_reason || 'لم يُسجل سبب.'}</p></section>}
      <section className="detail-section"><h4>سجل المتابعة</h4><div className="timeline">{timeline.map((event) => <div className="timeline-item" key={event.key}><i /><span><strong>{event.title}</strong><small>{fmtDate(event.at)}{event.actor ? ` · ${event.actor}` : ''}</small>{event.detail && <em>{event.detail}</em>}</span></div>)}</div></section>
    </div>
      {(pending || approvedNew || inProgress) && <div className={`drawer-actions ${pendingFieldIssue ? 'field-review-actions' : ''}`}>
        {pendingFieldIssue ? <><button className="button button-gold" onClick={() => setModal('fieldContinue')}><Check size={18} />متابعة البلاغ</button><button className="button button-quiet" onClick={() => setModal('fieldCorrect')}><MapPin size={18} />تصحيح الموقع</button><button className="button button-danger-quiet" onClick={() => setModal('fieldReject')}>رفض البلاغ</button></> : <>
          {pending && (verificationOpen ? <button className="button button-quiet" onClick={() => { setReason(''); setModal('verifyCancel'); }}><X size={18} />إلغاء طلب التحقق</button> : <><button className="button button-gold" disabled={verificationNeedsLocation || selectedCategory !== report.category} onClick={() => setModal('approve')}><Check size={18} />اعتماد البلاغ ونشره</button>{verificationNeedsLocation && <button className="button button-quiet" onClick={() => setModal('verifyLocation')}><MapPin size={18} />تصحيح الموقع قبل النشر</button>}<button className="button button-quiet" disabled={selectedCategory !== report.category} onClick={() => { setReason(''); setModal('verifyRequest'); }}><MapPin size={18} />طلب تحقق ميداني</button><button className="button button-danger-quiet" onClick={() => setModal('reject')}>رفض البلاغ</button></>)}
          {approvedNew && <>{report.assigned_worker_id && !pendingFieldIssue && <button className="button button-quiet" onClick={() => { setReason(''); setModal('release'); }}><RotateCcw size={18} />إعادة إلى قائمة الجهة</button>}<button className="button button-danger-quiet" onClick={() => setModal('reject')}>رفض البلاغ</button></>}
          {inProgress && (pendingCompletion ? <><button className="button button-gold" onClick={() => setModal('completionConfirm')}><CheckCheck size={18} />تأكيد الحل</button><button className="button button-quiet" onClick={() => { setReason(''); setModal('completionReturn'); }}><Clock3 size={18} />إعادته للعمل</button></> : <>{!pendingFieldIssue && <button className="button button-quiet" onClick={() => { setReason(''); setModal('release'); }}><RotateCcw size={18} />إعادة إلى قائمة الجهة</button>}<button className="button button-danger-quiet" onClick={() => setModal('reject')}>رفض البلاغ</button></>)}
        </>}
      </div>}
    </>}
  </aside>
    {modal && <div className="modal-layer"><button className="modal-backdrop" aria-label="إلغاء الإجراء" onClick={() => !busy && setModal(null)} /><div className="confirm-modal" role="dialog" aria-modal="true" aria-label="تأكيد الإجراء">
      <span className={`modal-icon ${['reject', 'fieldReject'].includes(modal) ? 'danger' : ''}`}>{['reject', 'fieldReject'].includes(modal) ? <CircleAlert size={25} /> : <ShieldCheck size={25} />}</span>
      <h3>{{ approve: 'اعتماد هذا البلاغ؟', verifyRequest: 'طلب تحقق ميداني قبل النشر؟', verifyCancel: 'إلغاء طلب التحقق؟', verifyLocation: 'تصحيح موقع البلاغ قبل النشر', category: 'تصحيح تصنيف البلاغ؟', reject: 'رفض هذا البلاغ؟', release: 'إعادة البلاغ إلى قائمة جهة العمل؟', completionConfirm: 'تأكيد حل البلاغ؟', completionReturn: 'إعادة البلاغ للعمل؟', fieldContinue: 'متابعة البلاغ؟', fieldCorrect: 'تصحيح موقع البلاغ؟', fieldReject: 'رفض البلاغ بعد المراجعة؟' }[modal]}</h3>
      <p>{{ approve: `سيظهر البلاغ للمواطنين بحالة «جديد»، ويُسند تلقائيًا إلى ${agencies[categoryAgency[report?.category]] || 'جهة العمل المختصة'}.`, verifyRequest: `سيصل طلب التحقق إلى ${agencies[categoryAgency[report?.category]] || 'جهة العمل المختصة'}، ويبقى البلاغ غير منشور حتى تقرر اعتماده أو رفضه.`, verifyCancel: 'سيُغلق طلب التحقق المفتوح، ويمكنك اتخاذ قرار بشأن البلاغ أو إرسال طلب جديد.', category: 'سيُستخدم التصنيف الصحيح لتحديد جهة العمل عند الاعتماد وطلب التحقق الميداني.', reject: report?.approved_at ? 'سيُزال البلاغ من الخريطة العامة، وسيظهر سبب الرفض لصاحبه.' : 'لن يظهر البلاغ على الخريطة العامة، وسيظهر سبب الرفض لصاحبه.', release: report?.status === 'in_progress' ? 'سيُفك البلاغ عن عامله الحالي ويعود إلى قائمة الجهة، وتعود حالته للمواطن «جديد» حتى يبدأ عامل آخر العمل.' : 'سيُفك البلاغ عن عامله الحالي ويعود إلى قائمة الجهة ليستلمه عامل آخر.', completionConfirm: 'راجِع ما أرسله العامل. عند التأكيد ستظهر الحالة للمواطن «تم الحل».', completionReturn: 'سيبقى البلاغ «قيد المعالجة» ويعود للعامل لاستكمال العمل. اكتب سببًا واضحًا.', fieldContinue: 'ستنتهي المراجعة ويعود البلاغ إلى الخريطة والعامل الحالي.', fieldCorrect: 'احرص على إدخال إحداثيات الموقع الصحيح. سيعود البلاغ للعامل الحالي بحالته السابقة.', fieldReject: 'سيُزال البلاغ من الخريطة، وسيظهر سبب الرفض لصاحبه.' }[modal]}</p>
      {['fieldCorrect', 'verifyLocation'].includes(modal) && <><p>اضغط على الموقع الصحيح في الخريطة، أو عدّل الإحداثيات يدويًا. يجب أن يكون داخل نطاق طرابلس المركز.</p><LocationCorrectionPicker latitude={latitude} longitude={longitude} onChange={(lat, lng) => { setLatitude(lat); setLongitude(lng); }} /><div className="field-review-coordinates"><label>خط العرض<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label><label>خط الطول<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label></div></>}
      {['reject', 'fieldReject', 'fieldContinue', 'fieldCorrect', 'verifyRequest', 'verifyCancel', 'completionReturn', 'release'].includes(modal) && <label className="reason-label">{['reject', 'fieldReject'].includes(modal) ? 'سبب الرفض' : modal === 'release' ? 'سبب الإعادة' : modal === 'verifyRequest' ? 'سبب طلب التحقق' : modal === 'verifyCancel' ? 'سبب إلغاء الطلب' : modal === 'completionReturn' ? 'سبب إعادة العمل' : 'ملاحظة القرار'} {['reject', 'fieldReject', 'verifyRequest', 'verifyCancel', 'completionReturn', 'release'].includes(modal) && <span>إلزامي</span>}<textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={['reject', 'fieldReject'].includes(modal) ? 'اكتب سببًا واضحًا يفهمه مقدم البلاغ' : modal === 'verifyRequest' ? 'ما الذي يحتاج إلى فحص في الموقع؟' : modal === 'verifyCancel' ? 'لماذا أُلغي طلب التحقق؟' : modal === 'completionReturn' ? 'ما الذي يحتاج إلى استكمال؟' : modal === 'release' ? 'مثل: العامل أنهى عقده أو في إجازة' : 'ملاحظة اختيارية للمتابعة الداخلية'} rows={4} /><small>{reason.length}/500</small></label>}
      <div className="modal-actions"><button className={`button ${['reject', 'fieldReject'].includes(modal) ? 'button-danger' : 'button-gold'}`} disabled={busy || (['reject', 'fieldReject', 'verifyRequest', 'verifyCancel', 'completionReturn', 'release'].includes(modal) && !reason.trim()) || (['fieldCorrect', 'verifyLocation'].includes(modal) && (!latitude.trim() || !longitude.trim())) || (modal === 'verifyLocation' && Number(latitude) === Number(report.latitude) && Number(longitude) === Number(report.longitude))} onClick={submitAction}>{busy ? 'جارٍ الحفظ...' : { approve: 'اعتماد البلاغ ونشره بحالة جديد', verifyRequest: 'إرسال طلب التحقق', verifyCancel: 'تأكيد إلغاء الطلب', verifyLocation: 'حفظ الموقع المصحح', category: 'حفظ التصنيف', reject: 'تأكيد الرفض', completionConfirm: 'تأكيد الحل', completionReturn: 'إعادته للعمل', release: 'إعادة إلى قائمة الجهة', fieldContinue: 'متابعة البلاغ', fieldCorrect: 'تأكيد تصحيح الموقع', fieldReject: 'تأكيد الرفض' }[modal]}</button><button className="button button-quiet" disabled={busy} onClick={() => setModal(null)}>إلغاء</button></div>
    </div></div>}
    {expandedImage && <div className="image-modal" role="dialog" aria-modal="true" aria-label="عرض الصورة كاملة"><button className="image-modal-close" onClick={() => setExpandedImage(null)} aria-label="إغلاق الصورة"><X size={22} /></button><div className="image-modal-stage"><img src={expandedImage} alt={`صورة البلاغ ${id}`} style={{ transform: `scale(${zoom})` }} /></div><div className="image-zoom-controls"><button onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>−</button><span>{zoom.toFixed(1)}×</span><button onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>+</button></div></div>}
  </div>;
}

function FieldVerificationQueue() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fieldApi.verifications({ page })
      .then((result) => {
        if (!active) return;
        if (page > Math.max(result.total_pages, 1)) {
          setPage(Math.max(result.total_pages, 1));
          return;
        }
        setItems(result.items); setTotalPages(result.total_pages || 1); setError('');
      })
      .catch((cause) => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, tick]);
  useEffect(() => {
    if (!preview) return undefined;
    const close = (event) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [preview]);
  const act = async (item, action) => {
    const draft = drafts[item.id] || {};
    if (action === 'respond' && (!draft.result || !draft.note?.trim())) return;
    setBusyId(item.id); setError(''); setNotice('');
    try {
      if (action === 'claim') await fieldApi.claimVerification(item.id);
      else await fieldApi.respondVerification(item.id, draft.result, draft.note.trim());
      setNotice(action === 'claim' ? 'استلمت مهمة التحقق. افحص الموقع ثم أرسل النتيجة.' : 'وصلت نتيجة التحقق إلى الموظف. البلاغ ما زال غير منشور حتى يقرر بشأنه.');
      setTick((value) => value + 1);
    } catch (cause) { setError(errorText(cause)); setTick((value) => value + 1); }
    finally { setBusyId(null); }
  };
  return <section className="verification-queue" aria-label="طلبات التحقق قبل الاعتماد">
    <p className="verification-hint">هذه البلاغات غير منشورة. افحص المشكلة في الموقع، ثم أرسل النتيجة للموظف. التحقق لا يعني بدء أعمال الإصلاح.</p>
    {notice && <div className="field-notice" role="status"><Check size={17} />{notice}</div>}
    {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((value) => value + 1)}>إعادة المحاولة</button></div>}
    {loading ? <LoadingState /> : items.length === 0 ? <EmptyState icon={ShieldCheck} title="لا توجد طلبات تحقق حاليًا" detail="ستظهر هنا البلاغات التي يحيلها الموظف إلى جهة عملك قبل اعتمادها." /> : <div className="verification-grid">{items.map((item) => <article className="panel verification-card" key={item.verification_id}>
      <div className="verification-card-head"><div><span className="eyebrow">طلب تحقق · بلاغ #{item.id}</span><h2>{categoryName(item.category)}</h2></div><small>{fmtDate(item.requested_at)}</small></div>
      {imageUrl(item.image_url) && <button className="verification-photo" onClick={() => setPreview(item)} aria-label={`عرض صورة البلاغ ${item.id} كاملة`}><img src={imageUrl(item.image_url)} alt={`صورة البلاغ ${item.id}`} /></button>}
      <p><strong>وصف البلاغ:</strong> {item.description || 'لا يوجد وصف إضافي.'}</p>
      <p className="verification-request-note"><strong>سبب طلب التحقق:</strong> {item.request_note}</p>
      <a className="button button-quiet verification-map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(item.latitude)},${Number(item.longitude)}`)}`} target="_blank" rel="noopener noreferrer"><MapPin size={17} />فتح موقع المشكلة</a>
      {!item.claimed_by ? <button className="button button-gold" disabled={busyId === item.id} onClick={() => act(item, 'claim')}>استلام مهمة التحقق</button> : <div className="verification-response"><label>نتيجة التحقق<select value={drafts[item.id]?.result || ''} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], result: event.target.value } }))}><option value="">اختر النتيجة</option>{Object.entries(verificationResults).filter(([key]) => key !== 'cancelled').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>ملاحظتك للموظف<textarea value={drafts[item.id]?.note || ''} maxLength={500} rows={3} placeholder="اكتب ما تحققت منه في الموقع" onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], note: event.target.value } }))} /></label><button className="button button-gold" disabled={busyId === item.id || !drafts[item.id]?.result || !drafts[item.id]?.note?.trim()} onClick={() => act(item, 'respond')}>{busyId === item.id ? 'جارٍ الإرسال...' : 'إرسال النتيجة للموظف'}</button></div>}
    </article>)}</div>}
    {totalPages > 1 && <div className="field-pages"><button className="button button-quiet" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span>{number(page)} / {number(totalPages)}</span><button className="button button-quiet" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</button></div>}
    {preview && <div className="image-modal" role="dialog" aria-modal="true" aria-label={`صورة البلاغ ${preview.id} كاملة`}><button className="image-modal-close" onClick={() => setPreview(null)} aria-label="إغلاق الصورة"><X size={22} /></button><div className="image-modal-stage"><img src={imageUrl(preview.image_url)} alt={`صورة البلاغ ${preview.id} كاملة`} /></div></div>}
  </section>;
}

function FieldWorkerPage({ user, onLogout, onPassword }) {
  const [tab, setTab] = useState('reports');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [issueId, setIssueId] = useState(null);
  const [issueReason, setIssueReason] = useState('');
  const [issueNote, setIssueNote] = useState('');
  const [issueError, setIssueError] = useState('');
  const [completionId, setCompletionId] = useState(null);
  const [completionNote, setCompletionNote] = useState('');
  const [completionPhoto, setCompletionPhoto] = useState(null);
  const [completionPreview, setCompletionPreview] = useState('');
  const [completionLocation, setCompletionLocation] = useState(null);
  const [completionLocationState, setCompletionLocationState] = useState('idle');
  const [completionError, setCompletionError] = useState('');
  const locationRequest = useRef(0);
  const [detailsId, setDetailsId] = useState(null);
  const [imageId, setImageId] = useState(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fieldApi.assigned({ page, view: tab === 'resolved' ? 'resolved' : 'active' })
      .then((result) => { if (active) {
        if (page > Math.max(result.total_pages, 1)) { setPage(Math.max(result.total_pages, 1)); return; }
        setItems(result.items); setTotalPages(result.total_pages || 1); setError('');
      } })
      .catch((cause) => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, tab, tick]);
  useEffect(() => {
    if (!completionPhoto) { setCompletionPreview(''); return undefined; }
    const url = URL.createObjectURL(completionPhoto);
    setCompletionPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [completionPhoto]);
  const closeCompletion = () => {
    locationRequest.current += 1;
    setCompletionId(null); setCompletionPhoto(null); setCompletionNote('');
    setCompletionLocation(null); setCompletionLocationState('idle'); setCompletionError('');
  };
  const captureCompletionPhoto = (photo) => {
    if (photo.size > 5 * 1024 * 1024) {
      setCompletionError('حجم الصورة أكبر من 5 ميغابايت. أعد التقاطها.');
      return;
    }
    setCompletionPhoto(photo); setCompletionError(''); setCompletionLocation(null);
    const requestId = ++locationRequest.current;
    if (!navigator.geolocation) {
      setCompletionLocationState('unavailable');
      return;
    }
    setCompletionLocationState('checking');
    navigator.geolocation.getCurrentPosition((position) => {
      if (locationRequest.current !== requestId) return;
      setCompletionLocation({ latitude: position.coords.latitude,
        longitude: position.coords.longitude, accuracy: position.coords.accuracy });
      setCompletionLocationState('ready');
    }, () => {
      if (locationRequest.current === requestId) setCompletionLocationState('unavailable');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  };
  const perform = async (id, action) => {
    setBusyId(id); setError(''); setNotice('');
    try {
      if (action === 'accept') await fieldApi.accept(id);
      else await fieldApi.start(id);
      setNotice(action === 'accept' ? 'تم استلام البلاغ. اضغط «بدأنا العمل» عند بدء العمل فعليًا.' : 'تم تأكيد بدء العمل وأصبح البلاغ قيد المعالجة.');
      setConfirmId(null); setTick((value) => value + 1);
    } catch (cause) { setError(errorText(cause)); setConfirmId(null); setTick((value) => value + 1); }
    finally { setBusyId(null); }
  };
  const submitIssue = async () => {
    if (!issueId || !issueReason || !issueNote.trim() || busyId) return;
    setBusyId(issueId); setIssueError(''); setError(''); setNotice('');
    try {
      await fieldApi.reportIssue(issueId, issueReason, issueNote.trim());
      setNotice('أُرسلت ملاحظتك إلى الموظف المختص. أُوقف البلاغ مؤقتًا حتى يراجعه.');
      setItems((current) => current.filter((report) => report.id !== issueId));
      setIssueId(null); setDetailsId(null); setIssueReason(''); setIssueNote('');
      setTick((value) => value + 1);
    } catch (cause) { setIssueError(errorText(cause)); }
    finally { setBusyId(null); }
  };
  const submitCompletion = async () => {
    if (!completionId || !completionPhoto || completionLocationState === 'checking' || busyId) return;
    setBusyId(completionId); setCompletionError(''); setNotice('');
    try {
      await fieldApi.submitCompletion(completionId, completionNote.trim(),
        completionPhoto, completionLocation);
      setNotice('أُرسل إنجاز العمل إلى الموظف للمراجعة. ستظل الحالة «قيد المعالجة» حتى يؤكد الحل.');
      closeCompletion(); setDetailsId(null);
      setTick((value) => value + 1);
    } catch (cause) { setCompletionError(errorText(cause)); }
    finally { setBusyId(null); }
  };
  const detailsReport = items.find((report) => report.id === detailsId);
  const imageReport = items.find((report) => report.id === imageId);
  const openImage = (id) => { setImageZoom(1); setImageId(id); };
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (imageId !== null) setImageId(null);
      else if (issueId !== null && busyId === null) setIssueId(null);
      else if (completionId !== null && busyId === null) closeCompletion();
      else if (detailsId !== null) setDetailsId(null);
      else if (confirmId !== null && busyId === null) setConfirmId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [imageId, issueId, completionId, detailsId, confirmId, busyId]);
  return <main className="field-layout" dir="rtl"><header className="field-header"><Brand compact /><div><span>{user.full_name || user.staff_username}</span><button className="button button-quiet" onClick={onPassword} aria-label="تغيير كلمة المرور" title="تغيير كلمة المرور"><KeyRound size={16} /></button><button className="button button-quiet" onClick={onLogout}><LogOut size={16} />خروج</button></div></header>
    <div className="field-content"><div className="field-intro"><span className="eyebrow">مساحة العمل الميداني</span><h1>{tab === 'verifications' ? 'طلبات التحقق قبل الاعتماد' : tab === 'resolved' ? 'البلاغات المنتهية' : 'بلاغات جهة عملك'}</h1><p>{agencies[user.agency] || 'البلاغات المسندة إلى جهتك'} · {tab === 'verifications' ? 'هذه الطلبات تنتظر فحصًا ميدانيًا قبل قرار النشر.' : tab === 'resolved' ? 'البلاغات التي أكّد الموظف حلها بعد إنجازك للعمل.' : 'استلم البلاغ أولًا، ثم أكد بدء العمل عند وصولك وبدء المعالجة فعليًا. عندها تتغير حالة البلاغ للمواطن.'}</p>{tab !== 'verifications' && <button className="button button-quiet" onClick={() => setTick((value) => value + 1)}><RefreshCw size={16} />تحديث البلاغات</button>}</div>
      <div className="field-work-tabs" role="tablist" aria-label="مهام جهة العمل"><button role="tab" aria-selected={tab === 'reports'} className={`button ${tab === 'reports' ? 'button-gold' : 'button-quiet'}`} onClick={() => { setTab('reports'); setPage(1); }}>بلاغات العمل</button><button role="tab" aria-selected={tab === 'resolved'} className={`button ${tab === 'resolved' ? 'button-gold' : 'button-quiet'}`} onClick={() => { setTab('resolved'); setPage(1); }}>البلاغات المنتهية</button><button role="tab" aria-selected={tab === 'verifications'} className={`button ${tab === 'verifications' ? 'button-gold' : 'button-quiet'}`} onClick={() => { setTab('verifications'); setPage(1); }}>طلبات التحقق قبل الاعتماد</button></div>
      {tab === 'verifications' ? <FieldVerificationQueue /> : <>
      {notice && <div className="field-notice" role="status"><Check size={17} />{notice}</div>}
      {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setTick((value) => value + 1)}>إعادة المحاولة</button></div>}
      {loading ? <LoadingState /> : items.length === 0 ? <EmptyState icon={FolderOpen} title={tab === 'resolved' ? 'لا توجد بلاغات منتهية' : 'لا توجد بلاغات لدى جهة عملك'} detail={tab === 'resolved' ? 'ستظهر هنا البلاغات التي يؤكد الموظف حلها.' : 'ستظهر هنا البلاغات التي تُعتمد وتُسند تلقائيًا إلى جهتك.'} /> : <div className="field-grid">{items.map((report) => <article className="field-card" key={report.id}>
        {imageUrl(report.image_url) ? <button type="button" className="field-card-image field-card-image-open" onClick={() => openImage(report.id)} aria-label={`فتح صورة البلاغ ${report.id} بحجم كامل`}><img src={imageUrl(report.image_url)} alt={`صورة البلاغ ${report.id}`} /></button> : <div className="field-card-image"><CategoryIcon category={report.category} size={38} /></div>}
        <div className="field-card-content">
          <div className="field-card-actions">{report.field_issue_pending ? <span className="field-progress-label">بانتظار مراجعة الموظف</span> : <>{report.status === 'new' && (report.accepted_at ? <button type="button" className="button button-gold" disabled={busyId === report.id} onClick={() => setConfirmId(report.id)}><Clock3 size={17} />بدأنا العمل</button> : <button type="button" className="button button-gold" disabled={busyId === report.id} onClick={() => perform(report.id, 'accept')}><Check size={17} />استلام البلاغ</button>)}{report.status === 'in_progress' && (report.completion_pending ? <span className="field-progress-label">بانتظار تأكيد الموظف</span> : <button type="button" className="button button-gold" disabled={busyId === report.id} onClick={() => { closeCompletion(); setCompletionId(report.id); }}><CheckCheck size={17} />تم إنجاز العمل</button>)}</>}<button type="button" className="button button-quiet" onClick={() => setDetailsId(report.id)}><Eye size={17} />تفاصيل البلاغ</button></div>
          {report.field_issue_pending && <p className="field-return-note"><CircleAlert size={16} />ملاحظتك قيد مراجعة الموظف: {report.field_issue_note}</p>}
          {report.status !== 'resolved' && report.completion_return_note && <p className="field-return-note"><CircleAlert size={16} />أعاده الموظف للعمل: {report.completion_return_note}</p>}
        </div></article>)}</div>}
      {totalPages > 1 && <div className="field-pages"><button className="button button-quiet" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>السابق</button><span>{number(page)} / {number(totalPages)}</span><button className="button button-quiet" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</button></div>}
      </>}
    </div>
    {detailsReport && <div className="modal-layer"><button className="modal-backdrop" aria-label="إغلاق التفاصيل" onClick={() => setDetailsId(null)} /><section className="field-detail-modal" role="dialog" aria-modal="true" aria-label={`تفاصيل البلاغ ${detailsReport.id}`}><div className="field-detail-head"><div><span className="eyebrow">بلاغ #{detailsReport.id}</span><h2>{categoryName(detailsReport.category)}</h2></div><button className="field-detail-close" onClick={() => setDetailsId(null)} aria-label="إغلاق التفاصيل"><X size={20} /></button></div><StatusPill report={detailsReport} />{detailsReport.field_issue_pending && <p className="field-return-note"><CircleAlert size={16} />الملاحظة بانتظار قرار الموظف: {detailsReport.field_issue_note}</p>}<div className="field-detail-section"><h3>وصف المشكلة</h3><p>{detailsReport.description || 'لا يوجد وصف إضافي.'}</p></div><div className="field-detail-section"><h3>موقع المشكلة</h3><p>{detailsReport.address_text || 'لم يُضف عنوان نصي.'}</p><small dir="ltr">{Number(detailsReport.latitude).toFixed(6)}, {Number(detailsReport.longitude).toFixed(6)}</small><a className="button button-quiet" href={`https://www.google.com/maps/search/?api=1&query=${Number(detailsReport.latitude)},${Number(detailsReport.longitude)}`} target="_blank" rel="noreferrer"><MapPin size={16} />فتح الموقع على الخريطة</a></div><div className="field-detail-section"><h3>مواعيد البلاغ</h3><div className="field-detail-dates"><span>قُدّم البلاغ <strong>{fmtDate(detailsReport.created_at)}</strong></span><span>أُسند إلى جهة العمل <strong>{fmtDate(detailsReport.assigned_at)}</strong></span>{detailsReport.accepted_at && <span>استُلم البلاغ <strong>{fmtDate(detailsReport.accepted_at)}</strong></span>}{detailsReport.work_started_at && <span>بدأ العمل <strong>{fmtDate(detailsReport.work_started_at)}</strong></span>}</div></div>{['new', 'in_progress'].includes(detailsReport.status) && !detailsReport.completion_pending && !detailsReport.field_issue_pending && <button type="button" className="button button-danger-quiet field-issue-button" onClick={() => { setIssueReason(''); setIssueNote(''); setIssueError(''); setIssueId(detailsReport.id); }}><CircleAlert size={17} />الإبلاغ عن مشكلة في البلاغ</button>}</section></div>}
    {issueId && <div className="modal-layer field-issue-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && setIssueId(null)} /><section className="confirm-modal field-issue-modal" role="dialog" aria-modal="true" aria-label="الإبلاغ عن مشكلة"><span className="modal-icon danger"><CircleAlert size={25} /></span><h3>الإبلاغ عن مشكلة في البلاغ</h3><p>اختر السبب واكتب ما وجدته في الموقع. سيُحال البلاغ للموظف للمراجعة، ولن يُرفض تلقائيًا.</p><label>سبب الملاحظة<select value={issueReason} onChange={(e) => setIssueReason(e.target.value)}><option value="">اختر السبب</option>{Object.entries(fieldIssueReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>ملاحظتك للموظف<textarea value={issueNote} maxLength={500} onChange={(e) => setIssueNote(e.target.value)} rows={4} placeholder="اشرح المشكلة التي وجدتها بوضوح" /><small>{issueNote.length}/500</small></label>{issueError && <p className="completion-camera-error" role="alert">{issueError}</p>}<div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId) || !issueReason || !issueNote.trim()} onClick={submitIssue}>{busyId ? 'جارٍ الإرسال...' : 'إرسال الملاحظة للمراجعة'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={() => setIssueId(null)}>إلغاء</button></div></section></div>}
    {completionId && <div className="modal-layer field-issue-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && closeCompletion()} /><section className="confirm-modal field-issue-modal completion-modal" role="dialog" aria-modal="true" aria-label="إبلاغ الموظف بإنجاز العمل"><span className="modal-icon"><CheckCheck size={25} /></span><h3>توثيق إنجاز العمل</h3><p>التقط صورة بعد الإصلاح ليراها الموظف بجانب صورة البلاغ الأصلية. تبقى الحالة «قيد المعالجة» حتى يؤكد الحل.</p>{completionPhoto ? <div className="completion-captured"><img src={completionPreview} alt="صورة الإصلاح قبل الإرسال" /><button type="button" className="button button-quiet" disabled={Boolean(busyId)} onClick={() => { locationRequest.current += 1; setCompletionPhoto(null); setCompletionLocation(null); setCompletionLocationState('idle'); }}><RefreshCw size={16} />إعادة التصوير</button></div> : <CompletionCamera onCapture={captureCompletionPhoto} />}{completionPhoto && <p className="completion-location-state">{completionLocationState === 'checking' ? 'جارٍ تحديد موقع الجهاز...' : completionLocationState === 'ready' ? `سُجل موقع الجهاز بدقة تقريبية ${Math.round(completionLocation.accuracy)} م.` : 'تعذّر تحديد موقع الجهاز؛ سيظهر ذلك للموظف.'}</p>}<label>وصف العمل المنجز (اختياري)<textarea value={completionNote} maxLength={500} onChange={(event) => setCompletionNote(event.target.value)} rows={4} placeholder="اكتب ما أُنجز في الموقع إن أردت" /><small>{completionNote.length}/500</small></label>{completionError && <p className="completion-camera-error" role="alert">{completionError}</p>}<div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId) || !completionPhoto || completionLocationState === 'checking'} onClick={submitCompletion}>{busyId ? 'جارٍ الإرسال...' : 'إرسال الإنجاز للمراجعة'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={closeCompletion}>إلغاء</button></div></section></div>}
    {confirmId && <div className="modal-layer"><button className="modal-backdrop" aria-label="إلغاء" onClick={() => !busyId && setConfirmId(null)} /><div className="confirm-modal" role="dialog" aria-modal="true" aria-label="تأكيد بدء العمل"><span className="modal-icon"><Clock3 size={25} /></span><h3>هل بدأتم العمل فعليًا؟</h3><p>عند التأكيد ستظهر حالة البلاغ للمواطن «قيد المعالجة» وسيُسجل وقت البدء باسم حسابك.</p><div className="modal-actions"><button className="button button-gold" disabled={Boolean(busyId)} onClick={() => perform(confirmId, 'start')}>{busyId ? 'جارٍ الحفظ...' : 'نعم، بدأنا العمل'}</button><button className="button button-quiet" disabled={Boolean(busyId)} onClick={() => setConfirmId(null)}>إلغاء</button></div></div></div>}
    {imageReport && imageUrl(imageReport.image_url) && <div className="image-modal" role="dialog" aria-modal="true" aria-label={`صورة البلاغ ${imageReport.id} كاملة`}><button className="image-modal-close" onClick={() => setImageId(null)} aria-label="إغلاق الصورة"><X size={22} /></button><div className="image-modal-stage"><img src={imageUrl(imageReport.image_url)} alt={`صورة البلاغ ${imageReport.id} بحجم كامل`} style={{ transform: `scale(${imageZoom})` }} /></div><div className="image-zoom-controls"><button onClick={() => setImageZoom((zoom) => Math.max(1, zoom - 0.5))} aria-label="تصغير الصورة">−</button><span>{imageZoom.toFixed(1)}×</span><button onClick={() => setImageZoom((zoom) => Math.min(4, zoom + 0.5))} aria-label="تكبير الصورة">+</button></div></div>}
  </main>;
}

const agencyNames = {
  public_services: 'شركة الخدمات العامة',
  water_sewer: 'الشركة العامة للمياه والصرف الصحي',
  roads_maintenance: 'مكتب الطرق والصيانة',
};
const localPhone = (phone) => (phone?.startsWith('+218') ? `0${phone.slice(4)}` : phone || '—');

function PasswordForm({ forced = false, onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (next.length < 10) { setError('كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل.'); return; }
    if (next !== confirm) { setError('تأكيد كلمة المرور لا يطابق كلمة المرور الجديدة.'); return; }
    if (next === current) { setError('اختر كلمة مرور مختلفة عن الحالية.'); return; }
    setBusy(true); setError('');
    try { onDone(await changePassword(current, next)); }
    catch (cause) { setError(errorText(cause)); setBusy(false); }
  };
  return <form className="password-form" onSubmit={submit}>
    <label htmlFor="password-current">{forced ? 'كلمة المرور المؤقتة' : 'كلمة المرور الحالية'}</label>
    <div className="input-wrap"><KeyRound size={19} /><input id="password-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></div>
    <label htmlFor="password-new">كلمة المرور الجديدة</label>
    <div className="input-wrap"><ShieldCheck size={19} /><input id="password-new" type="password" autoComplete="new-password" minLength={10} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} required /></div>
    <label htmlFor="password-confirm">تأكيد كلمة المرور الجديدة</label>
    <div className="input-wrap"><ShieldCheck size={19} /><input id="password-confirm" type="password" autoComplete="new-password" maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
    <small className="password-hint">10 أحرف على الأقل. لا يطّلع عليها مسؤول النظام، وتُغلق جلساتك على الأجهزة الأخرى بعد الحفظ.</small>
    {error && <div className="form-error" role="alert"><CircleAlert size={17} />{error}</div>}
    <div className="modal-actions">
      <button className="button button-gold" type="submit" disabled={busy || !current || !next || !confirm}>{busy ? <><span className="spinner spinner-dark" />جارٍ الحفظ...</> : 'حفظ كلمة المرور'}</button>
      {onCancel && <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>إلغاء</button>}
    </div>
  </form>;
}

function ForcedPasswordScreen({ user, onDone, onLogout }) {
  return <main className="login-layout login-single">
    <section className="login-form-side"><div className="login-card">
      <Brand />
      <div className="login-heading"><span className="eyebrow">خطوة مطلوبة قبل المتابعة</span><h2>اختر كلمة مرور جديدة</h2>
        <p>مرحبًا {user.full_name || user.staff_username}. تستخدم الآن كلمة مرور مؤقتة سلّمها لك مسؤول النظام؛ اختر كلمة مرور خاصة بك لتفتح اللوحة.</p></div>
      <PasswordForm forced onDone={onDone} />
      <button className="text-link forced-logout" onClick={onLogout}><LogOut size={15} />تسجيل الخروج</button>
    </div></section>
  </main>;
}

function ModalShell({ label, icon: Icon, danger = false, onClose, children }) {
  return <div className="modal-layer"><button className="modal-backdrop" aria-label="إغلاق" onClick={onClose} />
    <div className="confirm-modal admin-modal" role="dialog" aria-modal="true" aria-label={label}>
      <div className={`modal-icon ${danger ? 'danger' : ''}`}><Icon size={22} /></div>{children}
    </div></div>;
}

function PasswordModal({ onClose, onDone }) {
  return <ModalShell label="تغيير كلمة المرور" icon={KeyRound} onClose={onClose}>
    <h3>تغيير كلمة المرور</h3><p>أدخل كلمة مرورك الحالية ثم اختر كلمة جديدة.</p>
    <PasswordForm onDone={onDone} onCancel={onClose} />
  </ModalShell>;
}

function TemporaryPasswordModal({ title, username, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(password).then(() => setCopied(true)).catch(() => {});
  return <ModalShell label={title} icon={KeyRound} onClose={onClose}>
    <h3>{title}</h3>
    <p>سلّم كلمة المرور المؤقتة لصاحب الحساب مباشرة. لن تظهر مرة أخرى، وسيُطلب منه تغييرها عند أول دخول، فلن تعرف كلمة مروره النهائية.</p>
    <div className="temp-password">
      <span>اسم المستخدم</span><strong dir="ltr">{username}</strong>
      <span>كلمة المرور المؤقتة</span><code dir="ltr">{password}</code>
    </div>
    <div className="modal-actions">
      <button className="button button-gold" onClick={onClose}>تم، أغلق</button>
      {navigator.clipboard && <button className="button button-quiet" onClick={copy}><Copy size={16} />{copied ? 'نُسخت' : 'نسخ'}</button>}
    </div>
  </ModalShell>;
}

function Pagination({ result, page, setPage }) {
  return <div className="pagination"><span>صفحة {number(result.page)} من {number(Math.max(result.total_pages, 1))}</span><div>
    <button className="icon-button" aria-label="الصفحة السابقة" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronRight size={18} /></button>
    <button className="icon-button" aria-label="الصفحة التالية" disabled={page >= result.total_pages} onClick={() => setPage(page + 1)}><ChevronLeft size={18} /></button>
  </div></div>;
}

// Loads one page of an admin list and reloads when filters, page or tick change.
function usePagedList(load, filters, tick) {
  const [state, setState] = useState({ result: null, loading: true, error: '' });
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    load(filters).then((result) => { if (active) setState({ result, loading: false, error: '' }); })
      .catch((cause) => { if (active) setState({ result: null, loading: false, error: errorText(cause) }); });
    return () => { active = false; };
  }, [JSON.stringify(filters), tick]);
  return state;
}

function AccountStatus({ account }) {
  return <span className="account-status">
    <span className={`status-pill ${account.is_active ? 'resolved' : 'rejected'}`}><i />{account.is_active ? 'نشط' : 'معطّل'}</span>
    {account.is_active && account.must_change_password && <small className="account-flag">بانتظار تغيير كلمة المرور</small>}
    {!account.is_active && account.deactivated_reason && <small className="account-reason">{account.deactivated_reason}</small>}
  </span>;
}

function AccountsPage({ user, onMenu, onToast }) {
  const empty = { role: '', status: '', search: '', page: 1 };
  const [filters, setFilters] = useState(empty);
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null);
  const roles = manageableRoles(user);
  const blankForm = { full_name: '', username: '', role: roles[0], agency: '', admin_permissions: [] };
  const [form, setForm] = useState(blankForm);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const { result, loading, error } = usePagedList(adminApi.users, filters, tick);
  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const open = (type, account = null) => {
    setModal({ type, account }); setFormError(''); setReason('');
    setForm(account ? { full_name: account.full_name || '', username: account.staff_username,
      role: account.role, agency: account.agency || '',
      admin_permissions: account.admin_permissions || [] } : blankForm);
  };
  const close = () => { if (!busy) setModal(null); };
  const releasedNote = (released) => {
    if (!released) return '';
    const parts = [];
    if (released.released_reports.length) parts.push(`أُعيد ${number(released.released_reports.length)} بلاغ لم يبدأ العمل عليه إلى قائمة الجهة`);
    if (released.released_verifications) parts.push(`وأُعيد ${number(released.released_verifications)} طلب تحقق`);
    if (released.in_progress_reports) parts.push(`تنبيه: ما زال ${number(released.in_progress_reports)} بلاغ قيد المعالجة باسم هذا العامل؛ أعده من تفاصيل البلاغ إلى قائمة الجهة`);
    return parts.join('. ');
  };
  const submit = async () => {
    if (busy || !modal) return;
    const { type, account } = modal;
    if (['create', 'edit'].includes(type)) {
      if (!form.full_name.trim()) { setFormError('اكتب الاسم الكامل.'); return; }
      if (form.role === 'field_worker' && !form.agency) { setFormError('اختر جهة العمل للعامل الميداني.'); return; }
    }
    setBusy(true); setFormError('');
    try {
      const agency = form.role === 'field_worker' ? form.agency : null;
      if (type === 'create') {
        const created = await adminApi.createUser({ full_name: form.full_name.trim(),
          username: form.username.trim().toLowerCase(), role: form.role, agency,
          ...(form.role === 'admin' ? { admin_permissions: form.admin_permissions } : {}) });
        setModal({ type: 'password', title: 'تم إنشاء الحساب', username: created.user.staff_username,
          password: created.temporary_password });
      } else if (type === 'edit') {
        const body = { full_name: form.full_name.trim() };
        if (account.id !== user.id && !account.is_owner) {
          Object.assign(body, { role: form.role, agency });
          if (form.role === 'admin') body.admin_permissions = form.admin_permissions;
        }
        const updated = await adminApi.updateUser(account.id, body);
        setNotice(releasedNote(updated.released)); setModal(null); onToast('تم حفظ بيانات الحساب.');
      } else if (type === 'status') {
        const updated = await adminApi.setUserActive(account.id, !account.is_active, reason.trim());
        setNotice(releasedNote(updated.released)); setModal(null);
        onToast(account.is_active ? 'تم تعطيل الحساب.' : 'تمت إعادة تفعيل الحساب.');
      } else if (type === 'reset') {
        const reset = await adminApi.resetPassword(account.id);
        setModal({ type: 'password', title: 'تمت إعادة تعيين كلمة المرور',
          username: account.staff_username, password: reset.temporary_password });
      }
      setTick((n) => n + 1);
    } catch (cause) { setFormError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const submitSearch = (event) => { event.preventDefault(); change('search', search.trim()); };
  const account = modal?.account;
  return <>
    <PageHeading eyebrow="إدارة الحسابات" title={accountsLabel(user)} subtitle={`أنشئ حسابات ${roles.map((role) => ({ staff: 'الموظفين', field_worker: 'العمال الميدانيين', admin: 'المسؤولين' })[role]).join(' و')}، وعطّلها أو أعد تعيين كلمات مرورها.`} action="تحديث القائمة" onAction={() => setTick((n) => n + 1)} onMenu={onMenu} />
    {notice && <div className="inline-note" role="status">{notice}</div>}
    <section className="panel reports-panel">
      <div className="panel-heading"><div><span className="eyebrow">حسابات اللوحة</span><h2>كل الحسابات</h2></div><button className="button button-gold" onClick={() => open('create')}><UserPlus size={17} />حساب جديد</button></div>
      <div className="reports-search-row"><form className="pending-search reports-search" onSubmit={submitSearch}><Search size={17} /><input type="search" value={search} onChange={(e) => { setSearch(e.target.value); if (!e.target.value && filters.search) change('search', ''); }} placeholder="ابحث بالاسم أو اسم المستخدم" aria-label="ابحث بالاسم أو اسم المستخدم" /><button type="submit">بحث</button></form></div>
      <div className="filters">
        <label>الدور<select value={filters.role} onChange={(e) => change('role', e.target.value)}><option value="">كل الأدوار</option>{roles.map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}</select></label>
        <label>الحالة<select value={filters.status} onChange={(e) => change('status', e.target.value)}><option value="">الكل</option><option value="active">نشط</option><option value="inactive">معطّل</option></select></label>
        {(filters.role || filters.status || filters.search) && <button className="clear-filters" onClick={() => { setFilters(empty); setSearch(''); }}>مسح الفلاتر</button>}
      </div>
      {loading && !result ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل الحسابات" detail={error} onRetry={() => setTick((n) => n + 1)} />
        : !result?.items.length ? <EmptyState icon={Users} title="لا توجد حسابات مطابقة" detail="غيّر الفلاتر أو أنشئ حسابًا جديدًا." />
          : <><div className="table-scroll"><table className="report-table admin-table"><thead><tr><th>الحساب</th><th>الدور</th><th>الحالة</th><th>آخر تغيير لكلمة المرور</th><th>الإجراءات</th></tr></thead>
            <tbody>{result.items.map((item) => <tr key={item.id}>
              <td><span className="account-identity"><strong>{item.full_name || '—'}{item.id === user.id && <b className="self-tag">أنت</b>}</strong><small dir="ltr">{item.staff_username}</small></span></td>
              <td><span className="account-identity"><strong>{accountRoleName(item)}</strong>{item.agency && <small>{agencyNames[item.agency]}</small>}{item.role === 'admin' && !item.is_owner && <small>{item.admin_permissions?.length ? item.admin_permissions.map((key) => permissionNames[key]).join('، ') : 'مراجعة البلاغات فقط'}</small>}</span></td>
              <td><AccountStatus account={item} /></td>
              <td className="date-cell">{item.password_changed_at ? fmtDate(item.password_changed_at) : 'لم تُغيّر بعد'}</td>
              <td><span className="admin-actions">
                {(!item.is_owner || item.id === user.id) && <button className="icon-button" title="تعديل" aria-label={`تعديل ${item.staff_username}`} onClick={() => open('edit', item)}><Pencil size={16} /></button>}
                {item.id !== user.id && (!item.is_owner || user.is_owner) && <button className="icon-button" title="إعادة تعيين كلمة المرور" aria-label={`إعادة تعيين كلمة مرور ${item.staff_username}`} onClick={() => open('reset', item)}><KeyRound size={16} /></button>}
                {item.id !== user.id && !item.is_owner && <button className={`icon-button ${item.is_active ? 'danger-icon' : ''}`} title={item.is_active ? 'تعطيل الحساب' : 'إعادة التفعيل'} aria-label={`${item.is_active ? 'تعطيل' : 'تفعيل'} ${item.staff_username}`} onClick={() => open('status', item)}>{item.is_active ? <Ban size={16} /> : <RotateCcw size={16} />}</button>}
              </span></td>
            </tr>)}</tbody></table></div>
            <Pagination result={result} page={filters.page} setPage={(page) => setFilters((current) => ({ ...current, page }))} /></>}
    </section>
    {modal?.type === 'password' && <TemporaryPasswordModal title={modal.title} username={modal.username} password={modal.password} onClose={() => setModal(null)} />}
    {['create', 'edit'].includes(modal?.type) && <ModalShell label={modal.type === 'create' ? 'حساب جديد' : 'تعديل الحساب'} icon={modal.type === 'create' ? UserPlus : UserCog} onClose={close}>
      <h3>{modal.type === 'create' ? 'حساب جديد' : 'تعديل الحساب'}</h3>
      <p>{modal.type === 'create' ? 'سيحصل صاحب الحساب على كلمة مرور مؤقتة يغيّرها عند أول دخول.' : `اسم المستخدم: ${account.staff_username}`}</p>
      <div className="admin-form">
        <label>الاسم الكامل<input value={form.full_name} maxLength={100} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
        {modal.type === 'create' && <label>اسم المستخدم<input dir="ltr" value={form.username} maxLength={50} placeholder="مثل: water.ali" onChange={(e) => setForm({ ...form, username: e.target.value })} /><small>أحرف إنجليزية صغيرة وأرقام و _ . - ويبدأ بحرف.</small></label>}
        <label>الدور<select value={form.role} disabled={account?.id === user.id || account?.is_owner} onChange={(e) => setForm({ ...form, role: e.target.value })}>{(account && !roles.includes(account.role) ? [account.role, ...roles] : roles).map((role) => <option key={role} value={role}>{role === 'admin' && account?.is_owner ? 'مسؤول رئيسي' : roleNames[role]}</option>)}</select>{account?.id === user.id && <small>لا يمكنك تغيير دورك بنفسك.</small>}</label>
        {form.role === 'admin' && !account?.is_owner && account?.id !== user.id && <fieldset className="permission-picker"><legend>صلاحيات المسؤول</legend>
          {Object.entries(permissionNames).map(([key, label]) => <label key={key} className="permission-option"><input type="checkbox" checked={form.admin_permissions.includes(key)} onChange={(e) => setForm({ ...form, admin_permissions: e.target.checked ? [...form.admin_permissions, key] : form.admin_permissions.filter((item) => item !== key) })} />{label}</label>)}
          <small>كل المسؤولين يراجعون البلاغات. إدارة المسؤولين للمسؤول الرئيسي وحده.</small></fieldset>}
        {form.role === 'field_worker' && <label>جهة العمل<select value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })}><option value="">اختر الجهة</option>{Object.entries(agencyNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        {modal.type === 'edit' && account.role === 'field_worker' && (form.role !== account.role || form.agency !== account.agency) && <small className="admin-warning">البلاغات التي استلمها ولم يبدأ العمل عليها تعود إلى قائمة جهته السابقة.</small>}
      </div>
      {formError && <div className="form-error" role="alert"><CircleAlert size={17} />{formError}</div>}
      <div className="modal-actions"><button className="button button-gold" disabled={busy} onClick={submit}>{busy ? 'جارٍ الحفظ...' : modal.type === 'create' ? 'إنشاء الحساب' : 'حفظ التعديلات'}</button><button className="button button-quiet" disabled={busy} onClick={close}>إلغاء</button></div>
    </ModalShell>}
    {modal?.type === 'status' && <ModalShell label="حالة الحساب" icon={account.is_active ? Ban : RotateCcw} danger={account.is_active} onClose={close}>
      <h3>{account.is_active ? `تعطيل حساب ${account.full_name || account.staff_username}؟` : `إعادة تفعيل ${account.full_name || account.staff_username}؟`}</h3>
      <p>{account.is_active ? 'يُمنع الدخول فورًا حتى لو كانت جلسته مفتوحة. تبقى سجلاته وبلاغاته كما هي.' : 'يستطيع صاحب الحساب الدخول من جديد بكلمة مروره الحالية.'}{account.is_active && account.role === 'field_worker' ? ' البلاغات التي استلمها ولم يبدأ العمل عليها تعود إلى قائمة جهته.' : ''}</p>
      {account.is_active && <label className="reason-label">السبب (اختياري)<textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>}
      {formError && <div className="form-error" role="alert"><CircleAlert size={17} />{formError}</div>}
      <div className="modal-actions"><button className={`button ${account.is_active ? 'button-danger' : 'button-gold'}`} disabled={busy} onClick={submit}>{account.is_active ? 'تعطيل الحساب' : 'إعادة التفعيل'}</button><button className="button button-quiet" disabled={busy} onClick={close}>إلغاء</button></div>
    </ModalShell>}
    {modal?.type === 'reset' && <ModalShell label="إعادة تعيين كلمة المرور" icon={KeyRound} onClose={close}>
      <h3>إعادة تعيين كلمة مرور {account.full_name || account.staff_username}؟</h3>
      <p>تتوقف كلمة المرور الحالية فورًا، وتظهر لك كلمة مؤقتة جديدة مرة واحدة. لن يستطيع صاحب الحساب استخدام اللوحة حتى يغيّرها.</p>
      {formError && <div className="form-error" role="alert"><CircleAlert size={17} />{formError}</div>}
      <div className="modal-actions"><button className="button button-gold" disabled={busy} onClick={submit}>إعادة التعيين</button><button className="button button-quiet" disabled={busy} onClick={close}>إلغاء</button></div>
    </ModalShell>}
  </>;
}

function CitizensPage({ onMenu, onToast }) {
  const empty = { status: '', search: '', page: 1 };
  const [filters, setFilters] = useState(empty);
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const { result, loading, error } = usePagedList(adminApi.citizens, filters, tick);
  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const submit = async () => {
    if (busy || !target) return;
    if (target.is_active && !reason.trim()) { setFormError('اكتب سبب الإيقاف.'); return; }
    setBusy(true); setFormError('');
    try {
      await adminApi.setCitizenActive(target.id, !target.is_active, reason.trim());
      onToast(target.is_active ? 'تم إيقاف حساب المواطن.' : 'تمت إعادة تفعيل حساب المواطن.');
      setTarget(null); setTick((n) => n + 1);
    } catch (cause) { setFormError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <>
    <PageHeading eyebrow="إدارة الحسابات" title="المواطنون" subtitle="ابحث عن حساب مواطن، وأوقفه مع ذكر السبب عند إساءة الاستخدام. تبقى بلاغاته السابقة كما هي." action="تحديث القائمة" onAction={() => setTick((n) => n + 1)} onMenu={onMenu} />
    <section className="panel reports-panel">
      <div className="panel-heading"><div><span className="eyebrow">حسابات تطبيق المواطن</span><h2>المواطنون المسجلون</h2></div><span className="count-chip">{number(result?.total || 0)} مواطن</span></div>
      <div className="reports-search-row"><form className="pending-search reports-search" onSubmit={(e) => { e.preventDefault(); change('search', search.trim()); }}><Search size={17} /><input type="search" value={search} onChange={(e) => { setSearch(e.target.value); if (!e.target.value && filters.search) change('search', ''); }} placeholder="ابحث بالاسم أو رقم الهاتف" aria-label="ابحث بالاسم أو رقم الهاتف" /><button type="submit">بحث</button></form></div>
      <div className="filters"><label>الحالة<select value={filters.status} onChange={(e) => change('status', e.target.value)}><option value="">الكل</option><option value="active">نشط</option><option value="inactive">موقوف</option></select></label>
        {(filters.status || filters.search) && <button className="clear-filters" onClick={() => { setFilters(empty); setSearch(''); }}>مسح الفلاتر</button>}</div>
      {loading && !result ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل المواطنين" detail={error} onRetry={() => setTick((n) => n + 1)} />
        : !result?.items.length ? <EmptyState icon={Contact} title="لا يوجد مواطنون مطابقون" detail="غيّر البحث أو الفلتر." />
          : <><div className="table-scroll"><table className="report-table admin-table"><thead><tr><th>المواطن</th><th>رقم الهاتف</th><th>البلاغات</th><th>تاريخ التسجيل</th><th>الحالة</th><th>الإجراء</th></tr></thead>
            <tbody>{result.items.map((item) => <tr key={item.id}>
              <td><strong>{item.full_name || 'لم يكمل اسمه'}</strong></td>
              <td dir="ltr" className="phone-cell">{localPhone(item.phone)}</td>
              <td>{number(item.report_count)}</td>
              <td className="date-cell">{fmtDate(item.created_at)}</td>
              <td><span className="account-status"><span className={`status-pill ${item.is_active ? 'resolved' : 'rejected'}`}><i />{item.is_active ? 'نشط' : 'موقوف'}</span>{!item.is_active && item.deactivated_reason && <small className="account-reason">{item.deactivated_reason}</small>}</span></td>
              <td><button className={`button ${item.is_active ? 'button-danger-quiet' : 'button-quiet'} admin-row-action`} onClick={() => { setTarget(item); setReason(''); setFormError(''); }}>{item.is_active ? <><Ban size={15} />إيقاف</> : <><RotateCcw size={15} />إعادة التفعيل</>}</button></td>
            </tr>)}</tbody></table></div>
            <Pagination result={result} page={filters.page} setPage={(page) => setFilters((current) => ({ ...current, page }))} /></>}
    </section>
    {target && <ModalShell label="حالة حساب المواطن" icon={target.is_active ? Ban : RotateCcw} danger={target.is_active} onClose={() => !busy && setTarget(null)}>
      <h3>{target.is_active ? 'إيقاف حساب المواطن؟' : 'إعادة تفعيل حساب المواطن؟'}</h3>
      <p>{target.full_name || 'مواطن'} · <span dir="ltr">{localPhone(target.phone)}</span>. {target.is_active ? 'لن يستطيع الدخول أو إرسال بلاغات جديدة، وسيظهر له أن حسابه موقوف. تبقى بلاغاته السابقة كما هي.' : 'يستطيع الدخول وإرسال البلاغات من جديد.'}</p>
      {target.is_active && <label className="reason-label">سبب الإيقاف<span>إلزامي</span><textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>}
      {formError && <div className="form-error" role="alert"><CircleAlert size={17} />{formError}</div>}
      <div className="modal-actions"><button className={`button ${target.is_active ? 'button-danger' : 'button-gold'}`} disabled={busy || (target.is_active && !reason.trim())} onClick={submit}>{target.is_active ? 'إيقاف الحساب' : 'إعادة التفعيل'}</button><button className="button button-quiet" disabled={busy} onClick={() => setTarget(null)}>إلغاء</button></div>
    </ModalShell>}
  </>;
}

function auditDetail(item) {
  const details = item.details || {};
  const parts = [];
  const permissionList = (list) => (list?.length ? list.map((key) => permissionNames[key]).join('، ') : 'بلا صلاحيات إدارية');
  if (details.role && item.action === 'account_created') parts.push(details.owner ? 'مسؤول رئيسي' : roleNames[details.role]);
  if (details.admin_permissions && item.action === 'account_created') parts.push(`الصلاحيات: ${permissionList(details.admin_permissions)}`);
  if (details.agency) parts.push(agencyNames[details.agency]);
  if (details.source) parts.push('أُنشئ من سكربت الخادم');
  for (const [key, value] of Object.entries(details.changes || {})) {
    const show = (v) => (key === 'role' ? roleNames[v] : key === 'agency' ? agencyNames[v] || 'بلا جهة'
      : key === 'admin_permissions' ? permissionList(v) : v || '—');
    parts.push(`${{ full_name: 'الاسم', role: 'الدور', agency: 'الجهة', admin_permissions: 'الصلاحيات' }[key]}: ${show(value.from)} ← ${show(value.to)}`);
  }
  if (details.reason) parts.push(`السبب: ${details.reason}`);
  if (details.released_reports?.length) parts.push(`أُعيد ${number(details.released_reports.length)} بلاغ إلى قائمة الجهة`);
  if (details.in_progress_reports) parts.push(`${number(details.in_progress_reports)} بلاغ قيد المعالجة باسمه`);
  if (item.action === 'password_changed') parts.push(details.forced ? 'بعد كلمة مرور مؤقتة' : 'تغيير اختياري');
  return parts.join(' · ') || '—';
}

function AuditPage({ onMenu }) {
  const [filters, setFilters] = useState({ action: '', page: 1 });
  const [tick, setTick] = useState(0);
  const { result, loading, error } = usePagedList(adminApi.audit, filters, tick);
  return <>
    <PageHeading eyebrow="المساءلة" title="سجل الإجراءات" subtitle="كل إجراء إداري على الحسابات، ومن نفّذه ومتى." action="تحديث السجل" onAction={() => setTick((n) => n + 1)} onMenu={onMenu} />
    <section className="panel reports-panel">
      <div className="panel-heading"><div><span className="eyebrow">سجل لا يُعدّل</span><h2>الإجراءات الإدارية</h2></div><span className="count-chip">{number(result?.total || 0)} إجراء</span></div>
      <div className="filters"><label>نوع الإجراء<select value={filters.action} onChange={(e) => setFilters({ action: e.target.value, page: 1 })}><option value="">كل الإجراءات</option>{Object.entries(auditActions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      {loading && !result ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل السجل" detail={error} onRetry={() => setTick((n) => n + 1)} />
        : !result?.items.length ? <EmptyState icon={History} title="لا توجد إجراءات" detail="ستظهر هنا إجراءات المسؤولين على الحسابات." />
          : <><div className="table-scroll"><table className="report-table admin-table"><thead><tr><th>الوقت</th><th>المنفّذ</th><th>الإجراء</th><th>الحساب</th><th>التفاصيل</th></tr></thead>
            <tbody>{result.items.map((item) => <tr key={item.id}>
              <td className="date-cell">{fmtDate(item.created_at)}</td>
              <td>{item.actor_name || item.actor_username}</td>
              <td><strong>{auditActions[item.action] || item.action}</strong></td>
              <td><span className="account-identity"><strong>{item.target_name || item.target_username || localPhone(item.target_phone)}</strong><small>{roleNames[item.target_role] || ''}</small></span></td>
              <td className="audit-detail">{auditDetail(item)}</td>
            </tr>)}</tbody></table></div>
            <Pagination result={result} page={filters.page} setPage={(page) => setFilters((current) => ({ ...current, page }))} /></>}
    </section>
  </>;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState('');
  const [queueCounts, setQueueCounts] = useState({ pending: 0, fieldReview: 0, completion: 0 });
  const [loginNotice, setLoginNotice] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  useEffect(() => {
    let active = true;
    restoreSession().then((restored) => { if (active) setUser(restored); });
    const ended = (event) => {
      setUser(null);
      if (event.detail === 'disabled') setLoginNotice('هذا الحساب معطّل. تواصل مع مسؤول النظام.');
    };
    const passwordRequired = () => setUser((current) =>
      (current ? { ...current, must_change_password: true } : current));
    window.addEventListener('balaghi:session-ended', ended);
    window.addEventListener('balaghi:password-change-required', passwordRequired);
    return () => {
      active = false;
      window.removeEventListener('balaghi:session-ended', ended);
      window.removeEventListener('balaghi:password-change-required', passwordRequired);
    };
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!['staff', 'admin'].includes(user?.role) || user.must_change_password) return undefined;
    let active = true;
    const refreshCount = () => staffApi.overview()
      .then((stats) => { if (active) setQueueCounts({ pending: stats.pending_review || 0,
        fieldReview: stats.pending_field_review || 0, completion: stats.pending_completion || 0 }); })
      .catch(() => {});
    refreshCount();
    const timer = setInterval(refreshCount, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [user, refreshKey]);
  const leave = () => {
    logout(); setUser(null); setSelectedId(null); setPage('overview'); setPasswordOpen(false);
  };
  if (user === undefined) return <div className="startup"><img src="/balaghi_logo.png" alt="بلاغي" /><span className="spinner" /></div>;
  if (!user) return <LoginScreen key={loginNotice} notice={loginNotice} onLogin={(signedIn) => { setLoginNotice(''); setUser(signedIn); }} />;
  if (user.must_change_password) return <ForcedPasswordScreen user={user} onDone={setUser} onLogout={leave} />;
  const passwordModal = passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} onDone={() => {
    setPasswordOpen(false); setToast('تم تغيير كلمة المرور، وأُغلقت جلساتك على الأجهزة الأخرى.');
  }} />;
  const toastView = toast && <div className="toast" role="status"><Check size={18} />{toast}<button aria-label="إغلاق الرسالة" onClick={() => setToast('')}><X size={16} /></button></div>;
  if (user.role === 'field_worker') {
    return <><FieldWorkerPage user={user} onLogout={leave} onPassword={() => setPasswordOpen(true)} />{passwordModal}{toastView}</>;
  }
  const isAdmin = user.role === 'admin';
  const adminPages = new Set(isAdmin ? allowedAdminPages(user).map((item) => item.key) : []);
  const pageTitle = [...navigation, ...allowedAdminPages(user)].find((item) => item.key === page)?.label || 'نظرة عامة';
  return <div className="app-layout">
    <Sidebar page={page} setPage={setPage} user={user} onLogout={leave} onPassword={() => setPasswordOpen(true)} closeMobile={() => setMobileNav(false)} open={mobileNav} queueCounts={queueCounts} />
    <main className="main-area"><div className="top-strip"><span><span className="online-dot" />نظام بلاغي · {isAdmin ? 'لوحة المسؤول' : 'لوحة الموظف'}</span><div><CalendarDays size={16} />{new Intl.DateTimeFormat('ar-LY', { dateStyle: 'full' }).format(new Date())}<span className="top-user"><UserRound size={17} />{user.full_name || user.staff_username}</span></div></div>
      <div className="page-container" key={page}>
        {page === 'overview' && <OverviewPage user={user} onOpen={setSelectedId} onNavigate={setPage} refreshKey={refreshKey} onMenu={() => setMobileNav(true)} />}
        {page === 'pending' && <PendingReviewPage onOpen={setSelectedId} refreshKey={refreshKey} onMenu={() => setMobileNav(true)} />}
        {page === 'fieldReview' && <PendingReviewPage fieldReviewQueue onOpen={setSelectedId} refreshKey={refreshKey} onMenu={() => setMobileNav(true)} />}
        {page === 'completion' && <PendingReviewPage completionQueue onOpen={setSelectedId} refreshKey={refreshKey} onMenu={() => setMobileNav(true)} />}
        {page === 'reports' && <ReportsPage pendingOnly={false} onOpen={setSelectedId} refreshKey={refreshKey} onMenu={() => setMobileNav(true)} />}
        {page === 'map' && <MapPage onOpen={setSelectedId} refreshKey={refreshKey} onMenu={() => setMobileNav(true)} />}
        {page === 'stats' && <StatsPage refreshKey={refreshKey} onMenu={() => setMobileNav(true)} />}
        {adminPages.has('accounts') && page === 'accounts' && <AccountsPage user={user} onMenu={() => setMobileNav(true)} onToast={setToast} />}
        {adminPages.has('citizens') && page === 'citizens' && <CitizensPage onMenu={() => setMobileNav(true)} onToast={setToast} />}
        {adminPages.has('audit') && page === 'audit' && <AuditPage onMenu={() => setMobileNav(true)} />}
      </div>
      <footer className="main-footer"><span>بلاغي · إدارة البلاغات المدنية</span><span>{pageTitle}</span></footer>
    </main>
    {selectedId && <DetailDrawer id={String(selectedId)} onClose={() => setSelectedId(null)} onUpdated={() => setRefreshKey((n) => n + 1)} onToast={setToast} />}
    {passwordModal}
    {toastView}
  </div>;
}
