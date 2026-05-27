import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BellRing, CalendarDays, CheckCircle2, KeyRound, Loader2, LogOut, Package, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, UserRound, X } from 'lucide-react';
import { clsx } from 'clsx';
import aigeekLogo from '../../assets/aigeek-logo.png';
import { useAuth } from '../../auth/AuthProvider';
import { useBranding } from '../../branding/BrandingProvider';
import { SIDEBAR_NAVIGATION, type SidebarNavigationSection } from './navigation';
import { usePlugins } from '../../plugins/PluginProvider';
import { useToast } from '../ui/Toast';
import { AUTH_REQUIRED_EVENT, changeCurrentUserPassword } from '../../lib/api';
import type { AuthMeResult } from '../../lib/api';
import { primaryButtonClass, secondaryButtonClass } from '../ui/buttonStyles';

const PLUGIN_ICON_MAP = {
  BellRing,
  CalendarDays,
  Package,
  Settings,
};

interface SidebarProps {
  collapsed: boolean;
  mobileOpen?: boolean;
  onToggle: () => void;
  onCloseMobile?: () => void;
}

export function Sidebar({ collapsed, mobileOpen = false, onToggle, onCloseMobile }: SidebarProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { auth, can, hasAnyProjectPermission, logout } = useAuth();
  const { success, error: showError } = useToast();
  const { branding } = useBranding();
  const { navigation: pluginNavigation } = usePlugins();
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
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

  const handleChangePassword = async (payload: { currentPassword: string; newPassword: string }) => {
    try {
      await changeCurrentUserPassword({
        current_password: payload.currentPassword,
        new_password: payload.newPassword,
      });
      success('密码已修改，请重新登录。');
      setIsAccountModalOpen(false);
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      navigate('/login', { replace: true });
    } catch (changeError) {
      showError(changeError instanceof Error ? changeError.message : '修改密码失败');
    }
  };

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 z-50 flex h-[100dvh] flex-col bg-adnoc-blue text-white shadow-xl transition-[width,transform] duration-300',
        collapsed ? 'lg:w-20' : 'lg:w-64',
        'w-72 max-w-[82vw]',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
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
                      onClick={onCloseMobile}
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
          <div className={clsx('flex gap-2', collapsed ? 'flex-col' : 'items-stretch')}>
            <button
              type="button"
              onClick={() => setIsAccountModalOpen(true)}
              className={clsx(
                'group flex min-w-0 rounded-lg border border-white/10 bg-white/5 text-left transition hover:border-cyan-200/30 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-200/25',
                collapsed ? 'items-center justify-center p-2' : 'flex-1 items-center gap-3 p-2.5',
              )}
              aria-label="打开账户信息"
              title={collapsed ? auth.user.display_name : '打开账户信息'}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-100/15 text-cyan-50 ring-1 ring-white/10 transition group-hover:bg-cyan-100/25">
                <UserRound className="h-4 w-4" />
              </div>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold tracking-wider text-blue-100/55">{t('auth.currentUser')}</p>
                    <p className="truncate text-sm font-semibold text-white" title={auth.user.display_name}>
                      {auth.user.display_name}
                    </p>
                    <p className="truncate text-[11px] text-blue-100/55" title={auth.user.username}>
                      @{auth.user.username}
                    </p>
                  </div>
                  <Settings className="h-4 w-4 shrink-0 text-blue-100/50 transition group-hover:text-cyan-100" />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className={clsx(
                'inline-flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-blue-100 transition hover:border-red-200/40 hover:bg-red-500/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-200/25',
                collapsed ? 'h-11 w-full' : 'w-11',
              )}
              aria-label={t('auth.logoutLabel')}
              title={t('auth.logoutLabel')}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {isAccountModalOpen && auth && (
        <AccountModal
          auth={auth}
          onClose={() => setIsAccountModalOpen(false)}
          onSubmit={handleChangePassword}
        />
      )}
    </aside>
  );
}

function AccountModal({
  auth,
  onClose,
  onSubmit,
}: {
  auth: AuthMeResult;
  onClose: () => void;
  onSubmit: (payload: { currentPassword: string; newPassword: string }) => void | Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const trimmedCurrentPassword = currentPassword.trim();
  const trimmedNewPassword = newPassword.trim();
  const trimmedConfirmPassword = confirmPassword.trim();
  const passwordTooShort = trimmedNewPassword.length > 0 && trimmedNewPassword.length < 8;
  const passwordMismatch = trimmedConfirmPassword.length > 0 && trimmedNewPassword !== trimmedConfirmPassword;
  const canSubmit = trimmedCurrentPassword.length > 0
    && trimmedNewPassword.length >= 8
    && trimmedNewPassword === trimmedConfirmPassword;
  const systemRoleNames = auth.roles.filter((role) => role.scope_kind === 'system').map((role) => role.name);
  const roleSummary = systemRoleNames.length > 0 ? systemRoleNames.join(' / ') : '项目成员';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSaving) return;
    setIsSaving(true);
    try {
      await onSubmit({
        currentPassword: trimmedCurrentPassword,
        newPassword: trimmedNewPassword,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <section
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/25"
      >
        <div className="flex items-start gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-adnoc-blue text-white shadow-sm">
            <UserRound className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="account-dialog-title" className="truncate text-lg font-bold text-slate-950">
              {auth.user.display_name}
            </h2>
            <p className="mt-1 truncate text-sm text-slate-500">@{auth.user.username}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-900"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoItem label="账号" value={auth.user.username} />
            <InfoItem label="状态" value={auth.user.status === 'active' ? '启用' : '停用'} />
            <InfoItem label="角色" value={roleSummary} className="sm:col-span-2" />
            {auth.user.email && <InfoItem label="邮箱" value={auth.user.email} className="sm:col-span-2" />}
          </div>

          <form onSubmit={handleSubmit} className="mt-6 border-t border-slate-200 pt-5">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-adnoc-blue" />
              <h3 className="text-sm font-bold text-slate-900">修改密码</h3>
              <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" />
                保存后需重新登录
              </span>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-bold text-slate-500">当前密码</span>
                <input
                  autoFocus
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
                  type="password"
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">新密码</span>
                <input
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
                  type="password"
                  required
                />
                {passwordTooShort && <p className="mt-2 text-xs font-medium text-red-600">密码至少需要 8 位。</p>}
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">确认新密码</span>
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
                  type="password"
                  required
                />
                {passwordMismatch && <p className="mt-2 text-xs font-medium text-red-600">两次输入的新密码不一致。</p>}
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
              <button type="submit" disabled={!canSubmit || isSaving} className={primaryButtonClass}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                保存密码
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function InfoItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={clsx('rounded-lg border border-slate-200 bg-white px-3 py-2.5', className)}>
      <p className="text-[11px] font-bold text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-800" title={value}>
        {value}
      </p>
    </div>
  );
}
