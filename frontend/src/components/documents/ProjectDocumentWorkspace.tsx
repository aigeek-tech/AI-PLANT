import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Eye,
  FileStack,
  FolderTree,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  completeProjectDocumentUpload,
  createDocumentConversionJob,
  createProjectDocument,
  createProjectDocumentRevision,
  deleteProjectDocument,
  deleteProjectDocumentRevision,
  getDocumentConversionJobs,
  getDocumentVisualizations,
  getCommonDocumentTypeAttributes,
  getDocumentTypeDetail,
  getDocumentTypes,
  getProjectDocumentDetail,
  getProjectDocuments,
  initiateProjectDocumentUpload,
  searchProjectTags,
  retryDocumentConversionJob,
  type DocumentConversionJob,
  type DocumentVisualization,
  type DocumentType,
  type DocumentTypeAttribute,
  type DocumentTypeDetail,
  type LinkedPbsNodeSummary,
  type LinkedTagSummary,
  type PbsNode,
  type ProjectDocumentDetail,
  type ProjectDocumentFile,
  type ProjectDocumentListItem,
  type ProjectDocumentRevision,
  type ProjectTagSearchItem,
  updateProjectDocument,
  updateProjectDocumentRevision,
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
import { BulkDocumentImportDialog } from './BulkDocumentImportDialog';
import { DocumentPreviewDialog } from './DocumentPreviewDialog';
import { useDialog } from '../ui/Dialog';
import { SearchableSelect } from '../ui/SearchableSelect';

interface ProjectDocumentWorkspaceProps {
  projectId: string;
  standardId?: string | null;
  pbsNodes: PbsNode[];
}

interface DocumentDraft {
  id?: string;
  document_no: string;
  title: string;
  document_type_id: string;
  discipline: string;
  status: 'active' | 'archived';
  pbs_node_ids: string[];
  tag_ids: string[];
  attribute_values: Record<string, unknown>;
}

interface RevisionDraft {
  id?: string;
  revision_no: string;
  state: 'draft' | 'issued' | 'void';
  issued_at: string;
  change_summary: string;
  set_as_current: boolean;
}

interface UploadItem {
  file: File;
  file_role: 'primary' | 'source' | 'attachment' | 'reference';
  relative_path: string | null;
}

type UploadProgressPhase = 'preparing' | 'uploading' | 'finalizing' | 'done';

interface UploadProgress {
  phase: UploadProgressPhase;
  currentIndex: number;
  totalCount: number;
  fileName: string;
  fileLoadedBytes: number;
  fileTotalBytes: number;
  uploadedBytes: number;
  totalBytes: number;
}

interface PreviewTarget {
  documentId: string;
  revisionId: string;
  fileId: string;
}

function documentToDraft(document?: ProjectDocumentDetail | null): DocumentDraft {
  return {
    id: document?.id,
    document_no: document?.document_no ?? '',
    title: document?.title ?? '',
    document_type_id: document?.document_type_id ?? '',
    discipline: document?.discipline ?? '',
    status: document?.status ?? 'active',
    pbs_node_ids: document?.pbs_node_ids ?? [],
    tag_ids: document?.tag_ids ?? [],
    attribute_values: document?.attributes ?? {},
  };
}

function revisionToDraft(revision?: ProjectDocumentRevision | null): RevisionDraft {
  return {
    id: revision?.id,
    revision_no: revision?.revision_no ?? '',
    state: revision?.state ?? 'draft',
    issued_at: revision?.issued_at ? revision.issued_at.slice(0, 10) : '',
    change_summary: revision?.change_summary ?? '',
    set_as_current: revision?.is_current ?? true,
  };
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadPercent(loadedBytes: number, totalBytes: number) {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((loadedBytes / totalBytes) * 100)));
}

function uploadBlobWithProgress(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
) {
  return new Promise<string | null>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    xhr.upload.onprogress = (event) => {
      const totalBytes = event.lengthComputable ? event.total : file.size;
      onProgress(event.loaded, totalBytes);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size, file.size);
        resolve(xhr.getResponseHeader('ETag'));
        return;
      }
      reject(new Error(`上传文件失败: ${file.name}`));
    };
    xhr.onerror = () => reject(new Error(`上传文件失败: ${file.name}`));
    xhr.onabort = () => reject(new Error(`上传已取消: ${file.name}`));
    xhr.send(file);
  });
}

function isSparkPreviewFile(filename: string) {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return ['ply', 'spz', 'splat', 'ksplat', 'sog', 'zip', 'rad'].includes(extension);
}

function isRadFile(filename: string) {
  return filename.toLowerCase().endsWith('.rad');
}

function isRvmFile(filename: string) {
  return filename.toLowerCase().endsWith('.rvm');
}

function isVueFile(filename: string) {
  return filename.toLowerCase().endsWith('.vue');
}

function normalizeAttributeValue(attribute: DocumentTypeAttribute, value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  if (attribute.value_type === 'number') return Number(value);
  if (attribute.value_type === 'integer') return Number.parseInt(String(value), 10);
  if (attribute.value_type === 'boolean') return Boolean(value);
  return value;
}

