import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileWarning, Loader2, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
  getDocumentVisualizations,
  getDocumentVisualizationAccess,
  getDocumentVisualizationObjects,
  getProjectDocumentDetail,
  getProjectDocumentFileAccessUrl,
  type DocumentVisualization,
  type DocumentVisualizationAccess,
  type DocumentVisualizationObject,
  type ProjectDocumentDetail,
  type ProjectDocumentFile,
  type ProjectDocumentFileAccess,
  type ProjectDocumentRevision,
} from '../../lib/api';
import { primaryButtonClass, secondaryButtonClass } from '../ui/buttonStyles';
import type { SparkAnnotation } from './SparkDocumentViewer';

const SparkDocumentViewer = lazy(() =>
  import('./SparkDocumentViewer').then((module) => ({ default: module.SparkDocumentViewer })),
);
const CadDocumentViewer = lazy(() =>
  import('./CadDocumentViewer').then((module) => ({ default: module.CadDocumentViewer })),
);

type PreviewState =
  | { status: 'loading' }
  | {
      status: 'ready';
      document: ProjectDocumentDetail;
      revision: ProjectDocumentRevision;
      file: ProjectDocumentFile;
      access: ProjectDocumentFileAccess;
      visualization: DocumentVisualization | null;
      visualizationAccess: DocumentVisualizationAccess | null;
      semanticObjects: DocumentVisualizationObject[];
    }
  | { status: 'error'; message: string };

interface DocumentPreviewPanelProps {
  projectId?: string;
  documentId?: string;
  revisionId?: string;
  fileId?: string;
  leadingAction?: React.ReactNode;
  onClose?: () => void;
  variant?: 'page' | 'dialog';
}

interface DocumentPreviewDialogProps {
  projectId: string;
  documentId: string;
  revisionId: string;
  fileId: string;
  onClose: () => void;
}

function isTextPreview(file: ProjectDocumentFile) {
  return file.mime_type.startsWith('text/');
}

function isImagePreview(file: ProjectDocumentFile) {
  return file.mime_type.startsWith('image/');
}

function isPdfPreview(file: ProjectDocumentFile) {
  return file.mime_type === 'application/pdf';
}

function canBrowserPreview(file: ProjectDocumentFile) {
  return isPdfPreview(file) || isImagePreview(file) || isTextPreview(file);
}

function isSparkPreviewFile(file: ProjectDocumentFile) {
  const extension = file.original_filename.toLowerCase().split('.').pop() ?? '';
  return ['ply', 'spz', 'splat', 'ksplat', 'sog', 'zip', 'rad'].includes(extension);
}

function isRadPreviewFile(file: ProjectDocumentFile) {
  return file.original_filename.toLowerCase().endsWith('.rad');
}

function isCadPreviewFile(file: ProjectDocumentFile) {
  const extension = file.original_filename.toLowerCase().split('.').pop() ?? '';
  return extension === 'dwg' || extension === 'dxf';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function DocumentPreviewDialog({ projectId, documentId, revisionId, fileId, onClose }: DocumentPreviewDialogProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="文件预览"
      className="fixed inset-0 z-50 flex h-screen w-screen bg-slate-900/40 backdrop-blur-sm"
    >
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-50 shadow-2xl shadow-slate-900/20">
        <DocumentPreviewPanel
          projectId={projectId}
          documentId={documentId}
          revisionId={revisionId}
          fileId={fileId}
          onClose={onClose}
          variant="dialog"
        />
      </div>
    </div>
  );
}

