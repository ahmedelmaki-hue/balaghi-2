// The signed-in account's card: who they are, what they may do, password and sign-out.
// Opened from the name in the sidebar or in the top strip.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, KeyRound, LogOut, ShieldCheck, X } from 'lucide-react';
import { accountRoleName, agencies, permissionNames } from './shared.jsx';

// What a reviewing staff member can do; administrators can do all of it too.
const reviewAbilities = [
  'مراجعة البلاغات واعتمادها أو رفضها',
  'طلب التحقق الميداني وتصحيح التصنيف والموقع',
  'حسم ملاحظات العمال وتأكيد الحل',
];

const workerAbilities = [
  'استلام بلاغات جهتك وبدء العمل عليها',
  'إرسال ملاحظة ميدانية عن البلاغ',
  'توثيق إنجاز العمل بصورة بعد الإصلاح',
  'الرد على طلبات التحقق قبل الاعتماد',
];

function abilities(user) {
  if (user.role === 'field_worker') return workerAbilities;
  if (user.role !== 'admin') return reviewAbilities;
  if (user.is_owner) return [...reviewAbilities, 'إدارة المسؤولين وصلاحياتهم', ...Object.values(permissionNames)];
  return [...reviewAbilities, ...(user.admin_permissions || []).map((key) => permissionNames[key]).filter(Boolean)];
}

const initial = (name) => (name || '').trim().charAt(0) || '؟';

export function AccountMenu({ user, onPassword, onLogout, onAction, placement = 'below', className = '', children }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const trigger = useRef(null);
  const card = useRef(null);
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  // The card is portalled to <body> (the mobile sidebar is transformed, which would
  // trap a fixed child), so it is placed from the trigger's box.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect();
    setPosition(placement === 'above'
      ? { right: window.innerWidth - box.right, bottom: window.innerHeight - box.top + 8 }
      : { left: box.left, top: box.bottom + 8 });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return undefined;
    card.current?.querySelector('button')?.focus();
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    const onPointer = (event) => {
      if (!card.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const act = (handler) => () => { setOpen(false); onAction?.(); handler(); };
  const name = user.full_name || user.staff_username;
  const style = position && Object.fromEntries(Object.entries(position).map(([key, value]) => [`--account-${key}`, `${Math.round(value)}px`]));

  return <>
    <button type="button" ref={trigger} className={`account-trigger ${className}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen((value) => !value)}>
      {children}<ChevronDown size={15} className="account-chevron" />
    </button>
    {open && position && createPortal(<>
      <div className="account-scrim" aria-hidden="true" />
      <section ref={card} className={`account-card is-${placement}`} style={style} role="dialog" aria-label="بيانات الحساب">
        <header className="account-head">
          <span className="account-avatar" aria-hidden="true">{initial(name)}</span>
          <span className="account-who"><strong>{name}</strong><em>{accountRoleName(user)}</em></span>
          <button type="button" className="account-close" aria-label="إغلاق" onClick={() => close()}><X size={18} /></button>
        </header>
        <dl className="account-facts">
          <div><dt>اسم المستخدم</dt><dd dir="ltr">{user.staff_username || '—'}</dd></div>
          <div><dt>الدور</dt><dd>{accountRoleName(user)}</dd></div>
          {user.agency && <div><dt>الجهة</dt><dd>{agencies[user.agency] || user.agency}</dd></div>}
        </dl>
        <div className="account-abilities">
          <h3><ShieldCheck size={15} />الصلاحيات{user.role === 'admin' && user.is_owner && <small>كل الصلاحيات</small>}</h3>
          <ul>{abilities(user).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <footer className="account-actions">
          <button type="button" onClick={act(onPassword)}><KeyRound size={17} />تغيير كلمة المرور</button>
          <button type="button" className="is-logout" onClick={act(onLogout)}><LogOut size={17} />تسجيل الخروج</button>
        </footer>
      </section>
    </>, document.body)}
  </>;
}
