import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  Loader2,
  Sparkles,
  Table2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  commitStandardImportJob,
  getStandardImportJob,
  patchStandardImportItem,
  validateStandardImport,
  type StandardImportCommitResult,
  type StandardImportItem,
  type StandardImportJob,
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
type ImportFilter = 'all' | 'ready' | 'error' | 'warning' | 'conflict';
type TargetMode = 'new' | 'merge';

interface StandardImportDialogProps {
  open: boolean;
  targetMode?: TargetMode;
  targetStandardId?: string | null;
  targetStandardName?: string | null;
  onClose: () => void;
  onImported: () => void;
}

const SUPPORTED_EXTENSIONS = ['.docx', '.xlsx', '.pdf'];

function cellToInputValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function statusLabel(status: StandardImportItem['status']) {
  if (status === 'error') return '错误';
  if (status === 'warning') return '警告';
  if (status === 'conflict') return '冲突';
  return '可提交';
}

function entityKindLabel(kind: StandardImportItem['entity_kind']) {
  if (kind === 'standard') return '标准';
  if (kind === 'pbs_level') return 'PBS层级';
  if (kind === 'tag_class') return '位号类型';
  if (kind === 'tag_attribute') return '位号属性';
  if (kind === 'equipment_class') return '设备类型';
  if (kind === 'equipment_attribute') return '设备属性';
  if (kind === 'tag_equipment_class_relationship') return '位号/设备类型映射';
  if (kind === 'document_type') return '文档类型';
  return '文档属性';
}

function statusTone(status: StandardImportItem['status']) {
  if (status === 'error') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'conflict') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function sourceLabel(item: StandardImportItem) {
  if (item.sheet_name) return `${item.sheet_name}:${item.source_row_number}`;
  if (item.table_index) return `表格 ${item.table_index} 行 ${item.source_row_number}`;
  if (item.page_no) return `第 ${item.page_no} 页`;
  return `行 ${item.source_row_number}`;
}

function isSupportedFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

