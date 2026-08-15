import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const navigation = [
  { to: '/today', icon: '☀', label: '오늘' },
  { to: '/inbox', icon: '✉', label: '받은 제안' },
  { to: '/deals', icon: '▦', label: '거래 관리' },
  { to: '/proposals', icon: '✦', label: '직접 분석' },
  { to: '/dashboard', icon: '◫', label: '재무 관리' },
  { to: '/settings', icon: '⚙', label: '설정' },
];

const pageNames: Record<string, string> = { '/today': '오늘', '/inbox': '받은 제안', '/deals': '거래 관리', '/proposals': '직접 분석', '/dashboard': '재무 관리', '/settings': '설정' };

export default function AppShell() {
  const { nickname, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('propaid-sidebar-collapsed') === 'true');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const today = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());

  useEffect(() => setMobileMenuOpen(false), [location.pathname]);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      localStorage.setItem('propaid-sidebar-collapsed', String(!current));
      return !current;
    });
  };

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${mobileMenuOpen ? ' mobile-menu-open' : ''}`}>
      <button className="sidebar-backdrop" aria-label="메뉴 닫기" onClick={() => setMobileMenuOpen(false)} />
      <aside className="sidebar" aria-label="사이드 메뉴">
        <div className="sidebar-head">
          <NavLink className="brand" to="/today"><span className="brand-mark"><img src="/favicon.svg" alt="" /></span><span className="brand-name">Propaid</span></NavLink>
          <button className="sidebar-toggle" type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'} title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}>
            <span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span>
          </button>
          <button className="mobile-close" type="button" onClick={() => setMobileMenuOpen(false)} aria-label="메뉴 닫기">×</button>
        </div>
        <p className="sidebar-caption">WORKSPACE</p>
        <nav className="sidebar-nav" aria-label="주요 메뉴">
          {navigation.map((item) => <NavLink key={item.to} to={item.to} title={sidebarCollapsed ? item.label : undefined} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span></NavLink>)}
        </nav>
        <div className="sidebar-user">
          <div className="user-name">{nickname || 'Propaid 사용자'}</div><div className="user-plan">FREE workspace</div>
          <NavLink className="logout-button" to="/settings" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>설정</NavLink>
          <button className="logout-button" onClick={() => { logout(); navigate('/login'); }}>로그아웃</button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-leading"><button className="mobile-menu-toggle" type="button" onClick={() => setMobileMenuOpen(true)} aria-label="메뉴 열기">☰</button><span className="topbar-title">{pageNames[location.pathname] || 'Propaid'}</span></div>
          <span className="topbar-date">{today}</span>
        </header>
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
