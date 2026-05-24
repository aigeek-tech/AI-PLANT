import React, { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Upload, Wand2, X } from 'lucide-react';

import {
  analyzeProjectDocumentImport,
  completeProjectDocumentUpload,
  createProjectDocument,
  createProjectDocumentRevision,
  getProjectDocumentDetail,
  getProjectDocuments,
  initiateProjectDocumentUpload,
  type DocumentImportCandidate,
  type ProjectDocumentDetail,
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

type FileRole = 'primary' | 'source' | 'attachment' | 'reference';

interface UploadQueueItem {
  clientId: string;
  file: File;
  relativePath: string | null;
}

interface EditableCandidate extends DocumentImportCandidate {
  confirmed: boolean;
  skipped: boolean;
  document_no: string;
  title: string;
  revision_no: string;
  file_role: FileRole;
}

interface BulkDocumentImportDialogProps {
  projectId: string;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10';

function createUploadClientId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    const version = `4${hex[6].slice(1)}`;
    const variant = `${((bytes[8] & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex[9]}`;

    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${version}-${variant}-${hex.slice(10, 16).join('')}`;
  }

  return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function BulkDocumentImportDialog({
  projectId,
  onClose,
  onImported,
}: BulkDocumentImportDialogProps) {
  const { success, error: showError } = useToast();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [candidates, setCandidates] = useState<EditableCandidate[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [bulkRevisionNo, setBulkRevisionNo] = useState('');

  const pendingConfirmationCount = useMemo(
    () => candidates.filter((item) => !item.skipped && item.needs_confirmation && !item.confirmed).length,
    [candidates],
  );
  const invalidCount = useMemo(
    () =>
      candidates.filter(
        (item) =>
          !item.skipped &&
          (!item.document_no.trim() || !item.revision_no.trim()),
      ).length,
    [candidates],
  );
  const selectedCount = selectedClientIds.size;

  function appendFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    setQueue((current) => {
      const existingKeys = new Set(current.map((item) => `${item.relativePath ?? ''}::${item.file.name}::${item.file.size}`));
      const nextItems = files
        .map((file) => ({
          clientId: createUploadClientId(),
          file,
          relativePath: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || '').trim() || null,
        }))
        .filter((item) => {
          const key = `${item.relativePath ?? ''}::${item.file.name}::${item.file.size}`;
          if (existingKeys.has(key)) {
            return false;
          }
          existingKeys.add(key);
          return true;
        });
      return [...current, ...nextItems];
    });
  }

  async function handleAnalyze() {
    if (queue.length === 0) {
      showError('请先选择文件或目录');
      return;
    }
    setIsAnalyzing(true);
    try {
      const result = await analyzeProjectDocumentImport(projectId, {
        files: queue.map((item) => ({
          client_id: item.clientId,
          filename: item.file.name,
          relative_path: item.relativePath,
          size_bytes: item.file.size,
          content_type: item.file.type || null,
        })),
        use_llm: true,
      });
      setCandidates(
        result.items.map((item) => ({
          ...item,
          confirmed: !item.needs_confirmation,
          skipped: false,
          document_no: item.suggested_document_no ?? '',
          title: item.suggested_title ?? '',
          revision_no: item.suggested_revision_no ?? '',
          file_role: item.suggested_file_role,
        })),
      );
      setSelectedClientIds(new Set());
      success(`已生成 ${result.summary.total_files} 条导入建议`);
    } catch (error) {
      showError(error instanceof Error ? error.message : '批量导入分析失败');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCommit() {
    if (candidates.length === 0) {
      showError('请先完成导入分析');
      return;
    }
    if (pendingConfirmationCount > 0) {
      showError('请先确认 AI 建议或人工处理项');
      return;
    }
    if (invalidCount > 0) {
      showError('仍有文档编号或版本号为空的导入项');
      return;
    }

    setIsSubmitting(true);
    try {
      const fileMap = new Map(queue.map((item) => [item.clientId, item]));
      const documentCache = new Map<string, string>();
      const revisionCache = new Map<string, string>();
      const activeItems = candidates.filter((item) => !item.skipped);

      for (let index = 0; index < activeItems.length; index += 1) {
        const candidate = activeItems[index];
        const queueItem = fileMap.get(candidate.client_id);
        if (!queueItem) {
          throw new Error(`找不到本地文件: ${candidate.filename}`);
        }
        setProgressText(`正在导入 ${index + 1}/${activeItems.length}: ${candidate.filename}`);

        const documentId = await ensureDocument(projectId, candidate, documentCache);
        const revisionId = await ensureRevision(projectId, documentId, candidate, revisionCache);
        await uploadFile(projectId, documentId, revisionId, candidate, queueItem.file, queueItem.relativePath);
      }

      success(`已导入 ${activeItems.length} 个文件`);
      await onImported();
      onClose();
    } catch (error) {
      showError(error instanceof Error ? error.message : '批量导入失败');
    } finally {
      setIsSubmitting(false);
      setProgressText('');
    }
  }

  function updateCandidate(clientId: string, updater: (current: EditableCandidate) => EditableCandidate) {
    setCandidates((current) => current.map((item) => (item.client_id === clientId ? updater(item) : item)));
  }

  function updateSelectedCandidates(updater: (current: EditableCandidate) => EditableCandidate) {
    setCandidates((current) =>
      current.map((item) => (selectedClientIds.has(item.client_id) ? updater(item) : item)),
    );
  }

  function toggleCandidateSelection(clientId: string) {
    setSelectedClientIds((current) => {
      const next = new Set(current);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    if (selectedClientIds.size === candidates.length) {
      setSelectedClientIds(new Set());
      return;
    }
    setSelectedClientIds(new Set(candidates.map((item) => item.client_id)));
  }

  function acceptSelected() {
    updateSelectedCandidates((current) => ({
      ...current,
      confirmed: true,
      skipped: false,
    }));
  }

  function skipSelected() {
    updateSelectedCandidates((current) => ({
      ...current,
      skipped: true,
      confirmed: false,
    }));
  }

  function restoreSelected() {
    updateSelectedCandidates((current) => ({
      ...current,
      skipped: false,
      confirmed: current.decision_source === 'rule' ? true : current.confirmed,
    }));
  }

  function applyBulkRevision() {
    const revision = bulkRevisionNo.trim();
    if (!revision) {
      showError('请先输入要批量设置的版本号');
      return;
    }
    updateSelectedCandidates((current) => ({
      ...current,
      revision_no: revision,
    }));
  }

  function acceptAllAiSuggestions() {
    setCandidates((current) =>
      current.map((item) =>
        item.decision_source === 'llm'
          ? { ...item, confirmed: true, skipped: false }
          : item,
      ),
    );
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragActive(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragActive(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      appendFiles(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm">
      <div className="grid h-[94dvh] w-[96vw] max-w-[1500px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <h3 className="text-lg font-bold text-slate-900">批量导入文档</h3>
            <p className="mt-1 text-sm text-slate-500">规则命中自动通过，AI 建议和低置信度项目需要你明确确认后再导入。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 grid-cols-1 overflow-auto lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
          <aside className="border-b border-slate-100 bg-slate-50/60 p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <div
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-3xl border-2 border-dashed px-5 py-8 text-center transition ${
                isDragActive ? 'border-adnoc-blue bg-adnoc-blue/5' : 'border-slate-200 bg-white'
              }`}
            >
              <Upload className={`mx-auto mb-3 h-8 w-8 ${isDragActive ? 'text-adnoc-blue' : 'text-slate-400'}`} />
              <div className="text-sm font-semibold text-slate-700">拖拽目录或批量文件到这里</div>
              <div className="mt-1 text-xs text-slate-400">建议直接拖项目归档目录，系统会结合路径、文件名和 LLM 做归类。</div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <label className={`${secondaryButtonClass} flex-1`}>
                <span className={secondaryButtonIconClass}>
                  <Upload className="h-4 w-4" />
                </span>
                选择文件
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => event.target.files && appendFiles(event.target.files)}
                />
              </label>
              <label className={`${softPrimaryButtonClass} flex-1`}>
                <span className={softPrimaryButtonIconClass}>
                  <Upload className="h-4 w-4" />
                </span>
                选择目录
                <input
                  type="file"
                  multiple
                  className="hidden"
                  {...({ webkitdirectory: 'true' } as Record<string, string>)}
                  onChange={(event) => event.target.files && appendFiles(event.target.files)}
                />
              </label>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-slate-900">当前队列</div>
              <div className="text-xs text-slate-400">已加入 {queue.length} 个文件</div>
              <div className="mt-3 max-h-60 overflow-auto rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                {queue.length === 0 ? (
                  <div className="text-sm text-slate-400">尚未选择文件</div>
                ) : (
                  <div className="space-y-2">
                    {queue.map((item) => (
                      <div key={item.clientId} className="rounded-xl bg-white px-3 py-2 text-xs">
                        <div className="font-medium text-slate-700">{item.file.name}</div>
                        <div className="mt-1 text-slate-400">{item.relativePath || '无相对路径'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button type="button" onClick={() => void handleAnalyze()} disabled={queue.length === 0 || isAnalyzing || isSubmitting} className={`${primaryButtonClass} mt-5 w-full`}>
              <span className={primaryButtonIconClass}>
                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              </span>
              生成导入建议
            </button>
          </aside>

          <section className="flex min-h-[520px] min-w-0 flex-col overflow-hidden p-4 sm:p-5 lg:min-h-0">
            <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
              <div>
                <h4 className="text-base font-semibold text-slate-900">导入候选</h4>
                <p className="mt-1 text-xs text-slate-400">
                  待确认 {pendingConfirmationCount} 项，缺少必要字段 {invalidCount} 项
                </p>
              </div>
              {progressText ? <div className="text-sm text-adnoc-blue">{progressText}</div> : null}
            </div>

            {candidates.length > 0 ? (
              <div className="mb-4 shrink-0 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={toggleSelectAllVisible} className={secondaryButtonClass}>
                    <span className={secondaryButtonIconClass}>
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    {selectedClientIds.size === candidates.length ? '取消全选' : '全选当前结果'}
                  </button>
                  <button type="button" onClick={acceptSelected} disabled={selectedCount === 0} className={secondaryButtonClass}>
                    接受选中项
                  </button>
                  <button type="button" onClick={skipSelected} disabled={selectedCount === 0} className={secondaryButtonClass}>
                    跳过选中项
                  </button>
                  <button type="button" onClick={restoreSelected} disabled={selectedCount === 0} className={secondaryButtonClass}>
                    恢复选中项
                  </button>
                  <button type="button" onClick={acceptAllAiSuggestions} className={softPrimaryButtonClass}>
                    <span className={softPrimaryButtonIconClass}>
                      <Wand2 className="h-4 w-4" />
                    </span>
                    接受全部 AI 建议
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    value={bulkRevisionNo}
                    onChange={(event) => setBulkRevisionNo(event.target.value)}
                    placeholder="对选中项批量设置版本号，如 A / 0 / REV1"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10 sm:min-w-[280px]"
                  />
                  <button type="button" onClick={applyBulkRevision} disabled={selectedCount === 0} className={secondaryButtonClass}>
                    批量设版本号
                  </button>
                  <div className="text-xs text-slate-400">已选 {selectedCount} 项</div>
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-100">
              {candidates.length === 0 ? (
                <div className="flex h-full items-center justify-center p-12 text-sm text-slate-400">
                  先拖入文件并执行“生成导入建议”。
                </div>
              ) : (
                <table className="w-full min-w-[860px] table-fixed text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-11 px-3 py-3">选择</th>
                      <th className="w-[240px] px-3 py-3">文件</th>
                      <th className="w-24 px-3 py-3">版本</th>
                      <th className="w-28 px-3 py-3">处理</th>
                      <th className="w-48 px-3 py-3">文档编号</th>
                      <th className="px-3 py-3">标题</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidates.map((candidate) => (
                      <tr key={candidate.client_id} className={candidate.skipped ? 'bg-slate-50/60 opacity-60' : ''}>
                        <td className="px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            checked={selectedClientIds.has(candidate.client_id)}
                            onChange={() => toggleCandidateSelection(candidate.client_id)}
                          />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="break-all font-medium text-slate-700">{candidate.filename}</div>
                          <div className="mt-1 break-all text-xs text-slate-400">{candidate.relative_path || '无相对路径'}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <StatusBadge candidate={candidate} />
                          </div>
                          {candidate.match_reasons.length > 0 ? (
                            <div className="mt-2 space-y-0.5 text-xs text-slate-400">
                              {candidate.match_reasons.map((reason, index) => (
                                <div key={`${candidate.client_id}-${index}`} className="break-all">{reason}</div>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <input
                            value={candidate.revision_no}
                            onChange={(event) => updateCandidate(candidate.client_id, (current) => ({ ...current, revision_no: event.target.value }))}
                            className={inputClass}
                          />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateCandidate(candidate.client_id, (current) => ({
                                  ...current,
                                  confirmed: true,
                                  skipped: false,
                                }))
                              }
                              className={`${candidate.confirmed && !candidate.skipped ? softPrimaryButtonClass : secondaryButtonClass} w-full !px-3 !py-2`}
                            >
                              接受
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateCandidate(candidate.client_id, (current) => ({
                                  ...current,
                                  skipped: true,
                                  confirmed: false,
                                }))
                              }
                              className={`${candidate.skipped ? softPrimaryButtonClass : secondaryButtonClass} w-full !px-3 !py-2`}
                            >
                              跳过
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <input
                            value={candidate.document_no}
                            onChange={(event) => updateCandidate(candidate.client_id, (current) => ({ ...current, document_no: event.target.value }))}
                            className={inputClass}
                          />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <textarea
                            value={candidate.title}
                            onChange={(event) => updateCandidate(candidate.client_id, (current) => ({ ...current, title: event.target.value }))}
                            rows={2}
                            className={`${inputClass} min-h-[72px] resize-y`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
          <div className="text-sm text-slate-400">
            规则命中会自动通过，AI 建议与人工处理项必须由你明确确认后才能导入。
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={candidates.length === 0 || isSubmitting || pendingConfirmationCount > 0 || invalidCount > 0}
              className={primaryButtonClass}
            >
              <span className={primaryButtonIconClass}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              </span>
              开始导入
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ candidate }: { candidate: EditableCandidate }) {
  if (candidate.skipped) {
    return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">已跳过</span>;
  }
  if (candidate.decision_source === 'rule') {
    return <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">规则通过</span>;
  }
  if (candidate.decision_source === 'llm') {
    return <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">AI 建议待确认</span>;
  }
  return <span className="rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-700">人工处理</span>;
}

async function ensureDocument(
  projectId: string,
  candidate: EditableCandidate,
  cache: Map<string, string>,
) {
  const documentNo = candidate.document_no.trim();
  if (cache.has(documentNo)) {
    return cache.get(documentNo)!;
  }
  if (candidate.matched_document_id && documentNo === (candidate.suggested_document_no ?? '')) {
    cache.set(documentNo, candidate.matched_document_id);
    return candidate.matched_document_id;
  }

  const existing = await getProjectDocuments(projectId, {
    keyword: documentNo,
    page_size: 20,
  });
  const exact = existing.items.find((item) => item.document_no === documentNo);
  if (exact) {
    cache.set(documentNo, exact.id);
    return exact.id;
  }

  const created = await createProjectDocument(projectId, {
    document_no: documentNo,
    title: candidate.title.trim() || documentNo,
    document_type_id: null,
    discipline: null,
    attributes: {},
    pbs_node_ids: [],
    tag_ids: [],
    status: 'active',
    metadata: {},
  });
  cache.set(documentNo, created.id);
  return created.id;
}

async function ensureRevision(
  projectId: string,
  documentId: string,
  candidate: EditableCandidate,
  cache: Map<string, string>,
) {
  const key = `${documentId}::${candidate.revision_no.trim()}`;
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  if (candidate.matched_revision_id && candidate.revision_no.trim() === (candidate.suggested_revision_no ?? '')) {
    cache.set(key, candidate.matched_revision_id);
    return candidate.matched_revision_id;
  }

  const detail: ProjectDocumentDetail = await getProjectDocumentDetail(projectId, documentId);
  const existing = detail.revisions.find((item) => item.revision_no === candidate.revision_no.trim());
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }

  const created = await createProjectDocumentRevision(projectId, documentId, {
    revision_no: candidate.revision_no.trim(),
    state: 'draft',
    issued_at: null,
    change_summary: '批量导入自动创建',
    set_as_current: detail.revisions.length === 0,
  });
  cache.set(key, created.id);
  return created.id;
}

async function uploadFile(
  projectId: string,
  documentId: string,
  revisionId: string,
  candidate: EditableCandidate,
  file: File,
  relativePath: string | null,
) {
  const init = await initiateProjectDocumentUpload(projectId, documentId, revisionId, {
    filename: file.name,
    file_role: candidate.file_role,
    relative_path: relativePath,
    content_type: file.type || null,
    size_bytes: file.size,
    checksum_sha256: null,
  });

  const uploadResponse = await fetch(init.upload_url, {
    method: 'PUT',
    headers: init.upload_headers,
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`上传文件失败: ${file.name}`);
  }
  await completeProjectDocumentUpload(projectId, documentId, revisionId, init.file_id);
}
