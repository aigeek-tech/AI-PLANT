import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserCog,
  UsersRound,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../auth/AuthProvider';
import {
  AUTH_REQUIRED_EVENT,
  createUser,
  downloadUsersExport,
  listRoles,
  listUsers,
  resetUserPassword,
  updateUser,
  updateUserSystemRoles,
  type AuthRoleSummary,
  type AuthUserSummary,
  type UserCreatePayload,
} from '../../lib/api';
import {
  primaryButtonClass,
  secondaryButtonClass,
  softPrimaryButtonClass,
} from '../../components/ui/buttonStyles';
import { UserImportDialog } from '../../components/settings/UserImportDialog';
import { SearchableSelect } from '../../components/ui/SearchableSelect';

const SYSTEM_ROLE_HINTS: Record<string, string> = {
  system_admin: '系统管理员：用户、角色、标准、项目、项目基础信息与 AI 设置全权限。',
  standard_admin: '标准管理员：维护标准库、位号类型、文档类型与 PBS 模板。',
  project_creator: '项目创建者：可以创建项目，创建后自动成为项目 Owner。',
};

const PERMISSION_LABELS: Record<string, string> = {
  'system.user.manage': '用户管理',
  'system.role.manage': '角色查看',
  'system.audit.read': '审计日志',
  'system.settings.branding.read': '查看项目基础信息',
  'system.settings.branding.write': '维护项目基础信息',
  'system.settings.ai.read': '查看 AI 设置',
  'system.settings.ai.write': '维护 AI 设置',
  'system.plugin.manage': '管理插件',
  'project.create': '创建项目',
  'standard.read': '查看标准',
  'standard.write': '维护标准',
  'project.read': '查看项目',
  'project.delete': '删除项目',
  'project.update': '编辑项目',
  'project.member.manage': '项目成员',
  'project.pbs.read': '查看 PBS',
  'project.pbs.write': '维护 PBS',
  'project.tag.read': '查看 TAG',
  'project.tag.write': '维护 TAG',
  'project.tag.import': '导入 TAG',
  'project.document.read': '查看图纸',
  'project.document.write': '维护图纸',
  'project.document.upload': '上传图纸',
  'project.relation.read': '查看关系',
  'project.relation.write': '维护关系',
};

interface UserDraft {
  username: string;
  display_name: string;
  email: string;
  password: string;
  status: 'active' | 'disabled';
}

const EMPTY_USER_DRAFT: UserDraft = {
  username: '',
  display_name: '',
  email: '',
  password: '',
  status: 'active',
};

