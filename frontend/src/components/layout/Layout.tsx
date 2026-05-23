import React from 'react';
import { clsx } from 'clsx';
import { Outlet, useLocation } from 'react-router-dom';
import { GlobalAgentAssistant } from '../agents/ProjectAgentWorkspace';
import { Sidebar } from './Sidebar';

export function Layout() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem('smart-design.sidebar-collapsed') === 'true';
  });

  React.useEffect(() => {
    window.localStorage.setItem('smart-design.sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

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
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((current) => !current)} />
      <div
        className={clsx(
          'flex min-w-0 flex-1 flex-col transition-[margin-left] duration-300',
          sidebarCollapsed ? 'ml-20' : 'ml-64',
        )}
      >
        <main className="h-screen overflow-y-auto overflow-x-hidden px-4 py-4 md:px-6 md:py-5">
          <Outlet />
        </main>
      </div>
      <GlobalAgentAssistant currentProjectId={currentProjectId} openSignal={agentOpenSignal} />
    </div>
  );
}
