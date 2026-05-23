import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react';
import {
  listProjectMemberCandidates,
  listProjectMemberRoles,
  listProjectMembers,
  removeProjectMember,
  updateProjectMemberRoles,
  type AuthRoleSummary,
  type AuthUserSummary,
  type ProjectMemberSummary,
} from '../../lib/api';
import { useToast } from '../ui/Toast';
import {
  primaryButtonClass,
  secondaryButtonClass,
  softPrimaryButtonClass,
} from '../ui/buttonStyles';
import { SearchableSelect } from '../ui/SearchableSelect';

function projectRoleLabel(roleCode: string) {
  if (roleCode === 'project_owner') return '项目 Owner';
  if (roleCode === 'project_editor') return '项目编辑';
  if (roleCode === 'project_viewer') return '项目查看';
  return roleCode;
}

export function ProjectMembersDialog({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const { success, error: showError } = useToast();
  const [members, setMembers] = useState<ProjectMemberSummary[]>([]);
  const [candidates, setCandidates] = useState<AuthUserSummary[]>([]);
  const [roles, setRoles] = useState<AuthRoleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRoleCodes, setSelectedRoleCodes] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [nextMembers, nextCandidates, nextRoles] = await Promise.all([
        listProjectMembers(projectId),
        listProjectMemberCandidates(projectId),
        listProjectMemberRoles(projectId),
      ]);
      setMembers(nextMembers);
      setCandidates(nextCandidates);
      setRoles(nextRoles);
    } catch (loadError) {
      showError(loadError instanceof Error ? loadError.message : '加载项目成员失败');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, showError]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadData();
  }, [loadData, open]);

  const filteredCandidates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return candidates;
    return candidates.filter((candidate) =>
      candidate.display_name.toLowerCase().includes(keyword) ||
      candidate.username.toLowerCase().includes(keyword) ||
      (candidate.email ?? '').toLowerCase().includes(keyword),
    );
  }, [candidates, search]);

  const selectedUser = candidates.find((user) => user.id === selectedUserId) ?? null;
  const selectedMember = members.find((member) => member.user.id === selectedUserId) ?? null;

  const handleSelectMember = (member: ProjectMemberSummary) => {
    setSelectedUserId(member.user.id);
    setSelectedRoleCodes(member.role_codes);
  };

  const handleSelectCandidate = (userId: string) => {
    setSelectedUserId(userId);
    const currentMember = members.find((member) => member.user.id === userId);
    setSelectedRoleCodes(currentMember?.role_codes ?? []);
  };

  const toggleRole = (roleCode: string) => {
    setSelectedRoleCodes((current) =>
      current.includes(roleCode) ? current.filter((code) => code !== roleCode) : [...current, roleCode],
    );
  };

  const handleSave = async () => {
    if (!selectedUserId || selectedRoleCodes.length === 0) return;
    setIsSaving(true);
    try {
      await updateProjectMemberRoles(projectId, selectedUserId, selectedRoleCodes);
      success(selectedMember ? '项目成员角色已更新。' : '项目成员已添加。');
      await loadData();
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : '保存项目成员失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedMember) return;
    setIsSaving(true);
    try {
      await removeProjectMember(projectId, selectedMember.user.id);
      success('项目成员已移除。');
      setSelectedUserId('');
      setSelectedRoleCodes([]);
      await loadData();
    } catch (removeError) {
      showError(removeError instanceof Error ? removeError.message : '移除项目成员失败');
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm">
      <div className="flex h-[min(88vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 shadow-2xl shadow-slate-900/20 backdrop-blur-xl">
        <div className="border-b border-slate-200/70 px-8 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-adnoc-blue">
                <UsersRound className="h-3.5 w-3.5" />
                PROJECT ACCESS
              </div>
              <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-900">项目成员管理</h2>
              <p className="mt-2 text-sm text-slate-500">
                为项目分配 Owner、编辑或查看角色。系统账号由“系统访问管理”统一维护。
              </p>
            </div>
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              关闭
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-adnoc-blue" />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="min-h-0 border-r border-slate-200/70 p-6">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索成员姓名、用户名或邮箱"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-11 py-3 text-sm outline-none focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
                  />
                </div>
                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-xs font-bold text-slate-500">
                  当前成员 {members.length}
                </div>
              </div>

              <div className="mt-5 grid h-[calc(100%-5rem)] gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="space-y-2">
                    {members.map((member) => (
                      <button
                        key={member.user.id}
                        type="button"
                        onClick={() => handleSelectMember(member)}
                        className={`w-full rounded-2xl border px-4 py-4 text-left transition ${selectedUserId === member.user.id ? 'border-adnoc-blue bg-white shadow-sm' : 'border-transparent bg-white/80 hover:border-slate-200 hover:bg-white'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-bold text-slate-900">{member.user.display_name}</div>
                            <div className="mt-1 text-xs font-mono text-slate-400">{member.user.username}</div>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${member.user.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {member.user.status === 'active' ? '启用' : '停用'}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {member.role_codes.map((roleCode) => (
                            <span key={roleCode} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-adnoc-blue">
                              {projectRoleLabel(roleCode)}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                    {members.length === 0 && (
                      <div className="flex h-40 items-center justify-center text-sm text-slate-400">当前项目还没有成员。</div>
                    )}
                  </div>
                </div>

                <div className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-adnoc-blue" />
                    <h3 className="font-black text-slate-900">添加或编辑成员</h3>
                  </div>
                  <label className="block">
                    <span className="text-xs font-bold tracking-widest text-slate-500">选择用户</span>
                    <SearchableSelect
                      value={selectedUserId}
                      onChange={handleSelectCandidate}
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10"
                      placeholder="请选择一个账号"
                      clearable
                      options={filteredCandidates.map((candidate) => ({
                        value: candidate.id,
                        label: `${candidate.display_name} (${candidate.username})`,
                        keywords: candidate.email ?? '',
                      }))}
                      searchPlaceholder="搜索姓名、用户名或邮箱"
                    />
                  </label>

                  {selectedUser && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="font-bold text-slate-900">{selectedUser.display_name}</div>
                      <div className="mt-1 text-xs text-slate-500">{selectedUser.email || selectedUser.username}</div>
                    </div>
                  )}

                  <div className="mt-5 space-y-2">
                    {roles.map((role) => (
                      <label key={role.code} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 transition hover:border-adnoc-blue/30 hover:bg-blue-50/40">
                        <input
                          type="checkbox"
                          checked={selectedRoleCodes.includes(role.code)}
                          onChange={() => toggleRole(role.code)}
                          disabled={!selectedUserId}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-adnoc-blue focus:ring-adnoc-blue"
                        />
                        <div>
                          <div className="font-bold text-slate-900">{projectRoleLabel(role.code)}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {role.permissions.map((permission) => permission.replace('project.', '')).join(' / ')}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-6 flex flex-wrap justify-end gap-3">
                    {selectedMember && (
                      <button type="button" onClick={() => void handleRemove()} disabled={isSaving} className={softPrimaryButtonClass}>
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        移除成员
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={!selectedUserId || selectedRoleCodes.length === 0 || isSaving}
                      className={primaryButtonClass}
                    >
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      {selectedMember ? '更新角色' : '添加成员'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto bg-slate-50/70 p-6">
              <div className="rounded-3xl border border-white/80 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-black text-slate-900">角色说明</h3>
                <div className="mt-4 space-y-3">
                  {roles.map((role) => (
                    <div key={role.code} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="font-bold text-slate-900">{projectRoleLabel(role.code)}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {role.permissions.map((permission) => (
                          <span key={permission} className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-500">
                            {permission}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
