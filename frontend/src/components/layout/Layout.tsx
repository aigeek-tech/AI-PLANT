import React from 'react';
import { clsx } from 'clsx';
import { Menu } from 'lucide-react';
import { Outlet, useLocation } from 'react-router-dom';
import { GlobalAgentAssistant } from '../agents/ProjectAgentWorkspace';
import { Sidebar } from './Sidebar';
import aigeekLogo from '../../assets/aigeek-logo.png';
import { useBranding } from '../../branding/BrandingProvider';

export function Layout() {
  const location = useLocation();
  const { branding } = useBranding();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem('smart-design.sidebar-collapsed') === 'true';
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);

  React.useEffect(() => {
    window.localStorage.setItem('smart-design.sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  React.useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const currentProjectId = React.useMemo(() => {
    const match = location.pathname.match(/^\/projects\/([^/]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    if (location.pathname === '/data-quality') {
      return new URLSearchParams(location.search).get('projectId');
    }
    return null;
  }, [location.pathname, location.search]);

  const agentOpenSignal = React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    return currentProjectId && params.get('view') === 'ai' ? `${location.pathname}${location.search}` : null;
  }, [currentProjectId, location.pathname, location.search]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-gray-50">
      <Sidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onToggle={() => setSidebarCollapsed((current) => !current)}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="关闭导航"
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div
        className={clsx(
          'flex min-w-0 flex-1 flex-col transition-[margin-left] duration-300',
          'ml-0',
          sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64',
        )}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/70 bg-white/85 px-3 shadow-sm backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm"
            aria-label="打开导航"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
              <img src={branding.logo_data_url ?? aigeekLogo} alt="" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-slate-900">{branding.sidebar_title}</div>
              <div className="truncate text-[11px] font-semibold text-slate-500">{branding.system_name}</div>
            </div>
          </div>
          <div className="h-10 w-10" aria-hidden />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 md:px-6 md:py-5">
          <Outlet />
        </main>
      </div>
      <GlobalAgentAssistant currentProjectId={currentProjectId} openSignal={agentOpenSignal} />
    </div>
  );
}