export function ProjectDocumentWorkspace({ projectId, standardId, pbsNodes }: ProjectDocumentWorkspaceProps) {
  const { success, error: showError } = useToast();
  const { confirm } = useDialog();
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [commonAttributes, setCommonAttributes] = useState<DocumentTypeAttribute[]>([]);
  const [typeDetails, setTypeDetails] = useState<Record<string, DocumentTypeDetail>>({});
  const [documents, setDocuments] = useState<ProjectDocumentListItem[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<ProjectDocumentDetail | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [filters, setFilters] = useState({ keyword: '', document_type_id: '', status: '' as '' | 'active' | 'archived' });
  const [documentDraft, setDocumentDraft] = useState<DocumentDraft | null>(null);
  const [revisionDraft, setRevisionDraft] = useState<RevisionDraft | null>(null);
  const [uploadRevisionId, setUploadRevisionId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [revisionVisualizations, setRevisionVisualizations] = useState<DocumentVisualization[]>([]);
  const [revisionConversionJobs, setRevisionConversionJobs] = useState<DocumentConversionJob[]>([]);

  const loadTypes = useCallback(async () => {
    if (!standardId) {
      setTypes([]);
      setCommonAttributes([]);
      return;
    }
    try {
      const [nextTypes, nextCommonAttributes] = await Promise.all([
        getDocumentTypes(standardId),
        getCommonDocumentTypeAttributes(standardId),
      ]);
      setTypes(nextTypes);
      setCommonAttributes(nextCommonAttributes);
    } catch (error) {
      showError(error instanceof Error ? error.message : '加载文档类型失败');
    }
  }, [showError, standardId]);

  const ensureTypeDetail = useCallback(async (typeId: string | null | undefined) => {
    if (!typeId) return null;
    if (typeDetails[typeId]) return typeDetails[typeId];
    const detail = await getDocumentTypeDetail(typeId);
    setTypeDetails((current) => ({ ...current, [typeId]: detail }));
    return detail;
  }, [typeDetails]);

  const loadDocuments = useCallback(async (nextSelectedId?: string | null) => {
    setIsListLoading(true);
    try {
      const result = await getProjectDocuments(projectId, {
        keyword: filters.keyword || undefined,
        document_type_id: filters.document_type_id || undefined,
        status: filters.status || undefined,
      });
      setDocuments(result.items);
      setSelectedDocumentId((currentDocumentId) => {
        const preferredDocumentId = nextSelectedId ?? currentDocumentId;
        if (preferredDocumentId && result.items.some((item) => item.id === preferredDocumentId)) {
          return preferredDocumentId;
        }
        return result.items[0]?.id ?? null;
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : '加载图纸清单失败');
    } finally {
      setIsListLoading(false);
    }
  }, [filters.document_type_id, filters.keyword, filters.status, projectId, showError]);

  const loadDocumentDetail = useCallback(async (documentId: string) => {
    setIsDetailLoading(true);
    try {
      const detail = await getProjectDocumentDetail(projectId, documentId);
      setSelectedDocument(detail);
      setSelectedRevisionId((currentRevisionId) => {
        if (currentRevisionId && detail.revisions.some((revision) => revision.id === currentRevisionId)) {
          return currentRevisionId;
        }
        return detail.current_revision_id ?? detail.revisions[0]?.id ?? null;
      });
      if (detail.document_type_id) {
        const typeDetail = await getDocumentTypeDetail(detail.document_type_id);
        setTypeDetails((current) => ({ ...current, [detail.document_type_id!]: typeDetail }));
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : '加载图纸详情失败');
      setSelectedDocument(null);
      setSelectedRevisionId(null);
    } finally {
      setIsDetailLoading(false);
    }
  }, [projectId, showError]);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (selectedDocumentId) {
      void loadDocumentDetail(selectedDocumentId);
    } else {
      setSelectedDocument(null);
      setSelectedRevisionId(null);
    }
  }, [loadDocumentDetail, selectedDocumentId]);

  const selectedRevision =
    selectedDocument?.revisions.find((revision) => revision.id === selectedRevisionId) ??
    selectedDocument?.revisions[0] ??
    null;

  const loadRevisionVisualizations = useCallback(async () => {
    if (!selectedDocument || !selectedRevision) {
      setRevisionVisualizations([]);
      return;
    }
    try {
      const result = await getDocumentVisualizations(projectId, selectedDocument.id, selectedRevision.id);
      setRevisionVisualizations(result);
    } catch (error) {
      setRevisionVisualizations([]);
      showError(error instanceof Error ? error.message : '加载 3D 预览配置失败');
    }
  }, [projectId, selectedDocument, selectedRevision, showError]);

  useEffect(() => {
    void loadRevisionVisualizations();
  }, [loadRevisionVisualizations]);

  const loadRevisionConversionJobs = useCallback(async () => {
    if (!selectedDocument || !selectedRevision) {
      setRevisionConversionJobs([]);
      return;
    }
    try {
      const result = await getDocumentConversionJobs(projectId, selectedDocument.id, selectedRevision.id);
      setRevisionConversionJobs(result);
    } catch (error) {
      setRevisionConversionJobs([]);
      showError(error instanceof Error ? error.message : '加载模型转换状态失败');
    }
  }, [projectId, selectedDocument, selectedRevision, showError]);

  useEffect(() => {
    void loadRevisionConversionJobs();
  }, [loadRevisionConversionJobs]);

  useEffect(() => {
    if (!revisionConversionJobs.some((job) => job.status === 'queued' || job.status === 'running')) return;
    const timer = window.setInterval(() => {
      void Promise.all([loadRevisionConversionJobs(), loadRevisionVisualizations(), selectedDocument ? loadDocumentDetail(selectedDocument.id) : Promise.resolve()]);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadDocumentDetail, loadRevisionConversionJobs, loadRevisionVisualizations, revisionConversionJobs, selectedDocument]);

  const conversionJobBySourceFileId = useMemo(() => {
    const jobs = new Map<string, DocumentConversionJob>();
    revisionConversionJobs.forEach((job) => {
      if (!jobs.has(job.source_file_id)) jobs.set(job.source_file_id, job);
    });
    return jobs;
  }, [revisionConversionJobs]);

  const conversionJobByOutputFileId = useMemo(() => {
    const jobs = new Map<string, DocumentConversionJob>();
    revisionConversionJobs.forEach((job) => {
      if (job.output_file_id && !jobs.has(job.output_file_id)) jobs.set(job.output_file_id, job);
    });
    return jobs;
  }, [revisionConversionJobs]);

  const defaultPreviewFileId = useMemo(() => {
    if (revisionVisualizations[0]) return revisionVisualizations[0].preview_file_id;
    return selectedRevision?.files.find((file) => isSparkPreviewFile(file.original_filename))?.id ?? null;
  }, [revisionVisualizations, selectedRevision]);

  async function handleSaveDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!documentDraft) return;

    try {
      const typeDetail = await ensureTypeDetail(documentDraft.document_type_id || null);
      const normalizedAttributes: Record<string, unknown> = {};
      const attributes = [...(typeDetail?.common_attributes ?? []), ...(typeDetail?.attributes ?? [])];
      const attributeCodes = new Set(attributes.map((attribute) => attribute.code));
      for (const attribute of attributes) {
        const normalized = normalizeAttributeValue(attribute, documentDraft.attribute_values[attribute.code]);
        if (normalized !== null && normalized !== '' && normalized !== undefined) {
          normalizedAttributes[attribute.code] = normalized;
        }
      }
      Object.entries(documentDraft.attribute_values).forEach(([code, value]) => {
        if (!attributeCodes.has(code) && value !== null && value !== '' && value !== undefined) {
          normalizedAttributes[code] = value;
        }
      });

      const payload = {
        document_no: documentDraft.document_no.trim(),
        title: documentDraft.title.trim(),
        document_type_id: documentDraft.document_type_id || null,
        discipline: documentDraft.discipline.trim() || null,
        attributes: normalizedAttributes,
        pbs_node_ids: documentDraft.pbs_node_ids,
        tag_ids: documentDraft.tag_ids,
        status: documentDraft.status,
        metadata: {},
      };

      const saved = documentDraft.id
        ? await updateProjectDocument(projectId, documentDraft.id, payload)
        : await createProjectDocument(projectId, payload);

      setDocumentDraft(null);
      success(documentDraft.id ? '图纸已更新' : '图纸已创建');
      await loadDocuments(saved.id);
      await loadDocumentDetail(saved.id);
    } catch (error) {
      showError(error instanceof Error ? error.message : '保存图纸失败');
    }
  }

  async function handleSaveRevision(event: React.FormEvent) {
    event.preventDefault();
    if (!revisionDraft || !selectedDocument) return;

    const payload = {
      revision_no: revisionDraft.revision_no.trim(),
      state: revisionDraft.state,
      issued_at: revisionDraft.issued_at || null,
      change_summary: revisionDraft.change_summary.trim() || null,
      set_as_current: revisionDraft.set_as_current,
    };

    try {
      const saved = revisionDraft.id
        ? await updateProjectDocumentRevision(projectId, selectedDocument.id, revisionDraft.id, payload)
        : await createProjectDocumentRevision(projectId, selectedDocument.id, payload);
      setRevisionDraft(null);
      success(revisionDraft.id ? '版本已更新' : '版本已创建');
      await loadDocuments(selectedDocument.id);
      await loadDocumentDetail(selectedDocument.id);
      setSelectedRevisionId(saved.id);
    } catch (error) {
      showError(error instanceof Error ? error.message : '保存版本失败');
    }
  }

  async function handleDeleteDocument() {
    if (!selectedDocument) return;
    const accepted = await confirm({
      title: '删除图纸',
      description: `确定要删除图纸 ${selectedDocument.document_no} 吗？其版本和归档文件也会一并删除。`,
      confirmText: '删除图纸',
      danger: true,
    });
    if (!accepted) return;

    try {
      const deletedDocumentId = selectedDocument.id;
      await deleteProjectDocument(projectId, selectedDocument.id);
      setSelectedDocumentId(null);
      setSelectedDocument(null);
      setSelectedRevisionId(null);
      setRevisionVisualizations([]);
      setRevisionConversionJobs([]);
      setPreviewTarget((currentTarget) => currentTarget?.documentId === deletedDocumentId ? null : currentTarget);
      setUploadRevisionId(null);
      setRevisionDraft(null);
      setDocumentDraft((currentDraft) => currentDraft?.id === deletedDocumentId ? null : currentDraft);
      success('图纸已删除');
      await loadDocuments();
    } catch (error) {
      showError(error instanceof Error ? error.message : '删除图纸失败');
    }
  }

  async function handleDeleteRevision() {
    if (!selectedDocument || !selectedRevision) return;
    const accepted = await confirm({
      title: '删除版本',
      description: `确定要删除版本 ${selectedRevision.revision_no} 吗？其归档文件也会一并删除。`,
      confirmText: '删除版本',
      danger: true,
    });
    if (!accepted) return;

    try {
      await deleteProjectDocumentRevision(projectId, selectedDocument.id, selectedRevision.id);
      success('版本已删除');
      setRevisionVisualizations([]);
      await loadDocuments(selectedDocument.id);
      await loadDocumentDetail(selectedDocument.id);
    } catch (error) {
      showError(error instanceof Error ? error.message : '删除版本失败');
    }
  }

  async function handleCreateConversionJob(fileId: string) {
    if (!selectedDocument || !selectedRevision) return;
    try {
      await createDocumentConversionJob(projectId, selectedDocument.id, selectedRevision.id, fileId);
      success('模型转换任务已排队');
      await loadRevisionConversionJobs();
    } catch (error) {
      showError(error instanceof Error ? error.message : '创建模型转换任务失败');
    }
  }

  async function handleRetryConversion(job: DocumentConversionJob) {
    if (!selectedDocument || !selectedRevision) return;
    try {
      await retryDocumentConversionJob(projectId, selectedDocument.id, selectedRevision.id, job.id);
      success('模型转换任务已重新排队');
      await loadRevisionConversionJobs();
    } catch (error) {
      showError(error instanceof Error ? error.message : '重试模型转换失败');
    }
  }

  function handleOpenFile(fileId: string) {
    if (!selectedDocument || !selectedRevision) return;
    const file = selectedRevision.files.find((item) => item.id === fileId);
    if (file && file.status !== 'ready') {
      showError('文件上传尚未完成，暂不能预览');
      return;
    }
    setPreviewTarget({
      documentId: selectedDocument.id,
      revisionId: selectedRevision.id,
      fileId,
    });
  }

  async function handleUploadFiles(items: UploadItem[], onProgress?: (progress: UploadProgress) => void) {
    if (!selectedDocument || !selectedRevision) return;
    try {
      const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
      let completedBytes = 0;

      for (const [index, item] of items.entries()) {
        const baseProgress = {
          currentIndex: index + 1,
          totalCount: items.length,
          fileName: item.file.name,
          fileLoadedBytes: 0,
          fileTotalBytes: item.file.size,
          uploadedBytes: completedBytes,
          totalBytes,
        };
        onProgress?.({ ...baseProgress, phase: 'preparing' });

        const init = await initiateProjectDocumentUpload(projectId, selectedDocument.id, selectedRevision.id, {
          filename: item.file.name,
          file_role: item.file_role,
          relative_path: item.relative_path,
          content_type: item.file.type || null,
          size_bytes: item.file.size,
          checksum_sha256: null,
        });

        const etag = await uploadBlobWithProgress(init.upload_url, init.upload_headers, item.file, (loadedBytes, totalFileBytes) => {
          const fileTotalBytes = totalFileBytes > 0 ? totalFileBytes : item.file.size;
          const fileLoadedBytes = Math.min(loadedBytes, fileTotalBytes);
          onProgress?.({
            ...baseProgress,
            phase: 'uploading',
            fileLoadedBytes,
            fileTotalBytes,
            uploadedBytes: Math.min(completedBytes + fileLoadedBytes, totalBytes),
          });
        });

        onProgress?.({
          ...baseProgress,
          phase: 'finalizing',
          fileLoadedBytes: item.file.size,
          uploadedBytes: Math.min(completedBytes + item.file.size, totalBytes),
        });
        await completeProjectDocumentUpload(projectId, selectedDocument.id, selectedRevision.id, init.file_id, { etag });
        completedBytes += item.file.size;
      }

      onProgress?.({
        phase: 'done',
        currentIndex: items.length,
        totalCount: items.length,
        fileName: items.at(-1)?.file.name ?? '',
        fileLoadedBytes: items.at(-1)?.file.size ?? 0,
        fileTotalBytes: items.at(-1)?.file.size ?? 0,
        uploadedBytes: totalBytes,
        totalBytes,
      });
      success(`已上传 ${items.length} 个文件`);
      setUploadRevisionId(null);
      await loadDocuments(selectedDocument.id);
      await loadDocumentDetail(selectedDocument.id);
      await loadRevisionConversionJobs();
      await loadRevisionVisualizations();
    } catch (error) {
      showError(error instanceof Error ? error.message : '上传图纸文件失败');
    }
  }

  function getFileConversionJob(file: ProjectDocumentFile) {
    return conversionJobBySourceFileId.get(file.id) ?? conversionJobByOutputFileId.get(file.id) ?? null;
  }

  function hasSparkVisualization(file: ProjectDocumentFile) {
    return revisionVisualizations.some((visualization) =>
      [visualization.preview_file_id, visualization.source_file_id].includes(file.id),
    );
  }

  function renderFileStatus(file: ProjectDocumentFile) {
    const job = getFileConversionJob(file);
    const isSparkAsset = isSparkPreviewFile(file.original_filename);
    const isReadyRadWithoutVisualization = file.status === 'ready' && isRadFile(file.original_filename) && !hasSparkVisualization(file);
    if (job?.status === 'queued' || job?.status === 'running') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
          <Loader2 className="h-3 w-3 animate-spin" />
          转换中
        </span>
      );
    }
    if (job?.status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600 ring-1 ring-red-200" title={job.error ?? undefined}>
          <AlertTriangle className="h-3 w-3" />
          转换失败
        </span>
      );
    }
    if (isReadyRadWithoutVisualization) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
          <AlertTriangle className="h-3 w-3" />
          缺少 RAD 分片
        </span>
      );
    }
    if (job?.status === 'completed' || isSparkAsset) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-3 w-3" />
          3D 可查看
        </span>
      );
    }
    if (isRvmFile(file.original_filename)) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
          待转换
        </span>
      );
    }
    if (isVueFile(file.original_filename)) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
          VUE 暂不支持自动转换
        </span>
      );
    }
    return null;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">图纸清单</h2>
          <p className="mt-1 text-sm text-slate-500">项目级图纸编号、版本历史和归档文件在这里集中管理。</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => setIsBulkImportOpen(true)} className={softPrimaryButtonClass}>
            <span className={softPrimaryButtonIconClass}>
              <Upload className="h-4 w-4" />
            </span>
            批量导入文档
          </button>
          <button type="button" onClick={() => setDocumentDraft(documentToDraft())} className={primaryButtonClass}>
            <span className={primaryButtonIconClass}>
              <Plus className="h-4 w-4" />
            </span>
            新建文档
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-[1fr_220px_180px_auto] gap-3">
        <input
          value={filters.keyword}
          onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void loadDocuments();
            }
          }}
          placeholder="按图纸编号或名称搜索"
          className={inputClass}
        />
        <SearchableSelect
          value={filters.document_type_id}
          onChange={(nextValue) => setFilters((current) => ({ ...current, document_type_id: nextValue }))}
          className={inputClass}
          placeholder="全部类型"
          clearable
          options={types.map((type) => ({
            value: type.id,
            label: `${'　'.repeat(Math.max(0, type.level_no - 1))}${type.name}`,
            keywords: type.code,
          }))}
          searchPlaceholder="搜索文档类型"
        />
        <SearchableSelect
          value={filters.status}
          onChange={(nextValue) => setFilters((current) => ({ ...current, status: nextValue as '' | 'active' | 'archived' }))}
          className={inputClass}
          placeholder="全部状态"
          clearable
          options={[
            { value: 'active', label: '启用' },
            { value: 'archived', label: '归档' },
          ]}
          searchPlaceholder="搜索状态"
        />
        <button type="button" onClick={() => void loadDocuments()} className={secondaryButtonClass}>刷新</button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(420px,1fr)_420px] gap-5">
        <section className="min-w-0 min-h-0 overflow-hidden rounded-3xl border border-white/50 bg-white/70 shadow-xl shadow-slate-200/50 backdrop-blur-xl">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-900">图纸列表</h3>
          </div>
          <div className="h-full overflow-auto">
            {isListLoading ? (
              <div className="flex justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-adnoc-blue" /></div>
            ) : documents.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-400">暂无图纸记录</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">编号</th>
                    <th className="px-5 py-3">名称</th>
                    <th className="px-5 py-3">类型</th>
                    <th className="px-5 py-3">当前版本</th>
                    <th className="px-5 py-3">文件</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.map((document) => (
                    <tr
                      key={document.id}
                      onClick={() => setSelectedDocumentId(document.id)}
                      className={`cursor-pointer transition hover:bg-slate-50/70 ${selectedDocumentId === document.id ? 'bg-adnoc-blue/5' : ''}`}
                    >
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{document.document_no}</td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-800">{document.title}</div>
                        <div className="text-xs text-slate-400">{document.discipline || '未设置专业'}</div>
                      </td>
                      <td className="px-5 py-3 text-slate-500">{document.document_type_name || '-'}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {document.current_revision_no ? `${document.current_revision_no} / ${document.current_revision_state}` : '-'}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{document.file_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="min-w-0 min-h-0 overflow-hidden rounded-3xl border border-white/50 bg-white/70 shadow-xl shadow-slate-200/50 backdrop-blur-xl">
          {isDetailLoading ? (
            <div className="flex h-full items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-adnoc-blue" /></div>
          ) : selectedDocument ? (
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-100 px-6 py-5">
                <div className="flex flex-col gap-4">
                  <div className="min-w-0">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-adnoc-blue/10 p-3 text-adnoc-blue"><FileStack className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 break-words text-xl font-bold leading-7 text-slate-900" title={selectedDocument.title}>{selectedDocument.title}</h3>
                        <p className="mt-1 break-all font-mono text-xs text-slate-400" title={selectedDocument.document_no}>{selectedDocument.document_no}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">{selectedDocument.document_type_name || '未分类'}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">{selectedDocument.status}</span>
                      {selectedDocument.discipline && <span className="rounded-full bg-slate-100 px-2.5 py-1">{selectedDocument.discipline}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void handleDeleteDocument()} className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}>
                      <span className={secondaryButtonIconClass}>
                        <Trash2 className="h-4 w-4" />
                      </span>
                      删除
                    </button>
                    <button type="button" onClick={() => setDocumentDraft(documentToDraft(selectedDocument))} className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}>
                      <span className={secondaryButtonIconClass}>
                        <Pencil className="h-4 w-4" />
                      </span>
                      编辑
                    </button>
                    <button type="button" onClick={() => setRevisionDraft(revisionToDraft())} className={`${softPrimaryButtonClass} shrink-0 whitespace-nowrap`}>
                      <span className={softPrimaryButtonIconClass}>
                        <Plus className="h-4 w-4" />
                      </span>
                      新增版本
                    </button>
                  </div>
                </div>
                <div className="mt-4 space-y-3 text-sm text-slate-500">
                  <div className="flex items-start gap-2">
                    <FolderTree className="mt-0.5 h-4 w-4 text-slate-300" />
                    <div className="flex flex-wrap gap-2">
                      {selectedDocument.pbs_nodes.length > 0 ? selectedDocument.pbs_nodes.map((node) => (
                        <span key={node.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{node.code} {node.name}</span>
                      )) : <span className="text-xs text-slate-400">未关联 PBS</span>}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Link2 className="mt-0.5 h-4 w-4 text-slate-300" />
                    <div className="flex flex-wrap gap-2">
                      {selectedDocument.tags.length > 0 ? selectedDocument.tags.map((tag) => (
                        <span key={tag.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{tag.tag_no}</span>
                      )) : <span className="text-xs text-slate-400">未关联位号</span>}
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
                <div className="border-b border-slate-100 px-6 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="font-semibold text-slate-900">版本历史</h4>
                    {selectedRevision && (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setUploadRevisionId(selectedRevision.id)} className={softPrimaryButtonClass}>
                          <Upload className="h-4 w-4" />
                          上传文件
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {selectedDocument.revisions.map((revision) => (
                      <button
                        type="button"
                        key={revision.id}
                        onClick={() => setSelectedRevisionId(revision.id)}
                        className={`min-w-[120px] rounded-2xl border px-4 py-3 text-left transition ${
                          selectedRevisionId === revision.id ? 'border-adnoc-blue bg-adnoc-blue/5' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="font-semibold text-slate-800">{revision.revision_no}</div>
                        <div className="text-xs text-slate-400">{revision.state}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-h-0 overflow-auto px-6 py-5">
                  {selectedRevision ? (
                    <>
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-slate-900">版本 {selectedRevision.revision_no}</h4>
                          <p className="text-xs text-slate-400">{formatDate(selectedRevision.issued_at)}</p>
                          {selectedRevision.change_summary && <p className="mt-2 text-sm text-slate-500">{selectedRevision.change_summary}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {defaultPreviewFileId && (
                            <button
                              type="button"
                              onClick={() => void handleOpenFile(defaultPreviewFileId)}
                              className={primaryButtonClass}
                            >
                              <Box className="h-4 w-4" />
                              3D 预览
                            </button>
                          )}
                          <button type="button" onClick={() => setRevisionDraft(revisionToDraft(selectedRevision))} className={`${secondaryButtonClass} whitespace-nowrap`}>
                            <Pencil className="h-4 w-4" />
                            编辑版本
                          </button>
                          <button type="button" onClick={() => void handleDeleteRevision()} className={`${secondaryButtonClass} whitespace-nowrap`}>
                            <Trash2 className="h-4 w-4" />
                            删除版本
                          </button>
                        </div>
                      </div>
                      {revisionVisualizations.length > 0 && (
                        <div className="mb-4 break-words rounded-2xl border border-primary-100 bg-primary-50/60 px-4 py-3 text-xs text-primary-800">
                          已登记 {revisionVisualizations.length} 个 3D 预览。当前默认使用 <span className="break-all">{revisionVisualizations[0].preview_file_name}</span>
                          {revisionVisualizations[0].annotation_manifest_file_name ? <>，标注清单 <span className="break-all">{revisionVisualizations[0].annotation_manifest_file_name}</span></> : ''}
                        </div>
                      )}
                      {selectedRevision.files.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                          当前版本暂无归档文件
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedRevision.files.map((file) => (
                            <div key={file.id} className="rounded-2xl border border-slate-100 bg-white px-4 py-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="min-w-0 break-all font-medium text-slate-800" title={file.original_filename}>{file.original_filename}</div>
                                    {renderFileStatus(file)}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                    <span>{file.file_role} · {formatBytes(file.size_bytes)} · {file.preview_mode}</span>
                                  </div>
                                  {file.relative_path && <div className="mt-1 break-all font-mono text-[11px] text-slate-400" title={file.relative_path}>{file.relative_path}</div>}
                                  {getFileConversionJob(file)?.status === 'failed' && getFileConversionJob(file)?.error && (
                                    <div className="mt-2 max-w-2xl text-xs text-red-500">{getFileConversionJob(file)?.error}</div>
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                  {isRvmFile(file.original_filename) && !getFileConversionJob(file) && (
                                    <button type="button" onClick={() => void handleCreateConversionJob(file.id)} className={secondaryButtonClass}>
                                      <RefreshCw className="h-4 w-4" />
                                      转换
                                    </button>
                                  )}
                                  {getFileConversionJob(file)?.status === 'failed' && (
                                    <button type="button" onClick={() => void handleRetryConversion(getFileConversionJob(file)!)} className={secondaryButtonClass}>
                                      <RefreshCw className="h-4 w-4" />
                                      重试
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void handleOpenFile(file.id)}
                                    disabled={file.status !== 'ready'}
                                    title={file.status !== 'ready' ? '文件上传尚未完成，暂不能预览' : undefined}
                                    className={secondaryButtonClass}
                                  >
                                    <Eye className="h-4 w-4" />
                                    {isSparkPreviewFile(file.original_filename) ? '3D 预览' : '预览'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-3xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
                      暂无版本，请先创建一个版本。
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">请选择左侧图纸</div>
          )}
        </section>
      </div>

      {documentDraft && (
        <DocumentModal
          projectId={projectId}
          draft={documentDraft}
          types={types}
          commonAttributes={commonAttributes}
          typeDetail={documentDraft.document_type_id ? typeDetails[documentDraft.document_type_id] ?? null : null}
          ensureTypeDetail={ensureTypeDetail}
          pbsNodes={pbsNodes}
          initialPbsOptions={selectedDocument?.pbs_nodes ?? []}
          initialTagOptions={selectedDocument?.tags ?? []}
          onChange={setDocumentDraft}
          onSubmit={handleSaveDocument}
          onClose={() => setDocumentDraft(null)}
        />
      )}
      {revisionDraft && (
        <RevisionModal draft={revisionDraft} onChange={setRevisionDraft} onSubmit={handleSaveRevision} onClose={() => setRevisionDraft(null)} />
      )}
      {uploadRevisionId && selectedDocument && (
        <UploadDialog
          document={selectedDocument}
          revision={selectedDocument.revisions.find((item) => item.id === uploadRevisionId) ?? null}
          onSubmit={handleUploadFiles}
          onClose={() => setUploadRevisionId(null)}
        />
      )}
      {isBulkImportOpen && (
        <BulkDocumentImportDialog
          projectId={projectId}
          onClose={() => setIsBulkImportOpen(false)}
          onImported={async () => {
            await loadDocuments();
          }}
        />
      )}

      {previewTarget && (
        <DocumentPreviewDialog
          projectId={projectId}
          documentId={previewTarget.documentId}
          revisionId={previewTarget.revisionId}
          fileId={previewTarget.fileId}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  );
}

function DocumentModal({
  projectId,
  draft,
  types,
  commonAttributes,
  typeDetail,
  ensureTypeDetail,
  pbsNodes,
  initialPbsOptions,
  initialTagOptions,
  onChange,
  onSubmit,
  onClose,
}: {
  projectId: string;
  draft: DocumentDraft;
  types: DocumentType[];
  commonAttributes: DocumentTypeAttribute[];
  typeDetail: DocumentTypeDetail | null;
  ensureTypeDetail: (typeId: string | null | undefined) => Promise<DocumentTypeDetail | null>;
  pbsNodes: PbsNode[];
  initialPbsOptions: LinkedPbsNodeSummary[];
  initialTagOptions: LinkedTagSummary[];
  onChange: (next: DocumentDraft) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (draft.document_type_id) {
      void ensureTypeDetail(draft.document_type_id);
    }
  }, [draft.document_type_id, ensureTypeDetail]);

  const effectiveCommonAttributes = typeDetail?.common_attributes ?? commonAttributes;
  const allAttributes = useMemo(
    () => [...effectiveCommonAttributes, ...(typeDetail?.attributes ?? [])],
    [effectiveCommonAttributes, typeDetail],
  );

  function toggleSelection(key: 'pbs_node_ids' | 'tag_ids', value: string) {
    const nextValues = draft[key].includes(value)
      ? draft[key].filter((item) => item !== value)
      : [...draft[key], value];
    onChange({ ...draft, [key]: nextValues });
  }

  function updateAttributeValue(attribute: DocumentTypeAttribute, value: unknown) {
    onChange({
      ...draft,
      attribute_values: {
        ...draft.attribute_values,
        [attribute.code]: value,
      },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="grid max-h-[90vh] w-full max-w-6xl grid-cols-[1.2fr_1fr] overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl">
        <div className="overflow-auto p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">{draft.id ? '编辑图纸' : '新建图纸'}</h3>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4">
            <Field label="图纸编号" required>
              <input value={draft.document_no} onChange={(event) => onChange({ ...draft, document_no: event.target.value })} required className={inputClass} />
            </Field>
            <Field label="图纸名称" required>
              <input value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} required className={inputClass} />
            </Field>
            <Field label="图纸类型">
              <SearchableSelect
                value={draft.document_type_id}
                onChange={(nextValue) => onChange({ ...draft, document_type_id: nextValue, attribute_values: {} })}
                className={inputClass}
                placeholder="未指定"
                clearable
                options={types.map((type) => ({
                  value: type.id,
                  label: `${'　'.repeat(Math.max(0, type.level_no - 1))}${type.name}`,
                  keywords: type.code,
                }))}
                searchPlaceholder="搜索图纸类型"
              />
            </Field>
            <Field label="专业">
              <input value={draft.discipline} onChange={(event) => onChange({ ...draft, discipline: event.target.value })} className={inputClass} placeholder="如 process / piping / civil" />
            </Field>
            <Field label="状态">
              <SearchableSelect
                value={draft.status}
                onChange={(nextValue) => onChange({ ...draft, status: nextValue as DocumentDraft['status'] })}
                className={inputClass}
                options={[
                  { value: 'active', label: '启用' },
                  { value: 'archived', label: '归档' },
                ]}
                searchPlaceholder="搜索状态"
              />
            </Field>

            {allAttributes.length > 0 && (
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">属性填写</div>
                {effectiveCommonAttributes.length > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 text-xs font-bold tracking-widest text-slate-400">公共属性</div>
                    <div className="space-y-3">
                      {effectiveCommonAttributes.map((attribute) => (
                        <AttributeInput
                          key={attribute.id}
                          attribute={attribute}
                          value={draft.attribute_values[attribute.code]}
                          onChange={(value) => updateAttributeValue(attribute, value)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {(typeDetail?.attributes?.length ?? 0) > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-bold tracking-widest text-slate-400">类型专属属性</div>
                    <div className="space-y-3">
                      {typeDetail!.attributes.map((attribute) => (
                        <AttributeInput
                          key={attribute.id}
                          attribute={attribute}
                          value={draft.attribute_values[attribute.code]}
                          onChange={(value) => updateAttributeValue(attribute, value)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-auto border-l border-slate-100 bg-slate-50/70 p-6">
          <LocalSelectionSection
            title="关联 PBS 节点"
            searchPlaceholder="按 PBS 编码或名称过滤"
            items={pbsNodes.map((node) => ({ id: node.id, primary: node.code, secondary: node.name }))}
            selectedIds={draft.pbs_node_ids}
            initialSelectedItems={initialPbsOptions.map((node) => ({ id: node.id, primary: node.code, secondary: node.name }))}
            onToggle={(value) => toggleSelection('pbs_node_ids', value)}
          />
          <RemoteTagSelectionSection
            projectId={projectId}
            title="关联位号"
            selectedIds={draft.tag_ids}
            initialSelectedItems={initialTagOptions.map((tag) => ({ id: tag.id, primary: tag.tag_no, secondary: tag.name }))}
            onToggle={(value) => toggleSelection('tag_ids', value)}
          />
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
            <button type="submit" className={primaryButtonClass}>保存</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function AttributeInput({
  attribute,
  value,
  onChange,
}: {
  attribute: DocumentTypeAttribute;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = `${attribute.name}${attribute.is_required ? ' *' : ''}`;

  if (attribute.value_type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
    );
  }

  if (attribute.value_type === 'enum' && attribute.enum_options.length > 0) {
    return (
      <Field label={label}>
        <SearchableSelect
          value={String(value ?? '')}
          onChange={onChange}
          className={inputClass}
          placeholder="请选择"
          clearable
          options={attribute.enum_options.map((option) => ({ value: String(option), label: String(option) }))}
          searchPlaceholder={`搜索${attribute.name}`}
        />
      </Field>
    );
  }

  return (
    <Field label={`${label}${attribute.unit_family ? ` (${attribute.unit_family})` : ''}`}>
      <input
        type={attribute.value_type === 'date' ? 'date' : attribute.value_type === 'number' || attribute.value_type === 'integer' ? 'number' : 'text'}
        value={attribute.value_type === 'date' && typeof value === 'string' ? value.slice(0, 10) : String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        placeholder={attribute.description || attribute.group_name || attribute.name}
      />
    </Field>
  );
}

function RevisionModal({
  draft,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: RevisionDraft;
  onChange: (next: RevisionDraft) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="w-full max-w-xl rounded-3xl border border-white/60 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{draft.id ? '编辑版本' : '新建版本'}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <Field label="版本号" required>
            <input value={draft.revision_no} onChange={(event) => onChange({ ...draft, revision_no: event.target.value })} required className={inputClass} />
          </Field>
          <Field label="状态">
            <SearchableSelect
              value={draft.state}
              onChange={(nextValue) => onChange({ ...draft, state: nextValue as RevisionDraft['state'] })}
              className={inputClass}
              options={[
                { value: 'draft', label: 'draft' },
                { value: 'issued', label: 'issued' },
                { value: 'void', label: 'void' },
              ]}
              searchPlaceholder="搜索状态"
            />
          </Field>
          <Field label="发放日期">
            <input type="date" value={draft.issued_at} onChange={(event) => onChange({ ...draft, issued_at: event.target.value })} className={inputClass} />
          </Field>
          <Field label="变更说明">
            <textarea value={draft.change_summary} onChange={(event) => onChange({ ...draft, change_summary: event.target.value })} rows={4} className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={draft.set_as_current} onChange={(event) => onChange({ ...draft, set_as_current: event.target.checked })} />
            设为当前版本
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
          <button type="submit" className={primaryButtonClass}>保存</button>
        </div>
      </form>
    </div>
  );
}

function UploadDialog({
  document,
  revision,
  onSubmit,
  onClose,
}: {
  document: ProjectDocumentDetail;
  revision: ProjectDocumentRevision | null;
  onSubmit: (items: UploadItem[], onProgress: (progress: UploadProgress) => void) => Promise<void>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  if (!revision) return null;
  const activeRevision = revision;
  const uploadTotalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const overallPercent = uploadProgress ? formatUploadPercent(uploadProgress.uploadedBytes, uploadProgress.totalBytes) : 0;
  const filePercent = uploadProgress ? formatUploadPercent(uploadProgress.fileLoadedBytes, uploadProgress.fileTotalBytes) : 0;
  const phaseText: Record<UploadProgressPhase, string> = {
    preparing: '准备上传',
    uploading: '上传中',
    finalizing: '提交入库',
    done: '上传完成',
  };

  function appendFiles(fileList: FileList | File[]) {
    if (isSubmitting) return;
    const files = Array.from(fileList);
    const hasPrimary = activeRevision.files.some((file) => file.file_role === 'primary' && file.status === 'ready');
    setItems((current) => [
      ...current,
      ...files.map<UploadItem>((file, index) => ({
        file,
        file_role: !hasPrimary && current.length === 0 && index === 0 ? 'primary' : 'source',
        relative_path: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || '').trim() || null,
      })),
    ]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (items.length === 0) return;
    setUploadProgress(null);
    setIsSubmitting(true);
    try {
      await onSubmit(items, setUploadProgress);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    event.dataTransfer.dropEffect = 'copy';
    setIsDragActive(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragActive(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsDragActive(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      appendFiles(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="w-full max-w-3xl rounded-3xl border border-white/60 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">上传版本文件</h3>
            <p className="break-all text-sm text-slate-500">{document.document_no} / 版本 {activeRevision.revision_no}</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-4 flex gap-3">
          <label className={`${secondaryButtonClass} ${isSubmitting ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload className="h-4 w-4" />
            选择文件
            <input type="file" multiple disabled={isSubmitting} className="hidden" onChange={(event) => event.target.files && appendFiles(event.target.files)} />
          </label>
          <label className={`${softPrimaryButtonClass} ${isSubmitting ? 'pointer-events-none opacity-50' : ''}`}>
            <FolderTree className="h-4 w-4" />
            选择目录
            <input
              type="file"
              multiple
              disabled={isSubmitting}
              className="hidden"
              {...({ webkitdirectory: 'true' } as Record<string, string>)}
              onChange={(event) => event.target.files && appendFiles(event.target.files)}
            />
          </label>
          {items.length > 0 && (
            <div className="ml-auto self-center text-xs text-slate-500">
              共 {items.length} 个文件 · {formatBytes(uploadTotalBytes)}
            </div>
          )}
        </div>
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mb-4 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
            isDragActive
              ? 'border-adnoc-blue bg-adnoc-blue/5'
              : 'border-slate-200 bg-slate-50/70'
          }`}
        >
          <div className="flex flex-col items-center gap-2 text-sm">
            <Upload className={`h-6 w-6 ${isDragActive ? 'text-adnoc-blue' : 'text-slate-400'}`} />
            <div className="font-medium text-slate-700">拖拽文件或文件夹到这里批量上传</div>
            <div className="text-xs text-slate-400">支持一次拖入多个文件，目录会保留相对路径。</div>
          </div>
        </div>
        {uploadProgress && (
          <div className="mb-4 rounded-2xl border border-primary-100 bg-primary-50/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm font-semibold text-primary-800">
                {phaseText[uploadProgress.phase]} {uploadProgress.currentIndex}/{uploadProgress.totalCount}
                <span className="ml-2 break-all font-normal text-primary-700">{uploadProgress.fileName}</span>
              </div>
              <div className="font-mono text-xs text-primary-700">{overallPercent}%</div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-primary-600 transition-all" style={{ width: `${overallPercent}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-primary-700">
              <span>总进度 {formatBytes(uploadProgress.uploadedBytes)} / {formatBytes(uploadProgress.totalBytes)}</span>
              <span>当前文件 {filePercent}% · {formatBytes(uploadProgress.fileLoadedBytes)} / {formatBytes(uploadProgress.fileTotalBytes)}</span>
            </div>
          </div>
        )}
        <div className="max-h-[45vh] overflow-auto rounded-2xl border border-slate-100">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">请选择，或直接拖拽一个或多个文件</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">文件</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">相对路径</th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, index) => (
                  <tr key={`${item.file.name}-${index}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{item.file.name}</div>
                      <div className="text-xs text-slate-400">{formatBytes(item.file.size)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <SearchableSelect
                        value={item.file_role}
                        onChange={(nextValue) => {
                          const nextRole = nextValue as UploadItem['file_role'];
                          setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, file_role: nextRole } : row));
                        }}
                        disabled={isSubmitting}
                        className={inputClass}
                        options={[
                          { value: 'primary', label: 'primary' },
                          { value: 'source', label: 'source' },
                          { value: 'attachment', label: 'attachment' },
                          { value: 'reference', label: 'reference' },
                        ]}
                        searchPlaceholder="搜索文件角色"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{item.relative_path || '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setItems((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                        disabled={isSubmitting}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={isSubmitting} className={secondaryButtonClass}>取消</button>
          <button type="submit" disabled={items.length === 0 || isSubmitting} className={primaryButtonClass}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isSubmitting ? `${overallPercent}%` : '开始上传'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface SelectionItem {
  id: string;
  primary: string;
  secondary?: string | null;
}

function SelectedItemsSummary({
  selectedIds,
  selectedMap,
  onToggle,
}: {
  selectedIds: string[];
  selectedMap: Map<string, SelectionItem>;
  onToggle: (id: string) => void;
}) {
  if (selectedIds.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-400">当前未选择</div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {selectedIds.map((id) => {
        const item = selectedMap.get(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            className="inline-flex items-center gap-2 rounded-full border border-adnoc-blue/15 bg-adnoc-blue/5 px-3 py-1 text-xs font-medium text-adnoc-blue transition hover:border-adnoc-blue/30 hover:bg-adnoc-blue/10"
          >
            <span>{item ? `${item.primary}${item.secondary ? ` · ${item.secondary}` : ''}` : id}</span>
            <X className="h-3 w-3" />
          </button>
        );
      })}
    </div>
  );
}

function LocalSelectionSection({
  title,
  searchPlaceholder,
  items,
  selectedIds,
  initialSelectedItems,
  onToggle,
}: {
  title: string;
  searchPlaceholder: string;
  items: SelectionItem[];
  selectedIds: string[];
  initialSelectedItems: SelectionItem[];
  onToggle: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const deferredKeyword = useDeferredValue(keyword);

  const filteredItems = useMemo(() => {
    const normalized = deferredKeyword.trim().toLowerCase();
    if (!normalized) {
      return items;
    }
    return items.filter((item) =>
      [item.primary, item.secondary ?? ''].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [deferredKeyword, items]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [currentPage, filteredItems]);

  const selectedMap = useMemo(() => {
    const map = new Map<string, SelectionItem>();
    [...items, ...initialSelectedItems].forEach((item) => map.set(item.id, item));
    return map;
  }, [initialSelectedItems, items]);

  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="font-semibold text-slate-900">{title}</h4>
        <span className="text-xs text-slate-400">项目内过滤，共 {items.length} 项</span>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/80 p-3">
        <input
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
          placeholder={searchPlaceholder}
          className={inputClass}
        />
        <SelectedItemsSummary selectedIds={selectedIds} selectedMap={selectedMap} onToggle={onToggle} />
        <div className="max-h-56 space-y-2 overflow-auto rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
          {pagedItems.length === 0 ? (
            <div className="text-sm text-slate-400">没有匹配的 PBS 节点</div>
          ) : (
            pagedItems.map((item) => (
              <label key={item.id} className="flex items-start gap-3 rounded-xl px-2 py-1.5 text-sm text-slate-600 transition hover:bg-white">
                <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => onToggle(item.id)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block font-mono text-xs text-slate-700">{item.primary}</span>
                  {item.secondary ? <span className="block text-xs text-slate-400">{item.secondary}</span> : null}
                </span>
              </label>
            ))
          )}
        </div>
        <SelectionPager page={currentPage} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}

function RemoteTagSelectionSection({
  projectId,
  title,
  selectedIds,
  initialSelectedItems,
  onToggle,
}: {
  projectId: string;
  title: string;
  selectedIds: string[];
  initialSelectedItems: SelectionItem[];
  onToggle: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SelectionItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('输入位号编号或名称后搜索，结果按项目隔离并分页返回。');
  const deferredKeyword = useDeferredValue(keyword);

  useEffect(() => {
    let cancelled = false;
    const normalized = deferredKeyword.trim();
    if (!normalized) {
      setResults([]);
      setTotalPages(1);
      setIsLoading(false);
      setMessage('输入位号编号或名称后搜索，结果按项目隔离并分页返回。');
      return;
    }

    const load = async () => {
      setIsLoading(true);
      try {
        const result = await searchProjectTags(projectId, {
          mode: 'structured',
          keyword: normalized,
          status: 'active',
          page,
          page_size: 20,
        });
        if (cancelled) {
          return;
        }
        setResults(
          result.items.map((item) => {
            const tag = item as ProjectTagSearchItem;
            return {
              id: tag.id,
              primary: tag.tag_no,
              secondary: tag.name,
            };
          }),
        );
        setTotalPages(Math.max(1, result.total_pages));
        setMessage(result.total === 0 ? '没有匹配的位号，请调整关键字。' : `命中 ${result.total} 条，仅展示当前页。`);
      } catch (error) {
        if (!cancelled) {
          setResults([]);
          setTotalPages(1);
          setMessage(error instanceof Error ? error.message : '加载位号搜索结果失败');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [deferredKeyword, page, projectId]);

  useEffect(() => {
    setPage(1);
  }, [deferredKeyword]);

  const selectedMap = useMemo(() => {
    const map = new Map<string, SelectionItem>();
    [...results, ...initialSelectedItems].forEach((item) => map.set(item.id, item));
    return map;
  }, [initialSelectedItems, results]);

  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="font-semibold text-slate-900">{title}</h4>
        <span className="text-xs text-slate-400">服务端分页搜索</span>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/80 p-3">
        <input
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
          placeholder="按位号编号或名称搜索"
          className={inputClass}
        />
        <SelectedItemsSummary selectedIds={selectedIds} selectedMap={selectedMap} onToggle={onToggle} />
        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-400">{message}</div>
        <div className="max-h-56 space-y-2 overflow-auto rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-adnoc-blue" /></div>
          ) : results.length === 0 ? (
            <div className="text-sm text-slate-400">暂无可选位号结果</div>
          ) : (
            results.map((item) => (
              <label key={item.id} className="flex items-start gap-3 rounded-xl px-2 py-1.5 text-sm text-slate-600 transition hover:bg-white">
                <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => onToggle(item.id)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block font-mono text-xs text-slate-700">{item.primary}</span>
                  {item.secondary ? <span className="block text-xs text-slate-400">{item.secondary}</span> : null}
                </span>
              </label>
            ))
          )}
        </div>
        <SelectionPager page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}

function SelectionPager({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between text-xs text-slate-400">
      <span>第 {page} / {totalPages} 页</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className={secondaryButtonClass}
        >
          上一页
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className={secondaryButtonClass}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-adnoc-blue focus:ring-4 focus:ring-adnoc-blue/10 disabled:bg-slate-50 disabled:text-slate-400';
