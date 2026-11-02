// Sign-in, the forced and optional password change.
import React, { useState } from 'react';
import {
  ArrowLeft, CircleAlert, KeyRound, LogOut, MapPin, ShieldCheck, UserRound,
} from 'lucide-react';
import { ApiError, changePassword, login, logout } from './api.js';
import { errorText, Brand, ModalShell } from './shared.jsx';

export function LoginScreen({ onLogin, notice = '' }) {
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

export function ForcedPasswordScreen({ user, onDone, onLogout }) {
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

export function PasswordModal({ onClose, onDone }) {
  return <ModalShell label="تغيير كلمة المرور" icon={KeyRound} onClose={onClose}>
    <h3>تغيير كلمة المرور</h3><p>أدخل كلمة مرورك الحالية ثم اختر كلمة جديدة.</p>
    <PasswordForm onDone={onDone} onCancel={onClose} />
  </ModalShell>;
}

