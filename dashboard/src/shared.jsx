// Labels, permission rules, formatting helpers and small components every screen shares.
import React, { useState } from 'react';
import {
  ArrowUpLeft, BarChart3, CheckCheck, ChevronLeft, ChevronRight, CircleAlert, Construction, Contact, Droplets, FileClock, History, LayoutDashboard, MapPin, MapPinned, Menu, RefreshCw, ShieldCheck, Trash2, Users,
} from 'lucide-react';
import { ApiError, imageUrl } from './api.js';

export const categories = {
  pothole: { label: 'الحفر', icon: Construction },
  water_leak: { label: 'تسرب مياه', icon: Droplets },
  garbage: { label: 'قمامة', icon: Trash2 },
};
export const agencies = {
  public_services: 'شركة الخدمات العامة - لمشاكل تراكم النفايات',
  water_sewer: 'الشركة العامة للمياه و الصرف الصحي - لمشاكل تسربات المياه',
  roads_maintenance: 'مكتب الطرق و الصيانة - لمشاكل الحفر',
};
export const agencyTeams = {
  public_services: 'فريق شركة الخدمات العامة',
  water_sewer: 'فريق الشركة العامة للمياه والصرف الصحي',
  roads_maintenance: 'فريق مكتب الطرق والصيانة',
};
export const categoryAgency = {
  garbage: 'public_services', water_leak: 'water_sewer', pothole: 'roads_maintenance',
};
const statuses = {
  new: { label: 'جديد', className: 'new' },
  in_progress: { label: 'قيد المعالجة', className: 'in-progress' },
  resolved: { label: 'تم الحل', className: 'resolved' },
  rejected: { label: 'مرفوض', className: 'rejected' },
};
export const fieldIssueReasons = {
  not_found: 'المشكلة غير موجودة', wrong_location: 'الموقع غير صحيح',
  duplicate: 'بلاغ مكرر', inaccessible: 'تعذّر الوصول', other: 'سبب آخر',
};
export const verificationResults = {
  exists: 'المشكلة موجودة', wrong_location: 'الموقع غير صحيح',
  not_found: 'المشكلة غير موجودة', unable: 'تعذّر التحقق',
  cancelled: 'أُلغي طلب التحقق',
};
export const navigation = [
  { key: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { key: 'pending', label: 'بانتظار المراجعة', icon: FileClock },
  { key: 'fieldReview', label:'تحتاج مراجعة موظف', icon: CircleAlert },
  { key: 'completion', label: 'بانتظار تأكيد الحل', icon: CheckCheck },
  { key: 'reports', label: 'جميع البلاغات', icon: ShieldCheck },
  { key: 'map', label: 'الخريطة', icon: MapPinned },
  { key: 'stats', label: 'الإحصاءات', icon: BarChart3 },
];
// Mirrors the server rules; the server still checks every request.
export const permissionNames = {
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
export const manageableRoles = (user) => ['staff', 'field_worker', 'admin'].filter((role) => canManageRole(user, role));
export const adminNavigation = [
  { key: 'accounts', label: (user) => accountsLabel(user), icon: Users, allowed: (user) => manageableRoles(user).length > 0 },
  { key: 'citizens', label: 'المواطنون', icon: Contact, allowed: (user) => hasPermission(user, 'manage_citizens') },
  { key: 'audit', label: 'سجل الإجراءات', icon: History, allowed: (user) => hasPermission(user, 'view_audit') },
];
// Named after what this administrator manages: «الموظفون», «العمال», or both.
export function accountsLabel(user) {
  const roles = manageableRoles(user);
  if (roles.includes('staff') && !roles.includes('field_worker')) return 'الموظفون';
  if (roles.includes('field_worker') && !roles.includes('staff')) return 'العمال';
  return 'الموظفون والعمال';
}
export const allowedAdminPages = (user) => adminNavigation.filter((item) => item.allowed(user))
  .map((item) => ({ ...item, label: typeof item.label === 'function' ? item.label(user) : item.label }));
export const roleNames = {
  admin: 'مسؤول', staff: 'موظف', field_worker: 'عامل ميداني', citizen: 'مواطن',
};
export const auditActions = {
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
export const accountRoleName = (account) => (account.role === 'admin' && account.is_owner
  ? 'مسؤول رئيسي' : roleNames[account.role]);

export const fmtDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-LY', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
};
export const number = (value) => new Intl.NumberFormat('ar-LY').format(Number(value) || 0);
export const reportSearchId = (value) => {
  const id = value.trim().replace(/^#/, '');
  return !id || (/^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n) ? id : null;
};
export const categoryName = (value) => categories[value]?.label || 'تصنيف غير معروف';
const statusName = (value) => statuses[value]?.label || '—';
export const errorText = (error) => {
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

export function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <img src="/balaghi_logo.png" alt="شعار بلاغي" />
    <div><strong>بلاغي<span className="brand-dot">.</span></strong><small>لوحة إدارة البلاغات</small></div>
  </div>;
}

export function CategoryIcon({ category, size = 19 }) {
  const Icon = categories[category]?.icon || CircleAlert;
  return <span className="category-icon"><Icon size={size} strokeWidth={2.1} /></span>;
}

export function StatusPill({ report }) {
  const style = report.status === 'rejected' ? 'rejected'
    : !report.approved_at ? 'pending' : statuses[report.status]?.className || 'pending';
  const label = report.status === 'rejected' ? 'مرفوض'
    : !report.approved_at ? 'بانتظار المراجعة' : statusName(report.status);
  return <span className={`status-pill ${style}`}><i />{label}</span>;
}

export function AcceptanceState({ report }) {
  if (!report.approved_at || report.status !== 'new') return null;
  const worker = report.assigned_worker_name || report.assigned_worker_username;
  return <span className={`acceptance-state ${report.accepted_at ? 'accepted' : 'waiting'}`}>
    {report.accepted_at ? `استلمه ${worker || 'العامل الميداني'}` : 'بانتظار الاستلام'}
  </span>;
}

export function VerificationState({ report }) {
  if (report.approved_at || report.status === 'rejected' ||
      !report.verification_requested_at || report.verification_result === 'cancelled') return null;
  return <span className={`verification-state ${report.verification_result ? 'answered' : 'waiting'}`}>
    {report.verification_result ? 'وصل رد التحقق' : 'قيد التحقق الميداني'}
  </span>;
}

export function ReportThumbnail({ report }) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(report.image_url);
  return <span className="report-thumb">
    {src && !failed ? <img src={src} alt={`صورة البلاغ ${report.id}`} onError={() => setFailed(true)} />
      : <CategoryIcon category={report.category} size={23} />}
  </span>;
}

export function EmptyState({ icon: Icon = FileClock, title, detail, onRetry }) {
  return <div className="empty-state">
    <span className="empty-icon"><Icon size={28} /></span>
    <h3>{title}</h3><p>{detail}</p>
    {onRetry && <button className="button button-quiet" onClick={onRetry}><RefreshCw size={16} />إعادة المحاولة</button>}
  </div>;
}

export function LoadingState() {
  return <div className="loading-state"><span className="spinner" />جارٍ تحميل البيانات...</div>;
}

export function PageHeading({ eyebrow, title, subtitle, action, onAction, onMenu }) {
  return <header className="page-heading">
    <div className="page-heading-copy"><button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div></div>
    {action && <button className="button button-quiet refresh-action" onClick={onAction}><RefreshCw size={17} />{action}</button>}
  </header>;
}

export function ReportTable({ items, onOpen, compact = false }) {
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

export const agencyNames = {
  public_services: 'شركة الخدمات العامة',
  water_sewer: 'الشركة العامة للمياه والصرف الصحي',
  roads_maintenance: 'مكتب الطرق والصيانة',
};
export const localPhone = (phone) => (phone?.startsWith('+218') ? `0${phone.slice(4)}` : phone || '—');

export function ModalShell({ label, icon: Icon, danger = false, onClose, children }) {
  return <div className="modal-layer"><button className="modal-backdrop" aria-label="إغلاق" onClick={onClose} />
    <div className="confirm-modal admin-modal" role="dialog" aria-modal="true" aria-label={label}>
      <div className={`modal-icon ${danger ? 'danger' : ''}`}><Icon size={22} /></div>{children}
    </div></div>;
}

export function Pagination({ result, page, setPage }) {
  return <div className="pagination"><span>صفحة {number(result.page)} من {number(Math.max(result.total_pages, 1))}</span><div>
    <button className="icon-button" aria-label="الصفحة السابقة" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronRight size={18} /></button>
    <button className="icon-button" aria-label="الصفحة التالية" disabled={page >= result.total_pages} onClick={() => setPage(page + 1)}><ChevronLeft size={18} /></button>
  </div></div>;
}