function roleDisplayName(role: AuthRoleSummary) {
  if (role.code === 'system_admin') return '系统管理员';
  if (role.code === 'standard_admin') return '标准管理员';
  if (role.code === 'project_creator') return '项目创建者';
  if (role.code === 'project_owner') return '项目 Owner';
  if (role.code === 'project_editor') return '项目编辑';
  if (role.code === 'project_viewer') return '项目查看';
  return role.name;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export function AccessManagementPage() {
  const navigate = useNavigate();
  const { success, error: showError } = useToast();
  const { auth, can } = useAuth();
  const canManageUsers = can('system.user.manage');
  const canManageRoles = can('system.role.manage');
  const [activeTab, setActiveTab] = useState<'users' | 'roles'>(canManageUsers ? 'users' : 'roles');
  const [users, setUsers] = useState<AuthUserSummary[]>([]);
  const [roles, setRoles] = useState<AuthRoleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportingUsers, setIsExportingUsers] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUserSummary | null>(null);
  const [passwordResetUser, setPasswordResetUser] = useState<AuthUserSummary | null>(null);
  const [roleEditingUser, setRoleEditingUser] = useState<AuthUserSummary | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const systemRoles = useMemo(() => roles.filter((role) => role.scope_kind === 'system'), [roles]);
  const projectRoles = useMemo(() => roles.filter((role) => role.scope_kind === 'project'), [roles]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const tasks: Promise<unknown>[] = [];
      if (canManageUsers) {
        tasks.push(listUsers().then((nextUsers) => setUsers(nextUsers)));
      } else {
        setUsers([]);
      }
      if (canManageRoles) {
        tasks.push(listRoles().then((nextRoles) => setRoles(nextRoles)));
      } else {
        setRoles([]);
      }
      await Promise.all(tasks);
    } catch (loadError) {
      showError(loadError instanceof Error ? loadError.message : '加载访问管理数据失败');
    } finally {
      setIsLoading(false);
    }
  }, [canManageRoles, canManageUsers, showError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateUser = async (payload: UserCreatePayload) => {
    try {
      await createUser(payload);
      success('账号已创建。');
      setIsCreateOpen(false);
      await loadData();
    } catch (createError) {
      showError(createError instanceof Error ? createError.message : '创建账号失败');
    }
  };

  const handleUpdateUser = async (userId: string, payload: UserDraft) => {
    setSavingUserId(userId);
    try {
      await updateUser(userId, {
        display_name: payload.display_name,
        email: payload.email || null,
        status: payload.status,
      });
      success('账号资料已保存。');
      setEditingUser(null);
      await loadData();
    } catch (updateError) {
      showError(updateError instanceof Error ? updateError.message : '保存账号失败');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleResetPassword = async (userId: string, newPassword: string) => {
    setSavingUserId(userId);
    try {
      await resetUserPassword(userId, newPassword);
      const isSelfReset = auth?.user.id === userId;
      success(isSelfReset ? '密码已重置，请重新登录。' : '密码已重置，目标用户需使用新密码登录。');
      setPasswordResetUser(null);
      if (isSelfReset) {
        window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
        navigate('/login', { replace: true });
        return;
      }
      await loadData();
    } catch (resetError) {
      showError(resetError instanceof Error ? resetError.message : '重置密码失败');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleSaveSystemRoles = async (userId: string, roleCodes: string[]) => {
    setSavingUserId(userId);
    try {
      await updateUserSystemRoles(userId, roleCodes);
      success('系统角色已更新。');
      setRoleEditingUser(null);
      await loadData();
    } catch (roleError) {
      showError(roleError instanceof Error ? roleError.message : '保存系统角色失败');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleExportUsers = async () => {
    setIsExportingUsers(true);
    try {
      const blob = await downloadUsersExport();
      downloadBlob(blob, 'users-export.xlsx');
      success('用户导出已开始下载。');
    } catch (exportError) {
      showError(exportError instanceof Error ? exportError.message : '导出用户失败');
    } finally {
      setIsExportingUsers(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.24em] text-adnoc-blue">ACCESS CONTROL</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">系统访问管理</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            管理账号、系统角色和权限说明。项目级角色请进入项目详情页由项目 Owner 分配。
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void loadData()} className={secondaryButtonClass}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
          {canManageUsers && (
            <>
              <button type="button" onClick={handleExportUsers} disabled={isExportingUsers} className={secondaryButtonClass}>
                {isExportingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                导出用户
              </button>
              <button type="button" onClick={() => setIsImportOpen(true)} className={secondaryButtonClass}>
                <Upload className="h-4 w-4" />
                批量导入
              </button>
            </>
          )}
          {canManageUsers && (
            <button type="button" onClick={() => setIsCreateOpen(true)} className={primaryButtonClass}>
              <Plus className="h-4 w-4" />
              新建账号
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={<UsersRound className="h-5 w-5" />} label="账号数" value={String(users.length)} />
        <MetricCard icon={<ShieldCheck className="h-5 w-5" />} label="系统角色" value={String(systemRoles.length)} />
        <MetricCard icon={<KeyRound className="h-5 w-5" />} label="项目角色模板" value={String(projectRoles.length)} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/70 p-1 shadow-sm backdrop-blur-sm">
        {canManageUsers && (
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeTab === 'users' ? 'bg-adnoc-blue text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            用户管理
          </button>
        )}
        {canManageRoles && (
          <button
            type="button"
            onClick={() => setActiveTab('roles')}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${activeTab === 'roles' ? 'bg-adnoc-blue text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            角色说明
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-56 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-adnoc-blue" />
        </div>
      ) : activeTab === 'users' && canManageUsers ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-4">用户</th>
                  <th className="px-5 py-4">邮箱</th>
                  <th className="px-5 py-4">状态</th>
                  <th className="px-5 py-4">系统角色</th>
                  <th className="px-5 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id} className="bg-white/80 transition hover:bg-blue-50/40">
                    <td className="px-5 py-4">
                      <div className="font-bold text-slate-900">{user.display_name}</div>
                      <div className="mt-1 font-mono text-xs text-slate-400">{user.username}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{user.email || '-'}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${user.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {user.status === 'active' ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <RoleChips roleCodes={user.role_codes ?? []} roles={roles} emptyText="未分配系统角色" />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {canManageRoles && (
                          <button type="button" onClick={() => setRoleEditingUser(user)} className={softPrimaryButtonClass}>
                            分配角色
                          </button>
                        )}
                        <button type="button" onClick={() => setEditingUser(user)} className={secondaryButtonClass}>
                          编辑账号
                        </button>
                        <button type="button" onClick={() => setPasswordResetUser(user)} className={secondaryButtonClass}>
                          <KeyRound className="h-4 w-4" />
                          重置密码
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-16 text-center text-slate-400">暂无账号。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.map((role) => (
            <Card key={role.id} className="border-slate-200/70 bg-white/80">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="rounded-xl bg-blue-50 p-2 text-adnoc-blue">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-black text-slate-900">{roleDisplayName(role)}</h3>
                      <p className="font-mono text-xs text-slate-400">{role.code}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-500">
                    {SYSTEM_ROLE_HINTS[role.code] || (role.scope_kind === 'project' ? '项目内角色模板，由项目 Owner 在项目详情中分配。' : '内置角色模板。')}
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-500">
                  {role.scope_kind === 'system' ? '系统' : role.scope_kind === 'project' ? '项目' : '标准'}
                </span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {role.permissions.map((permission) => (
                  <span key={permission} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {PERMISSION_LABELS[permission] || permission}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {isCreateOpen && canManageUsers && (
        <UserFormModal
          title="新建账号"
          submitText="创建账号"
          requirePassword
          onClose={() => setIsCreateOpen(false)}
          onSubmit={(draft) => handleCreateUser({
            username: draft.username,
            display_name: draft.display_name,
            email: draft.email || null,
            password: draft.password,
            status: draft.status,
          })}
        />
      )}

      {editingUser && canManageUsers && (
        <UserFormModal
          title={`编辑账号 / ${editingUser.display_name}`}
          submitText="保存账号"
          initialDraft={{
            username: editingUser.username,
            display_name: editingUser.display_name,
            email: editingUser.email ?? '',
            password: '',
            status: editingUser.status,
          }}
          isSaving={savingUserId === editingUser.id}
          onClose={() => setEditingUser(null)}
          onSubmit={(draft) => handleUpdateUser(editingUser.id, draft)}
        />
      )}

      {passwordResetUser && canManageUsers && (
        <PasswordResetModal
          user={passwordResetUser}
          isSaving={savingUserId === passwordResetUser.id}
          onClose={() => setPasswordResetUser(null)}
          onSubmit={(newPassword) => handleResetPassword(passwordResetUser.id, newPassword)}
        />
      )}

      {roleEditingUser && canManageRoles && (
        <SystemRoleModal
          user={roleEditingUser}
          roles={systemRoles}
          isSaving={savingUserId === roleEditingUser.id}
          onClose={() => setRoleEditingUser(null)}
          onSubmit={(roleCodes) => handleSaveSystemRoles(roleEditingUser.id, roleCodes)}
        />
      )}

      {isImportOpen && canManageUsers && (
        <UserImportDialog
          open={isImportOpen}
          roles={roles}
          canManageRoles={canManageRoles}
          onClose={() => setIsImportOpen(false)}
          onImported={() => {
            void loadData();
          }}
        />
      )}
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="border-white/70 bg-white/70 shadow-lg shadow-slate-200/60 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold tracking-widest text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{value}</p>
        </div>
        <div className="rounded-2xl bg-blue-50 p-3 text-adnoc-blue">{icon}</div>
      </div>
    </Card>
  );
}

function RoleChips({ roleCodes, roles, emptyText }: { roleCodes: string[]; roles: AuthRoleSummary[]; emptyText: string }) {
  if (roleCodes.length === 0) {
    return <span className="text-xs text-slate-400">{emptyText}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {roleCodes.map((code) => {
        const role = roles.find((item) => item.code === code);
        return (
          <span key={code} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-adnoc-blue">
            {role ? roleDisplayName(role) : code}
          </span>
        );
      })}
    </div>
  );
}

function UserFormModal({
  title,
  submitText,
  initialDraft = EMPTY_USER_DRAFT,
  requirePassword = false,
  isSaving = false,
  onClose,
  onSubmit,
}: {
  title: string;
  submitText: string;
  initialDraft?: UserDraft;
  requirePassword?: boolean;
  isSaving?: boolean;
  onClose: () => void;
  onSubmit: (draft: UserDraft) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<UserDraft>(initialDraft);
  const passwordValue = draft.password.trim();
  const showPasswordField = requirePassword;
  const passwordIsValid = showPasswordField ? passwordValue.length >= 8 : true;
  const showPasswordError = showPasswordField && passwordValue.length > 0 && !passwordIsValid;
  const canSubmit = draft.username.trim() && draft.display_name.trim() && passwordIsValid;

  const updateDraft = (key: keyof UserDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSaving) return;
    void onSubmit({
      ...draft,
      username: draft.username.trim(),
      display_name: draft.display_name.trim(),
      email: draft.email.trim(),
      password: draft.password.trim(),
    });
  };

  const modalContent = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-form-modal-title"
        className="w-full max-w-xl max-h-[min(90vh,760px)] overflow-y-auto rounded-[2rem] border border-white/70 bg-white/95 p-8 shadow-2xl shadow-slate-900/20 backdrop-blur-xl"
      >
        <h2 id="user-form-modal-title" className="text-2xl font-black text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">
          {requirePassword ? '请填写账号基础信息并设置初始密码，密码至少 8 位。' : '修改账号基础资料。密码请使用列表中的重置密码操作。'}
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-bold tracking-widest text-slate-500">用户名</span>
            <input
              autoFocus={requirePassword}
              value={draft.username}
              disabled={!requirePassword}
              onChange={(event) => updateDraft('username', event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10 disabled:bg-slate-50 disabled:text-slate-400"
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold tracking-widest text-slate-500">显示名称</span>
            <input
              autoFocus={!requirePassword}
              value={draft.display_name}
              onChange={(event) => updateDraft('display_name', event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
              required
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-bold tracking-widest text-slate-500">邮箱</span>
            <input
              value={draft.email}
              onChange={(event) => updateDraft('email', event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
              type="email"
            />
          </label>
          {showPasswordField && (
            <label className="block">
              <span className="text-xs font-bold tracking-widest text-slate-500">密码</span>
              <input
                value={draft.password}
                onChange={(event) => updateDraft('password', event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
                type="password"
                required={requirePassword}
              />
              {showPasswordError && <p className="mt-2 text-xs font-medium text-red-600">密码至少需要 8 位。</p>}
            </label>
          )}
          <label className="block">
            <span className="text-xs font-bold tracking-widest text-slate-500">状态</span>
            <SearchableSelect
              value={draft.status}
              onChange={(nextValue) => updateDraft('status', nextValue as UserDraft['status'])}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
              searchPlaceholder="搜索状态"
            />
          </label>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
          <button type="submit" disabled={!canSubmit || isSaving} className={primaryButtonClass}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitText}
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(modalContent, document.body);
}

function PasswordResetModal({
  user,
  isSaving,
  onClose,
  onSubmit,
}: {
  user: AuthUserSummary;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (newPassword: string) => void | Promise<void>;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const trimmedNewPassword = newPassword.trim();
  const trimmedConfirmPassword = confirmPassword.trim();
  const passwordTooShort = trimmedNewPassword.length > 0 && trimmedNewPassword.length < 8;
  const passwordMismatch = trimmedConfirmPassword.length > 0 && trimmedNewPassword !== trimmedConfirmPassword;
  const canSubmit = trimmedNewPassword.length >= 8 && trimmedNewPassword === trimmedConfirmPassword;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSaving) return;
    void onSubmit(trimmedNewPassword);
  };

  const modalContent = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-reset-modal-title"
        className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/95 p-8 shadow-2xl shadow-slate-900/20 backdrop-blur-xl"
      >
        <h2 id="password-reset-modal-title" className="text-2xl font-black text-slate-900">重置密码</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {user.display_name} / {user.username}。保存后该账号的已登录会话会失效。
        </p>
        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-bold tracking-widest text-slate-500">新密码</span>
            <input
              autoFocus
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
              type="password"
              autoComplete="new-password"
              required
            />
            {passwordTooShort && <p className="mt-2 text-xs font-medium text-red-600">密码至少需要 8 位。</p>}
          </label>
          <label className="block">
            <span className="text-xs font-bold tracking-widest text-slate-500">确认新密码</span>
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
              type="password"
              autoComplete="new-password"
              required
            />
            {passwordMismatch && <p className="mt-2 text-xs font-medium text-red-600">两次输入的新密码不一致。</p>}
          </label>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
          <button type="submit" disabled={!canSubmit || isSaving} className={primaryButtonClass}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            保存密码
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(modalContent, document.body);
}

function SystemRoleModal({
  user,
  roles,
  isSaving,
  onClose,
  onSubmit,
}: {
  user: AuthUserSummary;
  roles: AuthRoleSummary[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (roleCodes: string[]) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(user.role_codes ?? []));

  const toggleRole = (roleCode: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(roleCode)) {
        next.delete(roleCode);
      } else {
        next.add(roleCode);
      }
      return next;
    });
  };

  const modalContent = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-role-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-2xl max-h-[min(88vh,820px)] flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white/95 p-8 shadow-2xl shadow-slate-900/20 backdrop-blur-xl"
      >
        <h2 id="system-role-modal-title" className="text-2xl font-black text-slate-900">分配系统角色</h2>
        <p className="mt-2 text-sm text-slate-500">{user.display_name} / {user.username}</p>
        <div className="mt-6 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {roles.map((role) => (
            <label key={role.code} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:border-adnoc-blue/40 hover:bg-blue-50/40">
              <input
                type="checkbox"
                checked={selected.has(role.code)}
                onChange={() => toggleRole(role.code)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-adnoc-blue focus:ring-adnoc-blue"
              />
              <div>
                <div className="font-bold text-slate-900">{roleDisplayName(role)}</div>
                <p className="mt-1 text-sm text-slate-500">{SYSTEM_ROLE_HINTS[role.code] || role.name}</p>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
          <button type="button" onClick={() => void onSubmit([...selected])} disabled={isSaving} className={primaryButtonClass}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
            保存角色
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
