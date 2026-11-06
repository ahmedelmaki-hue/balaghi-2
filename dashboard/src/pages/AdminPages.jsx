// Account administration: staff and workers, citizens, and the audit log.
import React, { useEffect, useState } from 'react';
import {
  Ban, ChevronLeft, ChevronRight, CircleAlert, Contact, Copy, History,
  KeyRound, Menu, Pencil, RefreshCw, RotateCcw, Search, UserCog, UserPlus, Users,
} from 'lucide-react';
import { adminApi } from '../api.js';
import { permissionNames, manageableRoles, accountsLabel, roleNames, auditActions, accountRoleName, fmtDate, number, errorText, EmptyState, LoadingState, agencyNames, localPhone, ModalShell } from '../shared.jsx';

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


const ROLE_PLURAL = { admin: 'المسؤولون', staff: 'الموظفون', field_worker: 'العمال الميدانيون' };
const clockTime = new Intl.DateTimeFormat('ar-LY', { hour: 'numeric', minute: '2-digit' });
const dayOnly = new Intl.DateTimeFormat('ar-LY', { dateStyle: 'medium' });

function AccountRow({ item, user, onAction }) {
  const self = item.id === user.id;
  const canEdit = !item.is_owner || self;
  const canReset = !self && (!item.is_owner || user.is_owner);
  const canStatus = !self && !item.is_owner;
  const name = item.full_name || item.staff_username;
  return <tr className={item.is_active ? '' : 'is-off'}>
    <td data-cell="account"><div className="ac-who">
      <span><strong>{item.full_name || '—'}{self && <b className="ac-self">أنت</b>}</strong><small className="ac-handle"><span dir="ltr">{item.staff_username}</span><i aria-hidden="true">·</i>{item.contact_phone
        ? <a dir="ltr" href={`tel:${item.contact_phone}`} aria-label={`اتصل بـ ${name}`}>{localPhone(item.contact_phone)}</a>
        : <b className="ac-nophone">بلا رقم</b>}</small></span>
    </div></td>
    <td data-cell="role"><div className="ac-tags">
      <span className="ac-role">{accountRoleName(item)}</span>
      {item.agency && <small className="ac-sub">{agencyNames[item.agency]}</small>}
      {item.role === 'admin' && !item.is_owner && <small className="ac-sub">{item.admin_permissions?.length
        ? item.admin_permissions.map((key) => permissionNames[key]).join('، ') : 'مراجعة البلاغات فقط'}</small>}
    </div></td>
    <td data-cell="status"><div className="ac-state">
      <span className={`ac-status ${item.is_active ? 'is-on' : 'is-off'}`}><i />{item.is_active ? 'نشط' : 'معطّل'}</span>
      {item.is_active && item.must_change_password && <small className="ac-flag"><KeyRound size={13} />بانتظار تغيير كلمة المرور</small>}
      {!item.is_active && item.deactivated_reason && <small className="ac-reason">{item.deactivated_reason}</small>}
    </div></td>
    <td data-cell="password" className="ac-date"><span className="ac-label">آخر تغيير لكلمة المرور: </span>{item.password_changed_at ? <time dateTime={item.password_changed_at} title={fmtDate(item.password_changed_at)}>{dayOnly.format(new Date(item.password_changed_at))}</time> : 'لم تُغيّر بعد'}</td>
    <td data-cell="actions"><div className="ac-actions">
      {canEdit && <button type="button" className="ac-btn" aria-label={`تعديل ${name}`} onClick={() => onAction('edit', item)}><Pencil size={15} />تعديل</button>}
      {canReset && <button type="button" className="ac-btn" aria-label={`إعادة تعيين كلمة مرور ${name}`} onClick={() => onAction('reset', item)}><KeyRound size={15} />كلمة المرور</button>}
      {canStatus && <button type="button" className={`ac-btn ${item.is_active ? 'is-danger' : 'is-go'}`} aria-label={`${item.is_active ? 'تعطيل' : 'إعادة تفعيل'} ${name}`} onClick={() => onAction('status', item)}>{item.is_active ? <><Ban size={15} />تعطيل</> : <><RotateCcw size={15} />إعادة التفعيل</>}</button>}
    </div></td>
  </tr>;
}

