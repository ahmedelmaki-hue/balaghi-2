// The labelled navigation shown beside every staff and admin page.
import React from 'react';
import {
  KeyRound, LogOut, UserRound, X,
} from 'lucide-react';
import { logout } from './api.js';
import { navigation, allowedAdminPages, accountRoleName, number, Brand } from './shared.jsx';

export function Sidebar({ page, setPage, user, onLogout, onPassword, closeMobile, open, queueCounts }) {
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