export function DocumentPreviewPanel({
  projectId,
  documentId,
  revisionId,
  fileId,
  leadingAction,
  onClose,
  variant = 'page',
}: DocumentPreviewPanelProps) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const isDialog = variant === 'dialog';
  const navigate = useNavigate();

  const loadPreview = useCallback(async () => {
    if (!projectId || !documentId || !revisionId || !fileId) {
      setState({ status: 'error', message: '预览参数不完整' });
      return;
    }

    setState({ status: 'loading' });
    try {
      const [document, access] = await Promise.all([
        getProjectDocumentDetail(projectId, documentId),
        getProjectDocumentFileAccessUrl(projectId, documentId, revisionId, fileId),
      ]);
      const revision = document.revisions.find((item) => item.id === revisionId);
      const file = revision?.files.find((item) => item.id === fileId);
      if (!revision || !file) {
        setState({ status: 'error', message: '找不到对应的版本或文件' });
        return;
      }
      const isCadFile = isCadPreviewFile(file);
      const isSparkFile = isSparkPreviewFile(file);
      const visualizations = await getDocumentVisualizations(projectId, documentId, revisionId);
      const matchedVisualization =
        visualizations.find((item) =>
          [item.preview_file_id, item.source_file_id, item.annotation_manifest_file_id].includes(fileId),
        ) ?? (isCadFile || isSparkFile ? null : visualizations[0] ?? null);
      const selfSparkVisualization: DocumentVisualization | null =
        matchedVisualization === null && isSparkFile && !isRadPreviewFile(file)
          ? {
              id: `self-${file.id}`,
              project_id: projectId,
              document_id: documentId,
              revision_id: revisionId,
              source_file_id: file.id,
              source_file_name: file.original_filename,
              preview_file_id: file.id,
              preview_file_name: file.original_filename,
              annotation_manifest_file_id: null,
              annotation_manifest_file_name: null,
              metadata: { units: 'm', source: 'direct_spark_asset' },
              created_at: file.created_at,
              updated_at: file.updated_at,
            }
          : null;
      const visualization = matchedVisualization ?? selfSparkVisualization;
      const visualizationAccess =
        visualization && !selfSparkVisualization
          ? await getDocumentVisualizationAccess(projectId, documentId, revisionId, visualization.id)
          : null;
      let semanticObjects: DocumentVisualizationObject[] = [];
      if (visualization && !selfSparkVisualization) {
        try {
          semanticObjects = await getDocumentVisualizationObjects(projectId, documentId, revisionId, visualization.id);
        } catch (error) {
          console.warn('Semantic visualization objects failed to load', error);
        }
      }
      setState({
        status: 'ready',
        document,
        revision,
        file,
        access,
        visualization,
        visualizationAccess,
        semanticObjects,
      });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : '加载文件预览失败' });
    }
  }, [documentId, fileId, projectId, revisionId]);

  useEffect(() => {
    void Promise.resolve().then(loadPreview);
  }, [loadPreview]);

  const title = state.status === 'ready' ? state.file.original_filename : '文件预览';
  const shouldRenderSpark =
    state.status === 'ready' &&
    state.visualization !== null &&
    (state.visualizationAccess !== null || state.visualization.id.startsWith('self-'));
  const shouldRenderCad =
    state.status === 'ready' &&
    !shouldRenderSpark &&
    isCadPreviewFile(state.file);
  const previewUrl =
    state.status === 'ready'
      ? shouldRenderSpark
        ? state.visualizationAccess?.viewer_url ?? state.access.url
        : shouldRenderCad
          ? state.access.url
        : isSparkPreviewFile(state.file)
          ? state.access.url
          : state.access.preview_url || state.access.url
      : '';
  const shouldEmbed =
    state.status === 'ready' &&
    !shouldRenderSpark &&
    !shouldRenderCad &&
    !isSparkPreviewFile(state.file) &&
    (state.access.preview_engine === 'kkfileview' || canBrowserPreview(state.file));
  const isImmersiveSparkDialog = isDialog && shouldRenderSpark;

  const previewMinimumHeight = isDialog ? 'min-h-0' : 'min-h-[36rem]';
  const previewFrameMinimumHeight = isDialog ? 'min-h-0' : 'min-h-[36rem]';

  const closeAction = useMemo(() => {
    if (!onClose) return null;
    return (
      <button type="button" onClick={onClose} className={secondaryButtonClass}>
        <X className="h-4 w-4" />
        关闭
      </button>
    );
  }, [onClose]);

  const handleAnnotationSelect = useCallback((annotation: SparkAnnotation) => {
    if (!projectId || !annotation.target_kind || !annotation.target_id) return;
    if (annotation.target_kind === 'tag') {
      navigate(`/projects/${projectId}/tags/${annotation.target_id}`);
      return;
    }
    navigate(`/projects/${projectId}${annotation.target_kind === 'document' ? '?view=documents' : ''}`);
  }, [navigate, projectId]);

  return (
    <div className={clsx(
      'flex flex-col',
      isImmersiveSparkDialog
        ? 'h-full min-h-0 bg-slate-950'
        : clsx('gap-4', isDialog ? 'h-full min-h-0 p-3 sm:p-4' : 'min-h-[calc(100vh-8rem)]'),
    )}>
      {!isImmersiveSparkDialog && (
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white/85 px-5 py-4 shadow-sm shadow-slate-200/70 backdrop-blur">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {leadingAction}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
              {state.status === 'ready' && (
                <p className="mt-1 truncate text-sm text-slate-500">
                  {state.document.document_no} / 版本 {state.revision.revision_no} / {shouldRenderSpark ? 'Spark 3D 预览' : shouldRenderCad ? 'CAD 浏览器预览' : state.access.preview_engine === 'kkfileview' ? 'kkFileView' : '浏览器预览'}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {state.status === 'ready' && (
            <>
              <a href={state.access.url} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                <Download className="h-4 w-4" />
                下载源文件
              </a>
              <a href={previewUrl} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                <ExternalLink className="h-4 w-4" />
                新窗口
              </a>
            </>
          )}
          <button type="button" onClick={() => void loadPreview()} className={primaryButtonClass}>
            <RefreshCw className="h-4 w-4" />
            刷新链接
          </button>
          {closeAction}
        </div>
      </div>
      )}

      <div className={clsx(
        'flex-1 overflow-hidden',
        isImmersiveSparkDialog
          ? 'min-h-0 bg-slate-950'
          : clsx('rounded-2xl border border-white/70 bg-white/80 shadow-sm shadow-slate-200/70 backdrop-blur', previewMinimumHeight),
      )}>
        {state.status === 'loading' && (
          <div className={clsx('flex h-full items-center justify-center text-slate-500', previewFrameMinimumHeight)}>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            正在加载预览
          </div>
        )}

        {state.status === 'error' && (
          <div className={clsx('flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-slate-500', previewFrameMinimumHeight)}>
            <FileWarning className="h-10 w-10 text-amber-500" />
            <div className="text-base font-semibold text-slate-800">无法打开预览</div>
            <p className="max-w-xl text-sm">{state.message}</p>
          </div>
        )}

        {state.status === 'ready' && shouldEmbed && (
          <iframe
            key={`${state.file.id}-${state.access.expires_at}`}
            title={state.file.original_filename}
            src={previewUrl}
            className={clsx('h-full w-full bg-white', previewFrameMinimumHeight)}
          />
        )}

        {state.status === 'ready' && shouldRenderSpark && (
          <Suspense fallback={(
            <div className={clsx('flex h-full items-center justify-center text-slate-500', previewFrameMinimumHeight)}>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              正在加载 3D 引擎
            </div>
          )}>
            <SparkDocumentViewer
              previewUrl={state.visualizationAccess?.viewer_url ?? state.access.url}
              sourceUrl={state.visualizationAccess?.source_url ?? state.access.url}
              sourceFileName={state.visualizationAccess?.source_file_name ?? state.visualization!.source_file_name}
              previewFileName={state.visualizationAccess?.preview_file_name ?? state.visualization!.preview_file_name}
              externalUrl={previewUrl}
              annotationManifestUrl={state.visualizationAccess?.annotation_manifest_url ?? null}
              metadata={state.visualizationAccess?.metadata ?? state.visualization!.metadata}
              assetMode={state.visualizationAccess?.asset_mode ?? 'spark_native'}
              semanticObjects={state.semanticObjects}
              onRefresh={() => void loadPreview()}
              onClose={onClose}
              onAnnotationSelect={handleAnnotationSelect}
            />
          </Suspense>
        )}

        {state.status === 'ready' && shouldRenderCad && (
          <Suspense fallback={(
            <div className={clsx('flex h-full items-center justify-center text-slate-500', previewFrameMinimumHeight)}>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              正在加载 CAD 引擎
            </div>
          )}>
            <CadDocumentViewer
              fileName={state.file.original_filename}
              sourceUrl={state.access.url}
              previewUrl={state.access.preview_engine === 'kkfileview' ? state.access.preview_url : null}
              expiresAt={state.access.expires_at}
              onRefresh={() => void loadPreview()}
            />
          </Suspense>
        )}

        {state.status === 'ready' && !shouldEmbed && !shouldRenderSpark && !shouldRenderCad && (
          <div className={clsx('flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-slate-500', previewFrameMinimumHeight)}>
            <FileWarning className="h-10 w-10 text-amber-500" />
            <div className="text-base font-semibold text-slate-800">
              {isRadPreviewFile(state.file) ? '缺少 RAD 分片，暂不能打开 Spark 预览' : '当前文件暂不支持浏览器直接预览'}
            </div>
            <p className="max-w-xl text-sm">
              {isRadPreviewFile(state.file)
                ? '请上传同一 RAD 包内引用的 .radc 分片，系统登记完整 Spark visualization 后再打开。'
                : `${state.file.mime_type} 需要启用 kkFileView 后在线查看。当前访问链接将在 ${formatDate(state.access.expires_at)} 过期。`}
            </p>
            <a href={state.access.url} target="_blank" rel="noreferrer" className={primaryButtonClass}>
              <Download className="h-4 w-4" />
              下载源文件
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
