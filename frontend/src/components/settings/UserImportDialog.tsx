import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import {
  commitUserImport,
  downloadUserImportTemplate,
  getUserImportJob,
  patchUserImportRow,
  validateUserImport,
  type AuthRoleSummary,
  type UserImportCommitResult,
  type UserImportJob,
  type UserImportRow,
} from '../../lib/api';
import {
  primaryButtonClass,
  primaryButtonIconClass,
  secondaryButtonClass,
  secondaryButtonIconClass,
  softPrimaryButtonClass,
  softPrimaryButtonIconClass,
} from '../ui/buttonStyles';
import { useToast } from '../ui/Toast';

type ImportStep = 'upload' | 'preview' | 'result';
type ImportFilter = 'all' | 'error' | 'warning' | 'ready' | 'create' | 'update' | 'skip';
type UserImportField = keyof UserImportRow['values'];

interface UserImportDialogProps {
  open: boolean;
  roles: AuthRoleSummary[];
  canManageRoles: boolean;
  onClose: () => void;
  onImported: () => void;
}

const USER_IMPORT_FIELDS: UserImportField[] = [
  'username',
  'display_name',
  'email',
  'status',
  'password',
  'system_role_codes',
];

function cellToInputValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function escapeCsv(value: unknown) {
  const text = cellToInputValue(value).replaceAll('"', '""');
  return `"${text}"`;
}

function issueTone(severity: 'error' | 'warning') {
  return severity === 'error'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
}

function actionLabel(action: UserImportRow['action']) {
  if (action === 'create') return '新增';
  if (action === 'update') return '更新';
  return '跳过';
}

function statusLabel(status: UserImportRow['status']) {
  if (status === 'error') return '错误';
  if (status === 'warning') return '警告';
  return '可提交';
}