// A Libyan mobile number in any common form, or null; the server checks it too.
function libyanMobile(value) {
  const national = value.replace(/[\s()-]/g, '').replace(/^(\+?218|0)/, '');
  return /^9\d{8}$/.test(national) ? `+218${national}` : null;
}

export function AccountsPage({ user, onMenu, onToast }) {
  const empty = { role: '', status: '', search: '', page: 1 };
  const [filters, setFilters] = useState(empty);
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null);
  const roles = manageableRoles(user);
  const blankForm = { full_name: '', username: '', contact_phone: '', role: roles[0], agency: '', admin_permissions: [] };
  const [form, setForm] = useState(blankForm);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const { result, loading, error } = usePagedList(adminApi.users, filters, tick);
  const [roleCount, setRoleCount] = useState({});
  const [loadedAt, setLoadedAt] = useState(null);
  useEffect(() => {
    let active = true;
    Promise.all(['', ...roles].map((role) => adminApi.users({ role, limit: 1 }).then((data) => [role, data.total])))
      .then((pairs) => { if (active) setRoleCount(Object.fromEntries(pairs)); })
      .catch(() => { if (active) setRoleCount({}); });
    return () => { active = false; };
  }, [tick, roles.join()]);
  useEffect(() => { if (result) setLoadedAt(new Date()); }, [result]);
  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const open = (type, account = null) => {
    setModal({ type, account }); setFormError(''); setReason('');
    setForm(account ? { full_name: account.full_name || '', username: account.staff_username,
      contact_phone: account.contact_phone ? localPhone(account.contact_phone) : '', role: account.role, agency: account.agency || '',
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
      if (!libyanMobile(form.contact_phone)) { setFormError('اكتب رقم جوال ليبي صحيحًا للتواصل، مثل 0912345678.'); return; }
      if (form.role === 'field_worker' && !form.agency) { setFormError('اختر جهة العمل للعامل الميداني.'); return; }
    }
    setBusy(true); setFormError('');
    try {
      const agency = form.role === 'field_worker' ? form.agency : null;
      if (type === 'create') {
        const created = await adminApi.createUser({ full_name: form.full_name.trim(),
          username: form.username.trim().toLowerCase(), contact_phone: libyanMobile(form.contact_phone), role: form.role, agency,
          ...(form.role === 'admin' ? { admin_permissions: form.admin_permissions } : {}) });
        setModal({ type: 'password', title: 'تم إنشاء الحساب', username: created.user.staff_username,
          password: created.temporary_password });
      } else if (type === 'edit') {
        const body = { full_name: form.full_name.trim(), contact_phone: libyanMobile(form.contact_phone) };
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
  return <div className="rl ac">
    <header className="pr-head">
      <div className="pr-title">
        <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
        <div><span className="eyebrow">إدارة الحسابات</span>
          <h1>{accountsLabel(user)}{roleCount[''] !== undefined && <span className="pr-count num">{number(roleCount[''])}</span>}</h1>
          <p>{`أنشئ حسابات ${roles.map((role) => ({ staff: 'الموظفين', field_worker: 'العمال الميدانيين', admin: 'المسؤولين' })[role]).join(' و')}، وعطّلها أو أعد تعيين كلمات مرورها.`}</p></div>
      </div>
      <div className="ac-head-actions">
        <button type="button" className="pr-refresh" onClick={() => setTick((n) => n + 1)}>
          <RefreshCw size={16} />{loadedAt ? <>تحديث · <span className="num">{clockTime.format(loadedAt)}</span></> : 'تحديث'}
        </button>
        <button type="button" className="ac-create" onClick={() => open('create')}><UserPlus size={17} />حساب جديد</button>
      </div>
    </header>
    {notice && <div className="inline-note" role="status">{notice}</div>}

    <section className="rl-filters" aria-label="تصفية الحسابات">
      <div className="rl-stages" role="group" aria-label="الدور">
        {['', ...roles].map((role) => <button type="button" key={role || 'all'} className={filters.role === role ? 'is-active' : ''} aria-pressed={filters.role === role} onClick={() => change('role', role)}>
          {role ? ROLE_PLURAL[role] : 'كل الحسابات'}{roleCount[role] !== undefined && <small className="num">{number(roleCount[role])}</small>}
        </button>)}
      </div>
      <div className="rl-controls">
        <form className="pr-search ac-search" onSubmit={submitSearch} role="search"><Search size={16} /><input type="search" value={search} onChange={(e) => { setSearch(e.target.value); if (!e.target.value && filters.search) change('search', ''); }} placeholder="الاسم أو اسم المستخدم" aria-label="ابحث بالاسم أو اسم المستخدم" /><button type="submit">بحث</button></form>
        <div className="ac-segment" role="group" aria-label="الحالة">
          {[['', 'الكل'], ['active', 'نشط'], ['inactive', 'معطّل']].map(([key, label]) => <button type="button" key={key || 'all'} className={filters.status === key ? 'is-active' : ''} aria-pressed={filters.status === key} onClick={() => change('status', key)}>{label}</button>)}
        </div>
        {(filters.role || filters.status || filters.search) && <span className="rl-active"><button type="button" onClick={() => { setFilters(empty); setSearch(''); }}>مسح الفلاتر</button></span>}
      </div>
    </section>

    {loading && !result ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل الحسابات" detail={error} onRetry={() => setTick((n) => n + 1)} />
      : !result?.items.length ? <div className="rl-card rl-empty"><EmptyState icon={Users} title="لا توجد حسابات مطابقة" detail="غيّر الفلاتر أو أنشئ حسابًا جديدًا." /></div>
        : <>
          <section className="rl-card"><div className="rl-scroll"><table className="ac-table">
            <thead><tr><th scope="col">الحساب</th><th scope="col">الدور والجهة</th><th scope="col">الحالة</th><th scope="col">كلمة المرور غُيّرت</th><th scope="col"><span className="sr-only">الإجراءات</span></th></tr></thead>
            <tbody>{result.items.map((item) => <AccountRow key={item.id} item={item} user={user} onAction={open} />)}</tbody>
          </table></div>
          {result.total_pages > 1 && <footer className="pr-pages"><span>صفحة <span className="num">{number(result.page)}</span> من <span className="num">{number(result.total_pages)}</span> · <span className="num">{number(result.total)}</span> حساب</span><div><button className="icon-button" aria-label="الصفحة السابقة" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}><ChevronRight size={18} /></button><button className="icon-button" aria-label="الصفحة التالية" disabled={filters.page >= result.total_pages} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}><ChevronLeft size={18} /></button></div></footer>}
          </section>
        </>}
    {modal?.type === 'password' && <TemporaryPasswordModal title={modal.title} username={modal.username} password={modal.password} onClose={() => setModal(null)} />}
    {['create', 'edit'].includes(modal?.type) && <ModalShell label={modal.type === 'create' ? 'حساب جديد' : 'تعديل الحساب'} icon={modal.type === 'create' ? UserPlus : UserCog} onClose={close}>
      <h3>{modal.type === 'create' ? 'حساب جديد' : 'تعديل الحساب'}</h3>
      <p>{modal.type === 'create' ? 'سيحصل صاحب الحساب على كلمة مرور مؤقتة يغيّرها عند أول دخول.' : `اسم المستخدم: ${account.staff_username}`}</p>
      <div className="admin-form">
        <label>الاسم الكامل<input value={form.full_name} maxLength={100} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
        <label><span>رقم للتواصل <span className="ac-required">إلزامي</span></span><input dir="ltr" type="tel" inputMode="tel" autoComplete="off" required value={form.contact_phone} maxLength={16} placeholder="0912345678" onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /><small>{modal.type === 'edit' && !account.contact_phone ? 'هذا الحساب بلا رقم بعد؛ أضفه لحفظ أي تعديل. ' : ''}للتواصل فقط، ولا يُستخدم لتسجيل الدخول.</small></label>
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
  </div>;
}

export function CitizensPage({ onMenu, onToast }) {
  const empty = { status: '', search: '', page: 1 };
  const [filters, setFilters] = useState(empty);
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const { result, loading, error } = usePagedList(adminApi.citizens, filters, tick);
  const [statusCount, setStatusCount] = useState({});
  const [loadedAt, setLoadedAt] = useState(null);
  useEffect(() => {
    let active = true;
    Promise.all(['', 'active', 'inactive'].map((status) => adminApi.citizens({ status, limit: 1 }).then((data) => [status, data.total])))
      .then((pairs) => { if (active) setStatusCount(Object.fromEntries(pairs)); })
      .catch(() => { if (active) setStatusCount({}); });
    return () => { active = false; };
  }, [tick]);
  useEffect(() => { if (result) setLoadedAt(new Date()); }, [result]);
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
  const openTarget = (item) => { setTarget(item); setReason(''); setFormError(''); };
  const filtered = Boolean(filters.status || filters.search);
  return <div className="rl ac">
    <header className="pr-head">
      <div className="pr-title">
        <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
        <div><span className="eyebrow">إدارة الحسابات</span>
          <h1>المواطنون{statusCount[''] !== undefined && <span className="pr-count num">{number(statusCount[''])}</span>}</h1>
          <p>ابحث عن حساب مواطن، وأوقفه مع ذكر السبب عند إساءة الاستخدام. تبقى بلاغاته السابقة كما هي.</p></div>
      </div>
      <button type="button" className="pr-refresh" onClick={() => setTick((n) => n + 1)}>
        <RefreshCw size={16} />{loadedAt ? <>تحديث · <span className="num">{clockTime.format(loadedAt)}</span></> : 'تحديث'}
      </button>
    </header>

    <section className="rl-filters" aria-label="تصفية المواطنين">
      <div className="rl-stages" role="group" aria-label="الحالة">
        {[['', 'كل المواطنين'], ['active', 'نشط'], ['inactive', 'موقوف']].map(([key, label]) => <button type="button" key={key || 'all'} className={filters.status === key ? 'is-active' : ''} aria-pressed={filters.status === key} onClick={() => change('status', key)}>
          {label}{statusCount[key] !== undefined && <small className="num">{number(statusCount[key])}</small>}
        </button>)}
      </div>
      <div className="rl-controls">
        <form className="pr-search ac-search" onSubmit={(e) => { e.preventDefault(); change('search', search.trim()); }} role="search"><Search size={16} /><input type="search" value={search} onChange={(e) => { setSearch(e.target.value); if (!e.target.value && filters.search) change('search', ''); }} placeholder="الاسم أو رقم الهاتف" aria-label="ابحث بالاسم أو رقم الهاتف" /><button type="submit">بحث</button></form>
        {filtered && <span className="rl-active"><button type="button" onClick={() => { setFilters(empty); setSearch(''); }}>مسح الفلاتر</button></span>}
      </div>
    </section>

    {loading && !result ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل المواطنين" detail={error} onRetry={() => setTick((n) => n + 1)} />
      : !result?.items.length ? <div className="rl-card rl-empty"><EmptyState icon={Contact} title="لا يوجد مواطنون مطابقون" detail={filtered ? 'غيّر البحث أو الفلتر.' : 'سيظهر هنا كل من يسجّل في تطبيق المواطن.'} /></div>
        : <section className="rl-card"><div className="rl-scroll"><table className="ac-table is-citizens">
          <thead><tr><th scope="col">المواطن</th><th scope="col">رقم الهاتف</th><th scope="col">البلاغات</th><th scope="col">سجّل في</th><th scope="col">الحالة</th><th scope="col"><span className="sr-only">الإجراء</span></th></tr></thead>
          <tbody>{result.items.map((item) => <tr key={item.id} className={item.is_active ? '' : 'is-off'}>
            <td data-cell="citizen"><div className="ac-who"><span><strong className={item.full_name ? '' : 'is-empty'}>{item.full_name || 'لم يكمل اسمه'}</strong></span></div></td>
            <td data-cell="phone" className="ac-phone" dir="ltr">{localPhone(item.phone)}</td>
            <td data-cell="reports" className="ac-count"><span className="ac-label">البلاغات: </span>{item.report_count ? <span className="num">{number(item.report_count)}</span> : <span className="ac-none">لا بلاغات</span>}</td>
            <td data-cell="joined" className="ac-date"><span className="ac-label">سجّل في: </span><time dateTime={item.created_at} title={fmtDate(item.created_at)}>{dayOnly.format(new Date(item.created_at))}</time></td>
            <td data-cell="status"><div className="ac-state">
              <span className={`ac-status ${item.is_active ? 'is-on' : 'is-off'}`}><i />{item.is_active ? 'نشط' : 'موقوف'}</span>
              {!item.is_active && item.deactivated_reason && <small className="ac-reason">{item.deactivated_reason}</small>}
            </div></td>
            <td data-cell="actions"><div className="ac-actions">
              <button type="button" className={`ac-btn ${item.is_active ? 'is-danger' : 'is-go'}`} aria-label={`${item.is_active ? 'إيقاف' : 'إعادة تفعيل'} ${item.full_name || localPhone(item.phone)}`} onClick={() => openTarget(item)}>{item.is_active ? <><Ban size={15} />إيقاف</> : <><RotateCcw size={15} />إعادة التفعيل</>}</button>
            </div></td>
          </tr>)}</tbody>
        </table></div>
        {result.total_pages > 1 && <footer className="pr-pages"><span>صفحة <span className="num">{number(result.page)}</span> من <span className="num">{number(result.total_pages)}</span> · <span className="num">{number(result.total)}</span> مواطن</span><div><button className="icon-button" aria-label="الصفحة السابقة" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}><ChevronRight size={18} /></button><button className="icon-button" aria-label="الصفحة التالية" disabled={filters.page >= result.total_pages} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}><ChevronLeft size={18} /></button></div></footer>}
        </section>}
    {target && <ModalShell label="حالة حساب المواطن" icon={target.is_active ? Ban : RotateCcw} danger={target.is_active} onClose={() => !busy && setTarget(null)}>
      <h3>{target.is_active ? 'إيقاف حساب المواطن؟' : 'إعادة تفعيل حساب المواطن؟'}</h3>
      <p>{target.full_name || 'مواطن'} · <span dir="ltr">{localPhone(target.phone)}</span>. {target.is_active ? 'لن يستطيع الدخول أو إرسال بلاغات جديدة، وسيظهر له أن حسابه موقوف. تبقى بلاغاته السابقة كما هي.' : 'يستطيع الدخول وإرسال البلاغات من جديد.'}</p>
      {target.is_active && <label className="reason-label">سبب الإيقاف<span>إلزامي</span><textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>}
      {formError && <div className="form-error" role="alert"><CircleAlert size={17} />{formError}</div>}
      <div className="modal-actions"><button className={`button ${target.is_active ? 'button-danger' : 'button-gold'}`} disabled={busy || (target.is_active && !reason.trim())} onClick={submit}>{target.is_active ? 'إيقاف الحساب' : 'إعادة التفعيل'}</button><button className="button button-quiet" disabled={busy} onClick={() => setTarget(null)}>إلغاء</button></div>
    </ModalShell>}
  </div>;
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

const tripoliDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' });
const weekday = new Intl.DateTimeFormat('ar-LY', { weekday: 'long' });

// Day headings for the log: اليوم، أمس، then the weekday and date.
function auditDay(value) {
  const date = new Date(value);
  const day = tripoliDay.format(date);
  if (day === tripoliDay.format(new Date())) return { key: day, label: 'اليوم' };
  if (day === tripoliDay.format(new Date(Date.now() - 24 * 3600e3))) return { key: day, label: 'أمس' };
  return { key: day, label: `${weekday.format(date)} · ${dayOnly.format(date)}` };
}

function auditTarget(item) {
  if (!item.target_id) return { name: '—', sub: '' };
  const name = item.target_name || item.target_username || localPhone(item.target_phone);
  const sub = item.target_role === 'citizen' ? localPhone(item.target_phone) : roleNames[item.target_role] || '';
  return { name, sub: sub === name ? '' : sub, ltr: item.target_role === 'citizen' };
}

export function AuditPage({ onMenu }) {
  const [filters, setFilters] = useState({ action: '', page: 1 });
  const [tick, setTick] = useState(0);
  const { result, loading, error } = usePagedList(adminApi.audit, filters, tick);
  const [actionCount, setActionCount] = useState({});
  const [loadedAt, setLoadedAt] = useState(null);
  useEffect(() => {
    let active = true;
    Promise.all(['', ...Object.keys(auditActions)].map((action) => adminApi.audit({ action, limit: 1 }).then((data) => [action, data.total])))
      .then((pairs) => { if (active) setActionCount(Object.fromEntries(pairs)); })
      .catch(() => { if (active) setActionCount({}); });
    return () => { active = false; };
  }, [tick]);
  useEffect(() => { if (result) setLoadedAt(new Date()); }, [result]);
  const groups = [];
  for (const item of result?.items || []) {
    const day = auditDay(item.created_at);
    if (groups[groups.length - 1]?.key !== day.key) groups.push({ ...day, items: [] });
    groups[groups.length - 1].items.push(item);
  }
  return <div className="rl ac">
    <header className="pr-head">
      <div className="pr-title">
        <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={onMenu}><Menu size={22} /></button>
        <div><span className="eyebrow">المساءلة</span>
          <h1>سجل الإجراءات{actionCount[''] !== undefined && <span className="pr-count num">{number(actionCount[''])}</span>}</h1>
          <p>كل إجراء إداري على الحسابات، ومن نفّذه ومتى. السجل لا يُعدّل ولا يُحذف.</p></div>
      </div>
      <button type="button" className="pr-refresh" onClick={() => setTick((n) => n + 1)}>
        <RefreshCw size={16} />{loadedAt ? <>تحديث · <span className="num">{clockTime.format(loadedAt)}</span></> : 'تحديث'}
      </button>
    </header>

    <section className="rl-filters" aria-label="تصفية السجل">
      <div className="rl-stages" role="group" aria-label="نوع الإجراء">
        {[['', 'كل الإجراءات'], ...Object.entries(auditActions)].map(([key, label]) => <button type="button" key={key || 'all'} className={filters.action === key ? 'is-active' : ''} aria-pressed={filters.action === key} onClick={() => setFilters({ action: key, page: 1 })}>
          {label}{actionCount[key] !== undefined && <small className="num">{number(actionCount[key])}</small>}
        </button>)}
      </div>
    </section>

    {loading && !result ? <LoadingState /> : error ? <EmptyState icon={CircleAlert} title="تعذّر تحميل السجل" detail={error} onRetry={() => setTick((n) => n + 1)} />
      : !result?.items.length ? <div className="rl-card rl-empty"><EmptyState icon={History} title="لا توجد إجراءات" detail={filters.action ? 'لا توجد إجراءات من هذا النوع بعد.' : 'ستظهر هنا إجراءات المسؤولين على الحسابات.'} /></div>
        : <section className="rl-card"><div className="rl-scroll"><table className="ac-table is-audit">
          <thead><tr><th scope="col">الوقت</th><th scope="col">الإجراء</th><th scope="col">الحساب</th><th scope="col">بواسطة</th><th scope="col">التفاصيل</th></tr></thead>
          {groups.map((group) => <tbody key={group.key}>
            <tr className="au-day"><th scope="rowgroup" colSpan={5}>{group.label}<small className="num">{number(group.items.length)}</small></th></tr>
            {group.items.map((item) => {
              const target = auditTarget(item);
              const detail = auditDetail(item);
              return <tr key={item.id}>
                <td data-cell="time" className="ac-date"><time dateTime={item.created_at} title={fmtDate(item.created_at)}>{clockTime.format(new Date(item.created_at))}</time></td>
                <td data-cell="action" className="au-action">{auditActions[item.action] || item.action}</td>
                <td data-cell="target"><div className="ac-who"><span><strong>{target.name}</strong>{target.sub && <small className="au-sub" dir={target.ltr ? 'ltr' : undefined}>{target.sub}</small>}</span></div></td>
                <td data-cell="actor" className="au-actor"><span className="ac-label">بواسطة: </span>{item.actor_name || item.actor_username}</td>
                <td data-cell="details" className={`au-detail ${detail === '—' ? 'is-empty' : ''}`}>{detail}</td>
              </tr>;
            })}
          </tbody>)}
        </table></div>
        {result.total_pages > 1 && <footer className="pr-pages"><span>صفحة <span className="num">{number(result.page)}</span> من <span className="num">{number(result.total_pages)}</span> · <span className="num">{number(result.total)}</span> إجراء</span><div><button className="icon-button" aria-label="الصفحة السابقة" disabled={filters.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}><ChevronRight size={18} /></button><button className="icon-button" aria-label="الصفحة التالية" disabled={filters.page >= result.total_pages} onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}><ChevronLeft size={18} /></button></div></footer>}
        </section>}
  </div>;
}

