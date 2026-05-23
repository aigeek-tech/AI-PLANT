import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BellRing, CalendarDays, LogOut, Package, PanelLeftClose, PanelLeftOpen, Settings, UserRound } from 'lucide-react';
import { clsx } from 'clsx';
import aigeekLogo from '../../assets/aigeek-logo.png';
import { useAuth } from '../../auth/AuthProvider';
import { useBranding } from '../../branding/BrandingProvider';
import { SIDEBAR_NAVIGATION, type SidebarNavigationSection } from './navigation';
import { usePlugins } from '../../plugins/PluginProvider';

const PLUGIN_ICON_MAP = {
  BellRing,
  CalendarDays,
  Package,
  Settings,
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { auth, can, hasAnyProjectPermission, logout } = useAuth();
  const { branding } = useBranding();
  const { navigation: pluginNavigation } = usePlugins();
  const pluginSections = pluginNavigation.reduce<SidebarNavigationSection[]>((sections, item) => {
    const section = sections.find((candidate) => candidate.labelKey === item.sectionLabelKey);
    const icon = PLUGIN_ICON_MAP[item.icon as keyof typeof PLUGIN_ICON_MAP] ?? Settings;
    const navItem = {
      icon,
      labelKey: item.labelKey,
      to: item.to,
      permissions: item.permissions,
      requireAny: item.requireAny,
    };
    if (section) {
      section.items.push(navItem);
      return sections;
    }
    return [...sections, { labelKey: item.sectionLabelKey, items: [navItem] }];
  }, []);
  const navSections = [...SIDEBAR_NAVIGATION, ...pluginSections].map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (!item.permissions || item.permissions.length === 0) {
        return true;
      }
      if (item.requireAny) {
        return item.permissions.some((permission) => can(permission) || hasAnyProjectPermission(permission));
      }
      return item.permissions.every((permission) => can(permission) || hasAnyProjectPermission(permission));
    }),
  }));

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 z-50 flex h-screen flex-col bg-adnoc-blue text-white shadow-xl transition-[width] duration-300',
        collapsed ? 'w-20' : 'w-64',
      )}
    >
      <div className={clsx('flex h-12 items-center border-b border-white/10', collapsed ? 'px-3' : 'px-5')}>
        <div className={clsx('flex min-w-0 flex-1 items-center', collapsed ? 'justify-center' : 'gap-3')}>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white p-1">
            <img src={branding.logo_data_url ?? aigeekLogo} alt={t('navigation.logoAlt', { name: branding.system_name })} className="h-full w-full object-contain" />
          </div>
          <div className={clsx('min-w-0', collapsed && 'hidden')} title={branding.system_name}>
            <h1 className="truncate text-base font-bold tracking-wide">{branding.sidebar_title}</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-300 transition hover:bg-white/10 hover:text-white"
          aria-label={collapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
          title={collapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className={clsx('flex-1 overflow-y-auto py-3', collapsed ? 'px-2' : 'px-3')}>
        {navSections.map((section) => {
          const visibleItems = section.items;

          if (visibleItems.length === 0) {
            return null;
          }

          return (
            <div key={section.labelKey} className="mb-4 last:mb-0">
              {!collapsed && <p className="mb-2 px-3 text-[10px] font-bold tracking-wider text-gray-400">{t(section.labelKey)}</p>}
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const isEndMatch = item.end ?? ['/projects', '/standards'].includes(item.to);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={isEndMatch}
                      title={collapsed ? t(item.labelKey) : undefined}
                      className={({ isActive }) =>
                        clsx(
                          'group flex rounded-lg py-2.5 transition-all duration-200',
                          collapsed ? 'justify-center px-2' : 'items-center gap-3 px-3',
                          isActive
                            ? 'bg-adnoc-light font-medium text-white shadow-md'
                            : 'text-gray-300 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span className="text-sm">{t(item.labelKey)}</span>}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={clsx('border-t border-white/10', collapsed ? 'p-2' : 'p-3')}>
        {auth && (
          <div
            className={clsx(
              'flex rounded-xl border border-white/10 bg-white/5',
              collapsed ? 'flex-col items-center gap-2 px-1 py-2' : 'items-center gap-2 p-2',
            )}
          >
            <div className={clsx('flex min-w-0 items-center', collapsed ? 'justify-center' : 'flex-1 gap-2')}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
                <UserRound className="h-4 w-4" />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <p className="text-[10px] font-bold tracking-wider text-blue-100/60">{t('auth.currentUser')}</p>
                  <p className="truncate text-sm font-semibold text-white" title={auth.user.display_name}>
                    {auth.user.display_name}
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className={clsx(
                'inline-flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-blue-100 transition hover:border-red-200/40 hover:bg-red-500/15 hover:text-white',
                collapsed ? 'h-9 w-9' : 'h-9 gap-1.5 px-3 text-xs font-semibold',
              )}
              aria-label={t('auth.logoutLabel')}
              title={t('auth.logoutLabel')}
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>{t('auth.logout')}</span>}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