export function StandardImportDialog({
  open,
  targetMode = 'new',
  targetStandardId = null,
  targetStandardName = null,
  onClose,
  onImported,
}: StandardImportDialogProps) {
  const { success, error: showError, info } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<ImportStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<StandardImportJob | null>(null);
  const [filter, setFilter] = useState<ImportFilter>('all');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isPatching, setIsPatching] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<StandardImportCommitResult | null>(null);
  const [draftValues, setDraftValues] = useState({ code: '', name: '', description: '' });

  const items = useMemo(() => job?.items ?? job?.rows ?? [], [job?.items, job?.rows]);
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? items[0] ?? null,
    [items, selectedItemId],
  );

  useEffect(() => {
    if (!open) {
      setStep('upload');
      setSelectedFile(null);
      setJob(null);
      setFilter('all');
      setSelectedItemId(null);
      setCommitResult(null);
      setDraftValues({ code: '', name: '', description: '' });
    }
  }, [open]);

  useEffect(() => {
    if (!selectedItem) {
      setDraftValues({ code: '', name: '', description: '' });
      return;
    }
    setDraftValues({
      code: cellToInputValue(selectedItem.values.code ?? selectedItem.normalized_values.code),
      name: cellToInputValue(selectedItem.values.name ?? selectedItem.normalized_values.name),
      description: cellToInputValue(selectedItem.values.description ?? selectedItem.normalized_values.description),
    });
  }, [selectedItem]);

  if (!open) return null;

  async function loadJob(nextFilter = filter, nextPage = job?.page ?? 1) {
    if (!job?.job_id) return;
    setIsReloading(true);
    try {
      const refreshed = await getStandardImportJob(job.job_id, {
        status: nextFilter === 'all' ? undefined : nextFilter,
        page: nextPage,
        page_size: job.page_size,
      });
      setJob(refreshed);
      setSelectedItemId((current) => (current && refreshed.items.some((item) => item.id === current) ? current : (refreshed.items[0]?.id ?? null)));
    } catch (loadError) {
      showError(loadError instanceof Error ? loadError.message : '刷新导入预览失败');
    } finally {
      setIsReloading(false);
    }
  }

  function handleFiles(fileList: FileList | File[]) {
    const [file] = Array.from(fileList);
    if (!file) return;
    if (!isSupportedFile(file)) {
      showError('仅支持 .docx、.xlsx、可复制文本 .pdf');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showError('文件不能超过 10 MB');
      return;
    }
    setSelectedFile(file);
  }

  async function handleUpload() {
    if (!selectedFile) {
      showError('请先选择一个标准文件');
      return;
    }
    if (targetMode === 'merge' && !targetStandardId) {
      showError('补录已有标准时缺少目标标准');
      return;
    }

    setIsUploading(true);
    try {
      const createdJob = await validateStandardImport(selectedFile, {
        target_mode: targetMode,
        target_standard_id: targetMode === 'merge' ? targetStandardId : null,
      });
      setJob(createdJob);
      setStep('preview');
      setFilter('all');
      setSelectedItemId((createdJob.items ?? createdJob.rows)[0]?.id ?? null);
      info('AI 表格草稿已生成，请处理错误和冲突后再入库');
    } catch (uploadError) {
      showError(uploadError instanceof Error ? uploadError.message : '文件分析失败');
    } finally {
      setIsUploading(false);
    }
  }

  async function patchItem(item: StandardImportItem, payload: { values?: Record<string, unknown>; action?: 'create' | 'update' | 'skip' | null }) {
    if (!job || !item.id) return;
    setIsPatching(true);
    try {
      const patched = await patchStandardImportItem(job.job_id, item.id, payload);
      setJob(patched);
      setSelectedItemId(item.id);
      success('草稿项已更新');
    } catch (patchError) {
      showError(patchError instanceof Error ? patchError.message : '更新草稿项失败');
    } finally {
      setIsPatching(false);
    }
  }

  async function updateSelectedValues() {
    if (!selectedItem) return;
    await patchItem(selectedItem, {
      values: {
        code: draftValues.code,
        name: draftValues.name,
        description: draftValues.description,
      },
    });
  }

  async function updateAllConflicts(action: 'update' | 'skip') {
    if (!job) return;
    const conflictItems = items.filter((item) => item.status === 'conflict');
    setIsPatching(true);
    try {
      let refreshed: StandardImportJob = job;
      for (const item of conflictItems) {
        if (!item.id) continue;
        refreshed = await patchStandardImportItem(refreshed.job_id, item.id, { action });
      }
      setJob(refreshed);
      success(action === 'update' ? '已批量设为更新' : '已批量跳过冲突');
    } catch (patchError) {
      showError(patchError instanceof Error ? patchError.message : '批量处理冲突失败');
    } finally {
      setIsPatching(false);
    }
  }

  async function handleCommit() {
    if (!job) return;
    setIsCommitting(true);
    try {
      const result = await commitStandardImportJob(job.job_id);
      setCommitResult(result);
      setStep('result');
      onImported();
      success('标准导入已完成');
    } catch (commitError) {
      showError(commitError instanceof Error ? commitError.message : '导入提交失败');
      await loadJob();
    } finally {
      setIsCommitting(false);
    }
  }

  const canCommit = Boolean(job?.summary.can_commit);
  const disableCommit = !job || !canCommit || isCommitting || isReloading || isPatching;
  const modalTitle = targetMode === 'merge' ? 'AI 补录标准' : 'AI 录入标准';

  const dialogContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-sm sm:p-4">
      <div className="flex max-h-[94dvh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-adnoc-blue">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-slate-900">{modalTitle}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {targetMode === 'merge' ? `目标：${targetStandardName ?? '当前标准'}` : '新建标准草稿'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 'upload' && (
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_360px] lg:gap-6">
            <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-4 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <h4 className="text-lg font-bold text-slate-900">上传标准文件</h4>
                  <p className="mt-1 text-sm text-slate-500">支持 Word 表格、Excel 工作簿和可复制文本 PDF</p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-3 py-1 text-xs font-bold text-adnoc-blue">
                  <Table2 className="h-4 w-4" />
                  表格优先
                </span>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragActive(false);
                  handleFiles(event.dataTransfer.files);
                }}
                className={`mt-8 flex min-h-64 w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition ${
                  isDragActive ? 'border-adnoc-blue bg-white' : 'border-blue-200 bg-white/70 hover:border-adnoc-blue hover:bg-white'
                }`}
              >
                <Upload className="h-10 w-10 text-adnoc-blue" />
                <div className="mt-4 text-base font-bold text-slate-800">
                  {selectedFile ? selectedFile.name : '拖拽或选择标准文件'}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  {selectedFile ? `${Math.ceil(selectedFile.size / 1024)} KB` : '.docx / .xlsx / .pdf，10 MB 以内'}
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) handleFiles(event.target.files);
                }}
              />

              <div className="mt-6 flex sm:justify-end">
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!selectedFile || isUploading}
                  className={primaryButtonClass}
                >
                  <span className={primaryButtonIconClass}>
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  </span>
                  生成 AI 草稿
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <h4 className="text-base font-bold text-slate-900">处理机制</h4>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
                <p>Word 和 Excel 会保留表格行列、sheet、行号和列名，作为每个草稿项的证据来源。</p>
                <p>PDF 只做无 OCR 的文本上下文处理，不承诺还原复杂表格结构。</p>
                <p>AI 或规则只生成草稿，正式入库必须经过预览确认。</p>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && job && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 sm:p-6">
            <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-5">
              {[
                ['总项数', job.summary.total_rows],
                ['可提交', job.summary.ready_rows],
                ['错误', job.summary.error_rows],
                ['警告', job.summary.warning_rows],
                ['冲突', job.summary.conflict_rows],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-bold tracking-wide text-slate-500">{label}</div>
                  <div className="mt-1 text-xl font-black text-slate-900">{value}</div>
                </div>
              ))}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
              <div className="flex max-w-full items-center gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1">
                <Filter className="ml-2 h-4 w-4 text-slate-400" />
                {([
                  ['all', '全部'],
                  ['ready', '可提交'],
                  ['error', '错误'],
                  ['warning', '警告'],
                  ['conflict', '冲突'],
                ] as Array<[ImportFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setFilter(value);
                      void loadJob(value, 1);
                    }}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${filter === value ? 'bg-adnoc-blue text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {job.summary.conflict_rows > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => void updateAllConflicts('update')}
                      disabled={isPatching}
                      className={softPrimaryButtonClass}
                    >
                      <span className={softPrimaryButtonIconClass}><CheckCircle2 className="h-4 w-4" /></span>
                      冲突设为更新
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateAllConflicts('skip')}
                      disabled={isPatching}
                      className={secondaryButtonClass}
                    >
                      <span className={secondaryButtonIconClass}><X className="h-4 w-4" /></span>
                      冲突设为跳过
                    </button>
                  </>
                )}
                <button type="button" onClick={handleCommit} disabled={disableCommit} className={primaryButtonClass}>
                  <span className={primaryButtonIconClass}>
                    {isCommitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  </span>
                  确认入库
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="min-h-0 overflow-auto rounded-2xl border border-slate-200">
                <table className="min-w-[980px] w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr>
                      <th className="w-24 px-4 py-2.5 text-xs font-bold tracking-wide text-slate-600">状态</th>
                      <th className="w-32 px-4 py-2.5 text-xs font-bold tracking-wide text-slate-600">来源</th>
                      <th className="w-28 px-4 py-2.5 text-xs font-bold tracking-wide text-slate-600">类型</th>
                      <th className="w-36 px-4 py-2.5 text-xs font-bold tracking-wide text-slate-600">编码</th>
                      <th className="w-44 px-4 py-2.5 text-xs font-bold tracking-wide text-slate-600">名称</th>
                      <th className="px-4 py-2.5 text-xs font-bold tracking-wide text-slate-600">问题</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {items.map((item) => (
                      <tr
                        key={item.id ?? `${item.row_number}`}
                        onClick={() => setSelectedItemId(item.id)}
                        className={`cursor-pointer transition hover:bg-blue-50/40 ${selectedItem?.id === item.id ? 'bg-blue-50/70' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${statusTone(item.status)}`}>
                            {item.action === 'skip' ? '跳过' : statusLabel(item.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-600">{sourceLabel(item)}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-600">{entityKindLabel(item.entity_kind)}</td>
                        <td className="px-4 py-3 font-mono text-[13px] text-slate-700">{cellToInputValue(item.normalized_values.code)}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-700">{cellToInputValue(item.normalized_values.name)}</td>
                        <td className="px-4 py-3">
                          {item.issues.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {item.issues.map((issue) => (
                                <span
                                  key={`${issue.code}-${issue.field}`}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${issue.severity === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                                >
                                  <AlertCircle className="h-3 w-3" />
                                  {issue.message}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">无</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-16 text-center text-sm font-semibold text-slate-400">
                          当前筛选下没有导入项
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {selectedItem ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="font-black text-slate-900">{entityKindLabel(selectedItem.entity_kind)}</h4>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{sourceLabel(selectedItem)} · 置信度 {Math.round(selectedItem.confidence * 100)}%</p>
                      </div>
                      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${statusTone(selectedItem.status)}`}>
                        {statusLabel(selectedItem.status)}
                      </span>
                    </div>

                    <div className="grid gap-3">
                      <label className="space-y-1">
                        <span className="text-xs font-bold tracking-wide text-slate-600">编码</span>
                        <input
                          value={draftValues.code}
                          onChange={(event) => setDraftValues((current) => ({ ...current, code: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/15"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-bold tracking-wide text-slate-600">名称</span>
                        <input
                          value={draftValues.name}
                          onChange={(event) => setDraftValues((current) => ({ ...current, name: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/15"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-bold tracking-wide text-slate-600">说明</span>
                        <textarea
                          value={draftValues.description}
                          onChange={(event) => setDraftValues((current) => ({ ...current, description: event.target.value }))}
                          rows={3}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/15"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void updateSelectedValues()} disabled={isPatching} className={softPrimaryButtonClass}>
                        <span className={softPrimaryButtonIconClass}><CheckCircle2 className="h-4 w-4" /></span>
                        保存修正
                      </button>
                      <button type="button" onClick={() => void patchItem(selectedItem, { action: 'update' })} disabled={isPatching} className={secondaryButtonClass}>
                        设为更新
                      </button>
                      <button type="button" onClick={() => void patchItem(selectedItem, { action: 'skip' })} disabled={isPatching} className={secondaryButtonClass}>
                        跳过
                      </button>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="mb-3 flex items-center gap-2 text-xs font-black text-slate-600">
                        <FileText className="h-4 w-4 text-adnoc-blue" />
                        来源证据
                      </div>
                      <div className="space-y-2">
                        {selectedItem.evidence.length > 0 ? (
                          selectedItem.evidence.slice(0, 8).map((evidence, index) => (
                            <div key={`${evidence.column_name}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                              <div className="text-xs font-bold tracking-wide text-slate-500">
                                {evidence.sheet_name ?? (evidence.page_no ? `第 ${evidence.page_no} 页` : '源文件')}
                                {evidence.table_index ? ` / 表 ${evidence.table_index}` : ''}
                                {evidence.row_number ? ` / 行 ${evidence.row_number}` : ''}
                                {evidence.column_name ? ` / ${evidence.column_name}` : ''}
                              </div>
                              <div className="mt-1 break-words text-sm leading-6 text-slate-600">{evidence.source_text}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-8 text-center text-xs font-semibold text-slate-400">
                            暂无来源证据
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-72 items-center justify-center text-center text-sm font-semibold text-slate-400">
                    选择左侧草稿项查看表格证据
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-between text-xs text-slate-500">
              <span>第 {job.page} / {job.total_pages} 页</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void loadJob(filter, Math.max(1, job.page - 1))}
                  disabled={job.page <= 1 || isReloading}
                  className={secondaryButtonClass}
                >
                  <span className={secondaryButtonIconClass}><ChevronLeft className="h-4 w-4" /></span>
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => void loadJob(filter, Math.min(job.total_pages, job.page + 1))}
                  disabled={job.page >= job.total_pages || isReloading}
                  className={secondaryButtonClass}
                >
                  下一页
                  <span className={secondaryButtonIconClass}><ChevronRight className="h-4 w-4" /></span>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'result' && commitResult && (
          <div className="flex min-h-[420px] flex-1 items-center justify-center p-6">
            <div className="max-w-xl text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <h4 className="mt-5 text-2xl font-black text-slate-900">标准入库完成</h4>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  ['新增', commitResult.created_count],
                  ['更新', commitResult.updated_count],
                  ['跳过', commitResult.skipped_count],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                    <div className="text-xs font-bold tracking-wide text-slate-500">{label}</div>
                    <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={onClose} className={`${primaryButtonClass} mt-8`}>
                完成
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(dialogContent, document.body);
}
