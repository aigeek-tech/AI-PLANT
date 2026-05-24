import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  commitProjectTagImport,
  downloadProjectTagImportTemplate,
  getProjectTagImportJob,
  patchProjectTagImportRow,
  validateProjectTagImport,
} from '../../lib/api';
import type {
  ClassDefinition,
  PbsNode,
  TagImportCommitResult,
  TagImportJob,
  TagImportRow,
} from '../../lib/api';
import {
  primaryButtonClass,
  primaryButtonIconClass,
  secondaryButtonClass,
  secondaryButtonIconClass,
  softPrimaryButtonClass,
  softPrimaryButtonIconClass,
} from '../ui/buttonStyles';
import { SearchableSelect } from '../ui/SearchableSelect';
import { useToast } from '../ui/Toast';

type ImportStep = 'upload' | 'preview' | 'result';
type ImportFilter = 'all' | 'ready' | 'error' | 'warning' | 'conflict';

interface TagImportDialogProps {
  open: boolean;
  projectId: string;
  pbsNodes: PbsNode[];
  classes: ClassDefinition[];
  onClose: () => void;
  onImported: () => void;
}

const BASE_FIELDS = ['tag_no', 'name', 'pbs_code', 'class_code'] as const;

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

export function TagImportDialog({
  open,
  projectId,
  pbsNodes,
  classes,
  onClose,
  onImported,
}: TagImportDialogProps) {
  const { success, error: showError, info } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [step, setStep] = useState<ImportStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<TagImportJob | null>(null);
  const [filter, setFilter] = useState<ImportFilter>('all');
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isExportingIssues, setIsExportingIssues] = useState(false);
  const [commitResult, setCommitResult] = useState<TagImportCommitResult | null>(null);
  const [selectedConflictIds, setSelectedConflictIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setStep('upload');
      setSelectedFile(null);
      setJob(null);
      setFilter('all');
      setCommitResult(null);
      setSelectedConflictIds(new Set());
    }
  }, [open]);

  const attributeFields = useMemo(() => {
    const names = new Set<string>();
    for (const row of job?.rows ?? []) {
      Object.keys(row.values).forEach((key) => {
        if (!BASE_FIELDS.includes(key as (typeof BASE_FIELDS)[number])) {
          names.add(key);
        }
      });
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right, 'zh-CN'));
  }, [job]);

  const displayedRows = job?.rows ?? [];
  const hasSelectedConflicts = selectedConflictIds.size > 0;

  async function loadJob(nextFilter = filter, nextPage = job?.page ?? 1) {
    if (!job?.job_id) return;
    setIsReloading(true);
    try {
      const refreshed = await getProjectTagImportJob(projectId, job.job_id, {
        status: nextFilter === 'all' ? undefined : nextFilter,
        page: nextPage,
        page_size: job.page_size,
      });
      setJob(refreshed);
      setSelectedConflictIds((prev) => {
        const next = new Set<string>();
        prev.forEach((id) => {
          if (refreshed.rows.some((row) => row.id === id && row.status === 'conflict')) {
            next.add(id);
          }
        });
        return next;
      });
    } catch (uploadError) {
      showError(uploadError instanceof Error ? uploadError.message : '刷新导入草稿失败');
    } finally {
      setIsReloading(false);
    }
  }

  async function handleDownloadTemplate() {
    setIsDownloadingTemplate(true);
    try {
      const blob = await downloadProjectTagImportTemplate(projectId);
      downloadBlob(blob, `tag-import-template-${projectId}.xlsx`);
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
      const createdJob = await validateProjectTagImport(projectId, selectedFile);
      setJob(createdJob);
      setStep('preview');
      setFilter('all');
      setSelectedConflictIds(new Set());
      info('导入草稿已生成，请先处理错误和冲突');
    } catch (uploadError) {
      showError(uploadError instanceof Error ? uploadError.message : '文件校验失败');
    } finally {
      setIsUploading(false);
    }
  }

  async function handlePatchRow(row: TagImportRow, field: string, value: string) {
    if (!job) return;
    const currentValue = cellToInputValue(row.values[field]);
    if (currentValue === value) return;

    try {
      const patched = await patchProjectTagImportRow(projectId, job.job_id, row.id, {
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

  async function handleConflictAction(rowId: string, action: 'update' | 'skip') {
    if (!job) return;

    try {
      const patched = await patchProjectTagImportRow(projectId, job.job_id, rowId, {
        conflict_action: action,
      });
      setJob((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          summary: patched.summary,
          rows: prev.rows.map((item) => (item.id === rowId ? patched.row : item)),
        };
      });
    } catch (patchError) {
      showError(patchError instanceof Error ? patchError.message : '冲突处理更新失败');
    }
  }

  async function handleApplyConflictAction(action: 'update' | 'skip') {
    if (!job || selectedConflictIds.size === 0) return;

    try {
      for (const rowId of selectedConflictIds) {
        await patchProjectTagImportRow(projectId, job.job_id, rowId, {
          conflict_action: action,
        });
      }
      await loadJob();
      setSelectedConflictIds(new Set());
      success(action === 'update' ? '已批量标记为更新已有 TAG' : '已批量标记为跳过');
    } catch (patchError) {
      showError(patchError instanceof Error ? patchError.message : '批量冲突处理失败');
    }
  }

  async function handleCommit() {
    if (!job) return;
    setIsCommitting(true);
    try {
      const result = await commitProjectTagImport(projectId, job.job_id, []);
      setCommitResult(result);
      setStep('result');
      onImported();
      success('TAG 导入已完成');
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
      const statuses: Array<'error' | 'warning' | 'conflict'> = ['error', 'warning', 'conflict'];
      const collectedRows: TagImportRow[] = [];

      for (const status of statuses) {
        let page = 1;
        let totalPages = 1;
        do {
          const response = await getProjectTagImportJob(projectId, job.job_id, {
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
        info('当前没有可导出的错误、警告或冲突数据');
        return;
      }

      const lines = [
        ['row_number', 'status', 'tag_no', 'name', 'pbs_code', 'class_code', 'issues'].join(','),
        ...collectedRows.map((row) =>
          [
            row.row_number,
            row.status,
            escapeCsv(row.values.tag_no),
            escapeCsv(row.values.name),
            escapeCsv(row.values.pbs_code),
            escapeCsv(row.values.class_code),
            escapeCsv(row.issues.map((issue) => `${issue.field}:${issue.message}`).join(' | ')),
          ].join(','),
        ),
      ];
      downloadBlob(
        new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }),
        `tag-import-issues-${job.job_id}.csv`,
      );
      success('问题清单已导出');
    } catch (exportError) {
      showError(exportError instanceof Error ? exportError.message : '问题清单导出失败');
    } finally {
      setIsExportingIssues(false);
    }
  }

  function jumpToNextError() {
    const nextError = displayedRows.find((row) => row.status === 'error');
    if (!nextError) {
      info('当前页没有错误行');
      return;
    }
    rowRefs.current[nextError.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-4">
      <div className="flex h-[94dvh] w-full max-w-[96vw] flex-col overflow-hidden rounded-[1.5rem] border border-white/60 bg-white/90 shadow-2xl backdrop-blur-xl sm:h-[90vh] sm:rounded-[2rem]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-adnoc-blue/10 text-adnoc-blue">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-slate-900">TAG Excel 导入</h3>
              <p className="text-sm text-slate-500">
                项目级多 PBS 节点导入，先校验预览，再确认写入
              </p>
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
                  <p className="mt-1 text-sm text-slate-500">
                    模板会按当前项目 PBS 节点、Class 和属性定义动态生成
                  </p>
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
                <p className="mt-2 text-sm text-slate-500">
                  仅支持 `.xlsx`，文件上限 10 MB，首版仅导入设备级 TAG
                </p>
                <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={softPrimaryButtonClass}
                  >
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
                    <div className="mt-1 text-xs text-slate-500">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
              <h4 className="text-lg font-bold text-slate-900">导入规则</h4>
              <div className="mt-4 space-y-4 text-sm text-slate-600">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-800">必填列</div>
                  <div className="mt-1">`tag_no`、`name`、`pbs_code`</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-800">冲突处理</div>
                  <div className="mt-1">已有 `tag_no` 不会自动覆盖，必须先选择更新或跳过</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-800">在线修正</div>
                  <div className="mt-1">错误和警告行可以直接在系统里修改，不必回到 Excel 重传</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="font-semibold text-slate-800">当前参考数据</div>
                  <div className="mt-1">{pbsNodes.length} 个 PBS 节点，{classes.length} 个 Class</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && job && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-4 sm:px-6 md:grid-cols-3 xl:grid-cols-6">
              {[
                ['总行数', job.summary.total_rows],
                ['可导入', job.summary.ready_rows],
                ['错误', job.summary.error_rows],
                ['警告', job.summary.warning_rows],
                ['冲突', job.summary.conflict_rows],
                ['已处理冲突', `${job.summary.resolved_conflict_rows}/${job.summary.conflict_rows}`],
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
                  ['conflict', '冲突'],
                  ['warning', '警告'],
                  ['ready', '可导入'],
                ] as Array<[ImportFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setFilter(value);
                      void loadJob(value, 1);
                    }}
                    className={
                      filter === value
                        ? softPrimaryButtonClass
                        : secondaryButtonClass
                    }
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
                  disabled={isExportingIssues || (job.summary.error_rows + job.summary.warning_rows + job.summary.conflict_rows === 0)}
                  className={secondaryButtonClass}
                >
                  <span className={secondaryButtonIconClass}>
                    {isExportingIssues ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </span>
                  导出问题 CSV
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasSelectedConflicts && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleApplyConflictAction('update')}
                      className={softPrimaryButtonClass}
                    >
                      <span className={softPrimaryButtonIconClass}>
                        <CheckCircle2 className="h-4 w-4" />
                      </span>
                      批量更新已有
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleApplyConflictAction('skip')}
                      className={secondaryButtonClass}
                    >
                      <span className={secondaryButtonIconClass}>
                        <X className="h-4 w-4" />
                      </span>
                      批量跳过
                    </button>
                  </>
                )}
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
                      <th className="px-4 py-3 text-slate-600">选择</th>
                      <th className="px-4 py-3 text-slate-600">行号</th>
                      <th className="px-4 py-3 text-slate-600">状态</th>
                      {BASE_FIELDS.map((field) => (
                        <th key={field} className="px-4 py-3 text-slate-600">{field}</th>
                      ))}
                      {attributeFields.map((field) => (
                        <th key={field} className="px-4 py-3 text-slate-600">{field}</th>
                      ))}
                      <th className="px-4 py-3 text-slate-600">问题</th>
                      <th className="px-4 py-3 text-slate-600">冲突处理</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedRows.map((row) => (
                      <tr
                        key={row.id}
                        ref={(element) => {
                          rowRefs.current[row.id] = element;
                        }}
                        className={row.status === 'error' ? 'bg-red-50/40' : row.status === 'conflict' ? 'bg-amber-50/40' : ''}
                      >
                        <td className="px-4 py-3 align-top">
                          {row.status === 'conflict' ? (
                            <input
                              type="checkbox"
                              checked={selectedConflictIds.has(row.id)}
                              onChange={(event) => {
                                setSelectedConflictIds((prev) => {
                                  const next = new Set(prev);
                                  if (event.target.checked) next.add(row.id);
                                  else next.delete(row.id);
                                  return next;
                                });
                              }}
                            />
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 align-top">{row.row_number}</td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              row.status === 'error'
                                ? 'bg-red-100 text-red-700'
                                : row.status === 'conflict'
                                  ? 'bg-amber-100 text-amber-700'
                                  : row.status === 'warning'
                                    ? 'bg-sky-100 text-sky-700'
                                    : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        {BASE_FIELDS.map((field) => (
                          <td key={field} className="min-w-[160px] px-4 py-3 align-top">
                            <input
                              type="text"
                              list={field === 'pbs_code' ? 'tag-import-pbs-options' : field === 'class_code' ? 'tag-import-class-options' : undefined}
                              defaultValue={cellToInputValue(row.values[field])}
                              onBlur={(event) => void handlePatchRow(row, field, event.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
                            />
                          </td>
                        ))}
                        {attributeFields.map((field) => (
                          <td key={field} className="min-w-[160px] px-4 py-3 align-top">
                            <input
                              type="text"
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
                            {row.existing_tag && (
                              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                <div className="font-semibold">系统现有 TAG</div>
                                <div className="mt-1 font-mono">{row.existing_tag.tag_no}</div>
                                <div className="mt-1">{row.existing_tag.name}</div>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="min-w-[180px] px-4 py-3 align-top">
                          {row.status === 'conflict' ? (
                            <SearchableSelect
                              value={row.conflict_action ?? ''}
                              onChange={(nextValue) => {
                                const value = nextValue as 'update' | 'skip';
                                if (value) {
                                  void handleConflictAction(row.id, value);
                                }
                              }}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
                              placeholder="请选择"
                              clearable
                              options={[
                                { value: 'update', label: '更新已有' },
                                { value: 'skip', label: '跳过此行' },
                              ]}
                              searchPlaceholder="搜索处理方式"
                            />
                          ) : (
                            <span className="text-xs text-slate-400">无需处理</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {displayedRows.length === 0 && (
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
              <h4 className="text-2xl font-black text-slate-900">TAG 导入完成</h4>
              <p className="mt-2 text-sm text-slate-500">结果已经应用到当前项目，右侧 TAG 列表会重新加载</p>
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

      <datalist id="tag-import-pbs-options">
        {pbsNodes.map((node) => (
          <option key={node.id} value={node.code}>
            {node.name}
          </option>
        ))}
      </datalist>
      <datalist id="tag-import-class-options">
        {classes.map((classDefinition) => (
          <option key={classDefinition.id} value={classDefinition.code}>
            {classDefinition.name}
          </option>
        ))}
      </datalist>
    </div>
  );
}
