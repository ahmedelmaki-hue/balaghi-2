import React, { useEffect, useState } from 'react';
import {
  CalendarDays, Check, UserRound, X,
} from 'lucide-react';
import { fetchMe, logout, restoreSession, staffApi } from './api.js';
import { navigation, adminNavigation, allowedAdminPages } from './shared.jsx';
import { Sidebar } from './Sidebar.jsx';
import { LoginScreen, ForcedPasswordScreen, PasswordModal } from './accountScreens.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { PendingReviewPage, ReportsPage } from './pages/QueuePages.jsx';
import { StatsPage } from './pages/StatsPage.jsx';
import { MapPage } from './pages/MapPage.jsx';
import { DetailDrawer } from './DetailDrawer.jsx';
import { FieldWorkerPage } from './pages/FieldWorkerPage.jsx';
import { AccountsPage, CitizensPage, AuditPage } from './pages/AdminPages.jsx';

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
  // An owner may change this account's role or permissions while it is signed in.
  // Check the server's view every minute and when the window regains focus, so
  // the menu follows without signing out; the server enforces them regardless.
  useEffect(() => {
    if (!user || user.must_change_password) return undefined;
    let active = true;
    const access = (account) => JSON.stringify([account.role, account.is_owner,
      [...(account.admin_permissions || [])].sort(), account.full_name]);
    const sync = () => fetchMe().then((fresh) => {
      if (active && fresh) setUser((current) => (current && access(current) !== access(fresh) ? { ...current, ...fresh } : current));
    }).catch(() => {});
    const timer = setInterval(sync, 60000);
    window.addEventListener('focus', sync);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', sync); };
  }, [user?.id, user?.must_change_password]);
  // A page whose permission was withdrawn falls back to the overview.
  useEffect(() => {
    if (user && adminNavigation.some((item) => item.key === page) &&
        !allowedAdminPages(user).some((item) => item.key === page)) setPage('overview');
  }, [user, page]);
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