export function UserImportDialog({ open, roles, canManageRoles, onClose, onImported }: UserImportDialogProps) {
  const { success, error: showError, info } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [step, setStep] = useState<ImportStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<UserImportJob | null>(null);
  const [filter, setFilter] = useState<ImportFilter>('all');
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isExportingIssues, setIsExportingIssues] = useState(false);
  const [commitResult, setCommitResult] = useState<UserImportCommitResult | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('upload');
      setSelectedFile(null);
      setJob(null);
      setFilter('all');
      setCommitResult(null);
    }
  }, [open]);

  async function loadJob(nextFilter = filter, nextPage = job?.page ?? 1) {
    if (!job?.job_id) return;
    setIsReloading(true);
    try {
      const refreshed = await getUserImportJob(job.job_id, {
        status: nextFilter === 'all' ? undefined : nextFilter,
        page: nextPage,
        page_size: job.page_size,
      });
      setJob(refreshed);
    } catch (loadError) {
      showError(loadError instanceof Error ? loadError.message : '刷新导入预览失败');
    } finally {
      setIsReloading(false);
    }
  }

  async function handleDownloadTemplate() {
    setIsDownloadingTemplate(true);
    try {
      const blob = await downloadUserImportTemplate();
      downloadBlob(blob, 'user-import-template.xlsx');
      success('模板已开始下载');
    } catch (downloadError) {
      showError(downloadError instanceof Error ? downloadError.message : '模板下载失败');
    } finally {
      setIsDownloadingTemplate(false);
    }
  }

  async function handleValidateUpload() {
    if (!selectedFile) {
      showError('请先选择一个 Excel 文件');
      return;
    }
    if (!selectedFile.name.toLowerCase().endsWith('.xlsx')) {
      showError('仅支持上传 .xlsx 文件');
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      showError('文件不能超过 10 MB');
      return;
    }

    setIsUploading(true);
    try {
      const createdJob = await validateUserImport(selectedFile);
      setJob(createdJob);
      setStep('preview');
      setFilter('all');
      info('导入预览已生成，请先处理错误行');
    } catch (uploadError) {
      showError(uploadError instanceof Error ? uploadError.message : '文件校验失败');
    } finally {
      setIsUploading(false);
    }
  }

  async function handlePatchRow(row: UserImportRow, field: UserImportField, value: string) {
    if (!job) return;
    const currentValue = cellToInputValue(row.values[field]);
    if (currentValue === value) return;

    try {
      const patched = await patchUserImportRow(job.job_id, row.id, {
        values: { [field]: value },
      });
      setJob((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          summary: patched.summary,
          rows: prev.rows.map((item) => (item.id === row.id ? patched.row : item)),
        };
      });
    } catch (patchError) {
      showError(patchError instanceof Error ? patchError.message : '保存修正失败');
      await loadJob();
    }
  }

  async function handleCommit() {
    if (!job) return;
    setIsCommitting(true);
    try {
      const result = await commitUserImport(job.job_id);
      setCommitResult(result);
      setStep('result');
      onImported();
      success('用户导入已完成');
    } catch (commitError) {
      showError(commitError instanceof Error ? commitError.message : '导入提交失败');
      await loadJob();
    } finally {
      setIsCommitting(false);
    }
  }

  async function handleExportIssues() {
    if (!job) return;
    setIsExportingIssues(true);
    try {
      const statuses: Array<'error' | 'warning'> = ['error', 'warning'];
      const collectedRows: UserImportRow[] = [];

      for (const status of statuses) {
        let page = 1;
        let totalPages = 1;
        do {
          const response = await getUserImportJob(job.job_id, {
            status,
            page,
            page_size: 200,
          });
          collectedRows.push(...response.rows);
          totalPages = response.total_pages;
          page += 1;
        } while (page <= totalPages);
      }

      if (collectedRows.length === 0) {
        info('当前没有可导出的问题数据');
        return;
      }

      const lines = [
        ['row_number', 'action', 'status', 'username', 'display_name', 'email', 'system_role_codes', 'issues'].join(','),
        ...collectedRows.map((row) =>
          [
            row.row_number,
            row.action,
            row.status,
            escapeCsv(row.values.username),
            escapeCsv(row.values.display_name),
            escapeCsv(row.values.email),
            escapeCsv(row.values.system_role_codes),
            escapeCsv(row.issues.map((issue) => `${issue.field}:${issue.message}`).join(' | ')),
          ].join(','),
        ),
      ];
      downloadBlob(
        new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }),
        `user-import-issues-${job.job_id}.csv`,
      );
      success('问题清单已导出');
    } catch (exportError) {
      showError(exportError instanceof Error ? exportError.message : '问题清单导出失败');
    } finally {
      setIsExportingIssues(false);
    }
  }

  function jumpToNextError() {
    const nextError = job?.rows.find((row) => row.status === 'error');
    if (!nextError) {
      info('当前页没有错误行');
      return;
    }
    rowRefs.current[nextError.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (!open) {
    return null;
  }

  const systemRoles = roles.filter((role) => role.scope_kind === 'system');

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-4">
      <div className="flex h-[94dvh] w-full max-w-[96vw] flex-col overflow-hidden rounded-[1.5rem] border border-white/60 bg-white/90 shadow-2xl backdrop-blur-xl sm:h-[90vh] sm:rounded-[2rem]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-adnoc-blue/10 text-adnoc-blue">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-slate-900">用户 Excel 导入</h3>
              <p className="text-sm text-slate-500">批量新增账号、更新资料和系统角色，先校验预览，再确认写入</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 'upload' && (
          <div className="grid flex-1 gap-4 overflow-auto p-4 sm:p-6 lg:grid-cols-[1.4fr_1fr] lg:gap-6">
            <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4 sm:p-6">
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-xl font-bold text-slate-900">1. 下载模板</h4>
                  <p className="mt-1 text-sm text-slate-500">模板包含用户导入表和系统角色参考表</p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  disabled={isDownloadingTemplate}
                  className={secondaryButtonClass}
                >
                  <span className={secondaryButtonIconClass}>
                    {isDownloadingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </span>
                  下载模板
                </button>
              </div>

              <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedFile(file);
                  }}
                />
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-adnoc-blue/10 text-adnoc-blue">
                  <Upload className="h-7 w-7" />
                </div>
                <h4 className="text-lg font-bold text-slate-900">2. 上传并校验 Excel</h4>
                <p className="mt-2 text-sm text-slate-500">仅支持 `.xlsx`，文件上限 10 MB；上传后只生成预览，不直接写入</p>
                <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className={softPrimaryButtonClass}>
                    <span className={softPrimaryButtonIconClass}>
                      <FileSpreadsheet className="h-4 w-4" />
                    </span>
                    选择文件
                  </button>
                  <button
                    type="button"
                    onClick={handleValidateUpload}
                    disabled={!selectedFile || isUploading}
                    className={primaryButtonClass}
                  >
                    <span className={primaryButtonIconClass}>
                      {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    </span>
                    开始校验
                  </button>
                </div>
                {selectedFile && (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-600">
                    <div className="font-semibold text-slate-800">{selectedFile.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
              <h4 className="text-lg font-bold text-slate-900">导入规则</h4>
              <div className="mt-4 space-y-4 text-sm text-slate-600">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-800">匹配方式</div>
                  <div className="mt-1">按 `username` 匹配已有用户；不存在则新增。</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-800">密码</div>
                  <div className="mt-1">新用户必须填写；已有用户留空表示不修改。预览和问题导出不会显示明文密码。</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-800">系统角色</div>
                  <div className="mt-1">
                    {canManageRoles ? 'system_role_codes 会覆盖用户当前系统角色。' : '当前账号不能批量修改系统角色，角色列非空会报错。'}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-800">当前参考数据</div>
                  <div className="mt-1">{systemRoles.length} 个系统角色可用。</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && job && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-4 sm:px-6 md:grid-cols-4 xl:grid-cols-7">
              {[
                ['总行数', job.summary.total_rows],
                ['新增', job.summary.create_rows],
                ['更新', job.summary.update_rows],
                ['跳过', job.summary.skip_rows],
                ['可提交', job.summary.ready_rows],
                ['错误', job.summary.error_rows],
                ['警告', job.summary.warning_rows],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/70 bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="mt-1 text-xl font-black text-slate-900">{value}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ['all', '全部'],
                  ['error', '错误'],
                  ['warning', '警告'],
                  ['ready', '可提交'],
                  ['create', '新增'],
                  ['update', '更新'],
                  ['skip', '跳过'],
                ] as Array<[ImportFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setFilter(value);
                      void loadJob(value, 1);
                    }}
                    className={filter === value ? softPrimaryButtonClass : secondaryButtonClass}
                  >
                    <span className={filter === value ? softPrimaryButtonIconClass : secondaryButtonIconClass}>
                      <Filter className="h-4 w-4" />
                    </span>
                    {label}
                  </button>
                ))}
                <button type="button" onClick={jumpToNextError} className={secondaryButtonClass}>
                  <span className={secondaryButtonIconClass}>
                    <AlertCircle className="h-4 w-4" />
                  </span>
                  下一条错误
                </button>
                <button
                  type="button"
                  onClick={handleExportIssues}
                  disabled={isExportingIssues || job.summary.error_rows + job.summary.warning_rows === 0}
                  className={secondaryButtonClass}
                >
                  <span className={secondaryButtonIconClass}>
                    {isExportingIssues ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </span>
                  导出问题 CSV
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setStep('upload')} className={secondaryButtonClass}>
                  <span className={secondaryButtonIconClass}>
                    <ChevronLeft className="h-4 w-4" />
                  </span>
                  重新上传
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={!job.summary.can_commit || isCommitting}
                  className={primaryButtonClass}
                >
                  <span className={primaryButtonIconClass}>
                    {isCommitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </span>
                  确认导入
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
              <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-3 text-slate-600">行号</th>
                      <th className="px-4 py-3 text-slate-600">动作</th>
                      <th className="px-4 py-3 text-slate-600">状态</th>
                      {USER_IMPORT_FIELDS.map((field) => (
                        <th key={field} className="px-4 py-3 text-slate-600">{field}</th>
                      ))}
                      <th className="px-4 py-3 text-slate-600">问题</th>
                      <th className="px-4 py-3 text-slate-600">现有用户</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {job.rows.map((row) => (
                      <tr
                        key={row.id}
                        ref={(element) => {
                          rowRefs.current[row.id] = element;
                        }}
                        className={row.status === 'error' ? 'bg-red-50/40' : row.status === 'warning' ? 'bg-amber-50/40' : ''}
                      >
                        <td className="px-4 py-3 align-top font-mono text-xs text-slate-500">{row.row_number}</td>
                        <td className="px-4 py-3 align-top">
                          <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-adnoc-blue">
                            {actionLabel(row.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              row.status === 'error'
                                ? 'bg-red-100 text-red-700'
                                : row.status === 'warning'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        {USER_IMPORT_FIELDS.map((field) => (
                          <td key={field} className="min-w-[160px] px-4 py-3 align-top">
                            <input
                              type={field === 'password' ? 'password' : 'text'}
                              list={field === 'system_role_codes' ? 'user-import-role-options' : undefined}
                              defaultValue={cellToInputValue(row.values[field])}
                              onBlur={(event) => void handlePatchRow(row, field, event.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
                            />
                          </td>
                        ))}
                        <td className="min-w-[320px] px-4 py-3 align-top">
                          <div className="space-y-2">
                            {row.issues.length === 0 ? (
                              <span className="text-xs text-slate-400">无</span>
                            ) : (
                              row.issues.map((issue) => (
                                <div
                                  key={`${row.id}-${issue.field}-${issue.code}`}
                                  className={`rounded-2xl border px-3 py-2 text-xs ${issueTone(issue.severity)}`}
                                >
                                  <div className="font-semibold">{issue.field}</div>
                                  <div className="mt-1">{issue.message}</div>
                                </div>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="min-w-[220px] px-4 py-3 align-top">
                          {row.existing_user ? (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                              <div className="font-bold text-slate-900">{row.existing_user.display_name}</div>
                              <div className="mt-1 font-mono">{row.existing_user.username}</div>
                              <div className="mt-1">{row.existing_user.email || '-'}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">新增账号</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {job.rows.length === 0 && (
                  <div className="flex flex-col items-center justify-center px-6 py-16 text-sm text-slate-400">
                    <Filter className="mb-3 h-8 w-8 text-slate-300" />
                    当前筛选条件下没有数据
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="text-sm text-slate-500">
                第 {job.page} / {job.total_pages} 页
                {isReloading && <span className="ml-2 inline-flex items-center gap-1 text-adnoc-blue"><Loader2 className="h-4 w-4 animate-spin" /> 刷新中</span>}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void loadJob(filter, job.page - 1)}
                  disabled={job.page <= 1 || isReloading}
                  className={secondaryButtonClass}
                >
                  <span className={secondaryButtonIconClass}>
                    <ChevronLeft className="h-4 w-4" />
                  </span>
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => void loadJob(filter, job.page + 1)}
                  disabled={job.page >= job.total_pages || isReloading}
                  className={secondaryButtonClass}
                >
                  <span className={secondaryButtonIconClass}>
                    <ChevronRight className="h-4 w-4" />
                  </span>
                  下一页
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'result' && commitResult && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <div>
              <h4 className="text-2xl font-black text-slate-900">用户导入完成</h4>
              <p className="mt-2 text-sm text-slate-500">账号和系统角色已更新，用户列表会重新加载</p>
            </div>
            <div className="grid w-full max-w-3xl gap-4 md:grid-cols-4">
              {[
                ['新增', commitResult.created_count],
                ['更新', commitResult.updated_count],
                ['跳过', commitResult.skipped_count],
                ['失败', commitResult.failed_count],
              ].map(([label, value]) => (
                <div key={label} className="rounded-3xl border border-slate-200 bg-white px-4 py-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-400">{label}</div>
                  <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
                </div>
              ))}
            </div>
            <button type="button" onClick={onClose} className={primaryButtonClass}>
              <span className={primaryButtonIconClass}>
                <CheckCircle2 className="h-4 w-4" />
              </span>
              关闭
            </button>
          </div>
        )}
      </div>

      <datalist id="user-import-role-options">
        {systemRoles.map((role) => (
          <option key={role.id} value={role.code}>
            {role.name}
          </option>
        ))}
      </datalist>
    </div>
  );
}
