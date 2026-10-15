import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight, ChevronRight, LayoutDashboard, LoaderCircle, LogOut, Menu, Network, RefreshCw, Server, UserRound, X,
} from 'lucide-react';
import { ApiError, api, errorMessage, isUnauthorized } from './api';
import { Brand, Button, Message, ThemeToggle } from './components';
import { NodesPage, OverviewPage, ServicesPage } from './pages';

type View = 'overview' | 'nodes' | 'services';
const navigation = [
  { id: 'overview' as const, label: '运行概览', icon: LayoutDashboard },
  { id: 'nodes' as const, label: '节点管理', icon: Network },
  { id: 'services' as const, label: '服务管理', icon: Server },
];

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [session, setSession] = useState<'checking' | 'signed-in' | 'signed-out'>('checking');
  const [account, setAccount] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutRequest = useRef<AbortController | null>(null);
  const expireSession = useCallback(() => {
    setSession('signed-out');
    setAccount('');
    setSessionError('登录已失效，请重新登录。');
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const background = getComputedStyle(root).getPropertyValue('--canvas').trim();
    root.style.backgroundColor = background;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
    try { localStorage.setItem('cloudnet-web-theme', theme); } catch { /* Keep switching available if storage is blocked. */ }
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    api.status(controller.signal).then(() => {
      if (!controller.signal.aborted) setSession('signed-in');
    }).catch(error => {
      if (controller.signal.aborted) return;
      // A forbidden resource still confirms that REST accepted the session.
      if (error instanceof ApiError && error.status === 403) {
        setSession('signed-in');
      } else {
        setSession('signed-out');
        if (!isUnauthorized(error)) setSessionError(errorMessage(error));
      }
    });
    return () => { controller.abort(); logoutRequest.current?.abort(); };
  }, []);

  async function logout() {
    const controller = new AbortController();
    logoutRequest.current = controller;
    setLoggingOut(true);
    try {
      await api.logout(controller.signal);
      setSession('signed-out');
      setAccount('');
      setSessionError('');
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isUnauthorized(error)) expireSession();
      else setSessionError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setLoggingOut(false);
    }
  }

  const themeToggle = <ThemeToggle dark={theme === 'dark'}
    onToggle={() => setTheme(value => value === 'dark' ? 'light' : 'dark')} />;

  if (session === 'checking') return <div className="session-loading"><Brand />
    <LoaderCircle size={22} className="spin" /><span>加载中…</span></div>;
  if (session === 'signed-out') return <Login themeToggle={themeToggle} initialError={sessionError} onLogin={username => {
    setAccount(username); setSessionError(''); setSession('signed-in');
  }} />;
  return <Workspace account={account} onUnauthorized={expireSession} onLogout={() => void logout()}
    loggingOut={loggingOut} error={sessionError} themeToggle={themeToggle} />;
}

function Login({ initialError, onLogin, themeToggle }:
  { initialError: string; onLogin: (username: string) => void; themeToggle: ReactNode }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError('');
    try {
      await api.login(username.trim(), password, controller.signal);
      if (!controller.signal.aborted) { setPassword(''); onLogin(username.trim()); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="login-page"><div className="login-theme-toggle">{themeToggle}</div>
    <main className="login-form-wrap"><Brand />
      <h1>登录 CloudNet</h1><p className="login-description">使用 CloudNet 账号登录</p>
      <Message>{error || initialError}</Message>
      <form onSubmit={event => void submit(event)} className="login-form">
        <label>用户名<input name="username" autoComplete="username" value={username}
          onChange={event => setUsername(event.target.value)} required disabled={busy} placeholder="CloudNet 用户名" /></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" value={password}
          onChange={event => setPassword(event.target.value)} required disabled={busy} placeholder="输入密码" /></label>
        <Button type="submit" variant="primary" busy={busy}>登录{!busy && <ArrowRight size={17} />}</Button>
      </form>
    </main></div>;
}

function Workspace({ account, onUnauthorized, onLogout, loggingOut, error, themeToggle }:
  { account: string; onUnauthorized: () => void; onLogout: () => void; loggingOut: boolean; error: string;
    themeToggle: ReactNode }) {
  const [view, setView] = useState<View>('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [nodeFilter, setNodeFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function navigate(next: View) { setSelectedId(null); setView(next); setMobileNav(false); }
  function openService(id: string) { setSelectedId(id); setView('services'); setMobileNav(false); }
  function openNode(id: string) { setNodeFilter(id); navigate('services'); }
  const props = { onUnauthorized, refreshToken };

  return <div className="app-shell">
    {mobileNav && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand /><Button variant="ghost" className="mobile-only icon-button"
        onClick={() => setMobileNav(false)} aria-label="关闭导航"><X size={19} /></Button></div>
      <div className="workspace-label"><span className="workspace-icon"><Network size={16} /></span>
        <div><strong>运维工作区</strong><small>CloudNet 3.4.5</small></div><span className="workspace-badge">WEB</span></div>
      <span className="nav-section-label">工作空间</span>
      <nav aria-label="主导航">{navigation.map(item => <button key={item.id}
        className={`nav-item ${view === item.id ? 'nav-item-active' : ''}`}
        aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
        <item.icon size={18} /><span>{item.label}</span>{view === item.id && <ChevronRight size={15} />}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="sidebar-session"><span className="status-dot" />会话已连接<span>REST v1</span></div>
      </div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs">
      <Button variant="ghost" className="mobile-only icon-button" onClick={() => setMobileNav(true)} aria-label="打开导航">
        <Menu size={20} /></Button><span>工作空间</span><ChevronRight size={14} />
      <strong>{navigation.find(item => item.id === view)?.label}</strong>
    </div><div className="topbar-actions">{themeToggle}<Button variant="ghost" onClick={() => setRefreshToken(value => value + 1)}
      aria-label="刷新当前页面"><RefreshCw size={16} /><span className="desktop-label">刷新</span></Button>
      <span className="topbar-divider" /><span className="account-avatar"><UserRound size={16} /></span>
      <span className="account-name">{account || '管理会话'}</span><Button variant="ghost" className="icon-button"
        onClick={onLogout} busy={loggingOut} aria-label="退出登录">{!loggingOut && <LogOut size={17} />}</Button>
    </div></header>
      <main className="page-content"><Message>{error}</Message>
        {view === 'overview' && <OverviewPage {...props} onOpenService={openService} onOpenNode={openNode}
          onServices={() => navigate('services')} onNodes={() => navigate('nodes')} />}
        {view === 'nodes' && <NodesPage {...props} onOpenNode={openNode} />}
        {view === 'services' && <ServicesPage {...props} nodeFilter={nodeFilter} setNodeFilter={setNodeFilter}
          selectedId={selectedId} onSelect={setSelectedId} />}
      </main>
    </div>
  </div>;
}
