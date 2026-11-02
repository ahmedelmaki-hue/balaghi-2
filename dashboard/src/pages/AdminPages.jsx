// Account administration: staff and workers, citizens, and the audit log.
import React, { useEffect, useState } from 'react';
import {
  Ban, CircleAlert, Contact, Copy, History, KeyRound, Pencil, RotateCcw, Search, UserCog, UserPlus, Users,
} from 'lucide-react';
import { adminApi } from '../api.js';
import { permissionNames, manageableRoles, accountsLabel, roleNames, auditActions, accountRoleName, fmtDate, number, errorText, EmptyState, LoadingState, PageHeading, agencyNames, localPhone, ModalShell, Pagination } from '../shared.jsx';

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

function AccountStatus({ account }) {
  return <span className="account-status">
    <span className={`status-pill ${account.is_active ? 'resolved' : 'rejected'}`}><i />{account.is_active ? 'نشط' : 'معطّل'}</span>
    {account.is_active && account.must_change_password && <small className="account-flag">بانتظار تغيير كلمة المرور</small>}
    {!account.is_active && account.deactivated_reason && <small className="account-reason">{account.deactivated_reason}</small>}
  </span>;
}

export function AccountsPage({ user, onMenu, onToast }) {
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

export function AuditPage({ onMenu }) {
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

