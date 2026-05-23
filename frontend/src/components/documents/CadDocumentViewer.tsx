import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileWarning,
  Loader2,
  LocateFixed,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { AcApDocManager, AcEdOpenMode, AcEdViewMode, type AcApOpenDatabaseOptions } from '@mlightcad/cad-simple-viewer';
import { AcGeBox2d } from '@mlightcad/data-model';
import { primaryButtonClass, secondaryButtonClass } from '../ui/buttonStyles';
import {
  buildCadTextIndex,
  cadTextHitToBox2d,
  findCadTextHitAtPoint,
  searchCadTextIndex,
  type CadTextHit,
} from './cadTextSearch';

export interface CadDocumentViewerProps {
  fileName: string;
  sourceUrl: string;
  previewUrl?: string | null;
  expiresAt: string;
  onRefresh?: () => void;
}

type CadViewerState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

type CadDocManagerSingleton = { _instance?: AcApDocManager };
type CadSpatialResult = { id: string; minX: number; minY: number; maxX: number; maxY: number };

const DEFAULT_CAD_DATA_BASE_URL = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/';
const CAD_TEXT_SEARCH_ZOOM_MARGIN = 1.3;
const CAD_TEXT_CLICK_HIT_RADIUS_PX = 8;
const CAD_TEXT_CLICK_THRESHOLD_PX = 3;
const cadSearchButtonClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-40';

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function getCadDataBaseUrl() {
  return normalizeBaseUrl(import.meta.env.VITE_CAD_VIEWER_BASE_URL || DEFAULT_CAD_DATA_BASE_URL);
}

function getCadAssetUrl(fileName: string) {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}cad-viewer-assets/${fileName}`;
}

async function destroyCadManager(container?: HTMLDivElement | null) {
  const manager = (AcApDocManager as unknown as CadDocManagerSingleton)._instance;
  try {
    manager?.curView.clear();
    await manager?.destroy();
  } catch (error) {
    console.warn('Failed to destroy CAD viewer instance:', error);
  } finally {
    container?.replaceChildren();
  }
}

function formatExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function isCadTextSelectionDebugEnabled() {
  try {
    return window.localStorage.getItem('cad-text-debug') === '1';
  } catch {
    return false;
  }
}

function logCadTextSelection(event: string, payload: Record<string, unknown>) {
  if (!isCadTextSelectionDebugEnabled()) return;
  console.info(`[CAD text selection] ${event}`, payload);
}

function installCadTextPointSelectionFallback(manager: AcApDocManager, textIndex: CadTextHit[]) {
  const view = manager.curView;
  const canvas = view.canvas;
  const textHitByObjectId = buildCadTextHitByObjectId(textIndex);
  let startCanvas: { x: number; y: number } | null = null;
  let startSelectionIds: string[] | null = null;

  const canHandleTextSelection = () => view.mode === AcEdViewMode.SELECTION && !view.editor.isActive;

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !canHandleTextSelection()) {
      startCanvas = null;
      startSelectionIds = null;
      return;
    }

    startCanvas = view.viewportToCanvas({ x: event.clientX, y: event.clientY });
    startSelectionIds = view.selectionSet.ids;
  };

  const handleMouseUp = (event: MouseEvent) => {
    if (event.button !== 0 || !startCanvas || !canHandleTextSelection()) {
      startCanvas = null;
      startSelectionIds = null;
      return;
    }

    const endCanvas = view.viewportToCanvas({ x: event.clientX, y: event.clientY });
    const isClick = view.isSelectionClick(startCanvas, endCanvas, CAD_TEXT_CLICK_THRESHOLD_PX);
    const previousSelectionIds = startSelectionIds ?? [];
    startCanvas = null;
    startSelectionIds = null;
    if (!isClick) return;

    const worldPoint = view.screenToWorld(endCanvas);
    const tolerance = getCadTextClickWorldTolerance(view, endCanvas);
    const searchBox = getCadTextClickSearchBox(worldPoint, tolerance);
    const nativePicked = view.pick(worldPoint, undefined, true);
    const nativeNonTextPickIds = nativePicked.map((item) => item.id).filter((id) => !textHitByObjectId.has(id));
    const currentSelectionIds = view.selectionSet.ids;
    const nativeSelectedEntity =
      currentSelectionIds.length > 0 && !haveSameObjectIds(previousSelectionIds, currentSelectionIds);

    if (nativeSelectedEntity || nativeNonTextPickIds.length > 0) {
      logCadTextSelection('skip.native-hit', {
        canvasPoint: roundPoint(endCanvas),
        worldPoint: roundPoint(worldPoint),
        nativePickIds: nativePicked.map((item) => item.id),
        nativeNonTextPickIds,
        previousSelectionIds,
        currentSelectionIds,
      });
      return;
    }

    const searchResults = view.search(searchBox) as CadSpatialResult[];
    const spatialHit = findCadTextSpatialHit(searchResults, textHitByObjectId, worldPoint);

    const indexHit = spatialHit?.hit ?? findCadTextHitAtPoint(textIndex, worldPoint, tolerance);
    const selectionIds = spatialHit ? [spatialHit.result.id] : indexHit?.objectIds;

    logCadTextSelection('click', {
      canvasPoint: roundPoint(endCanvas),
      worldPoint: roundPoint(worldPoint),
      tolerance: roundNumber(tolerance),
      nativePickIds: nativePicked.map((item) => item.id),
      searchResultCount: searchResults.length,
      searchTextIds: searchResults
        .filter((item) => textHitByObjectId.has(item.id))
        .slice(0, 8)
        .map((item) => item.id),
      spatialHitId: spatialHit?.result.id ?? null,
      indexHitId: indexHit?.id ?? null,
      indexHitText: indexHit?.displayText ?? null,
      selectionIds: selectionIds ?? [],
    });

    if (!selectionIds || selectionIds.length === 0) return;

    view.applySelection(selectionIds, view.getSelectionActionFromEvent(event));
  };

  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mouseup', handleMouseUp);

  return () => {
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('mouseup', handleMouseUp);
  };
}

function buildCadTextHitByObjectId(textIndex: CadTextHit[]) {
  const entries = textIndex.flatMap((hit) =>
    hit.source === 'single' ? hit.objectIds.map((objectId) => [objectId, hit] as const) : [],
  );

  return new Map(entries);
}

function haveSameObjectIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function findCadTextSpatialHit(
  results: CadSpatialResult[],
  textHitByObjectId: Map<string, CadTextHit>,
  point: { x: number; y: number },
) {
  return (
    results
      .map((result) => ({ result, hit: textHitByObjectId.get(result.id) ?? null }))
      .filter((item): item is { result: CadSpatialResult; hit: CadTextHit } => item.hit !== null)
      .sort((a, b) => compareSpatialTextHits(a.result, b.result, point))[0] ?? null
  );
}

function compareSpatialTextHits(a: CadSpatialResult, b: CadSpatialResult, point: { x: number; y: number }) {
  const distanceDifference = pointDistanceToSpatialResultSquared(point, a) - pointDistanceToSpatialResultSquared(point, b);
  if (distanceDifference !== 0) return distanceDifference;

  const areaDifference = spatialResultArea(a) - spatialResultArea(b);
  if (areaDifference !== 0) return areaDifference;

  return a.id.localeCompare(b.id);
}

function pointDistanceToSpatialResultSquared(point: { x: number; y: number }, result: CadSpatialResult) {
  const dx = point.x < result.minX ? result.minX - point.x : point.x > result.maxX ? point.x - result.maxX : 0;
  const dy = point.y < result.minY ? result.minY - point.y : point.y > result.maxY ? point.y - result.maxY : 0;
  return dx * dx + dy * dy;
}

function spatialResultArea(result: CadSpatialResult) {
  return Math.max(0, result.maxX - result.minX) * Math.max(0, result.maxY - result.minY);
}

function getCadTextClickWorldTolerance(
  view: AcApDocManager['curView'],
  canvasPoint: { x: number; y: number },
) {
  const origin = view.screenToWorld(canvasPoint);
  const xOffset = view.screenToWorld({
    x: canvasPoint.x + CAD_TEXT_CLICK_HIT_RADIUS_PX,
    y: canvasPoint.y,
  });
  const yOffset = view.screenToWorld({
    x: canvasPoint.x,
    y: canvasPoint.y + CAD_TEXT_CLICK_HIT_RADIUS_PX,
  });

  return Math.max(
    Math.abs(xOffset.x - origin.x),
    Math.abs(yOffset.y - origin.y),
    Number.EPSILON,
  );
}

function getCadTextClickSearchBox(point: { x: number; y: number }, tolerance: number) {
  return new AcGeBox2d(
    { x: point.x - tolerance, y: point.y - tolerance },
    { x: point.x + tolerance, y: point.y + tolerance },
  );
}

function roundPoint(point: { x: number; y: number }) {
  return {
    x: roundNumber(point.x),
    y: roundNumber(point.y),
  };
}

function roundNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

export function CadDocumentViewer({
  fileName,
  sourceUrl,
  previewUrl,
  expiresAt,
  onRefresh,
}: CadDocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<AcApDocManager | null>(null);
  const textClickFallbackCleanupRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<CadViewerState>({ status: 'loading' });
  const [textIndex, setTextIndex] = useState<CadTextHit[]>([]);
  const [textIndexError, setTextIndexError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const searchMatches = useMemo(() => searchCadTextIndex(textIndex, searchQuery), [searchQuery, textIndex]);
  const hasSearchQuery = Boolean(searchQuery.trim());
  const activeMatch = searchMatches[activeMatchIndex] ?? searchMatches[0];

  const clearSearchSelection = useCallback(() => {
    managerRef.current?.curView.selectionSet.clear();
  }, []);

  const focusSearchHit = useCallback((hit: CadTextHit, index: number) => {
    const manager = managerRef.current;
    if (!manager) return;

    try {
      manager.curView.selectionSet.clear();
      manager.curView.selectionSet.add(hit.objectIds);
      manager.curView.zoomTo(cadTextHitToBox2d(hit), CAD_TEXT_SEARCH_ZOOM_MARGIN);
      setActiveMatchIndex(index);
    } catch (error) {
      console.warn('Failed to focus CAD text search result:', error);
    }
  }, []);

  const handleSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!hasSearchQuery || searchMatches.length === 0) {
        clearSearchSelection();
        return;
      }

      focusSearchHit(searchMatches[0], 0);
    },
    [clearSearchSelection, focusSearchHit, hasSearchQuery, searchMatches],
  );

  const handleStepMatch = useCallback(
    (delta: number) => {
      if (searchMatches.length === 0) return;
      const nextIndex = (activeMatchIndex + delta + searchMatches.length) % searchMatches.length;
      focusSearchHit(searchMatches[nextIndex], nextIndex);
    },
    [activeMatchIndex, focusSearchHit, searchMatches],
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setActiveMatchIndex(0);
    clearSearchSelection();
  }, [clearSearchSelection]);

  useEffect(() => {
    setActiveMatchIndex(0);
    if (!hasSearchQuery) {
      clearSearchSelection();
    }
  }, [clearSearchSelection, hasSearchQuery, searchMatches.length]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) {
      setState({ status: 'error', message: 'CAD 预览容器未准备好' });
      return;
    }

    const load = async () => {
      managerRef.current = null;
      textClickFallbackCleanupRef.current?.();
      textClickFallbackCleanupRef.current = null;
      setTextIndex([]);
      setTextIndexError(null);
      setState({ status: 'loading' });
      try {
        await destroyCadManager(container);
        if (cancelled) return;

        const manager = AcApDocManager.createInstance({
          container,
          autoResize: true,
          baseUrl: getCadDataBaseUrl(),
          webworkerFileUrls: {
            dxfParser: getCadAssetUrl('dxf-parser-worker.js'),
            dwgParser: getCadAssetUrl('libredwg-parser-worker.js'),
            mtextRender: getCadAssetUrl('mtext-renderer-worker.js'),
          },
        });

        if (!manager) {
          throw new Error('CAD 预览实例创建失败');
        }
        managerRef.current = manager;

        const options: AcApOpenDatabaseOptions = {
          minimumChunkSize: 1000,
          mode: AcEdOpenMode.Read,
        };
        const opened = await manager.openUrl(sourceUrl, options);
        if (cancelled) return;
        if (!opened) {
          throw new Error(`无法打开 CAD 文件：${fileName}`);
        }
        try {
          const nextTextIndex = buildCadTextIndex(manager);
          setTextIndex(nextTextIndex);
          logCadTextSelection('index.ready', {
            fileName,
            hitCount: nextTextIndex.length,
            singleHitCount: nextTextIndex.filter((hit) => hit.source === 'single').length,
            sample: nextTextIndex.slice(0, 5).map((hit) => ({
              id: hit.id,
              objectIds: hit.objectIds,
              text: hit.displayText,
            })),
          });
          textClickFallbackCleanupRef.current = installCadTextPointSelectionFallback(manager, nextTextIndex);
        } catch (error) {
          console.warn('Failed to build CAD text search index:', error);
          setTextIndex([]);
          setTextIndexError('文本索引失败');
        }
        setState({ status: 'ready' });
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : '加载 CAD 文件失败' });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      managerRef.current = null;
      textClickFallbackCleanupRef.current?.();
      textClickFallbackCleanupRef.current = null;
      void destroyCadManager(container);
    };
  }, [fileName, sourceUrl]);

  const fallbackPreviewUrl = previewUrl && previewUrl !== sourceUrl ? previewUrl : null;

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-slate-950">
      <div ref={containerRef} className="h-full min-h-0 w-full bg-slate-950" />

      {state.status === 'ready' && (
        <form
          onSubmit={handleSearchSubmit}
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-lg border border-white/25 bg-white/95 p-2 text-sm shadow-xl backdrop-blur"
        >
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 text-slate-500 sm:w-72">
            <Search className="h-4 w-4 shrink-0" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={textIndex.length > 0 ? `搜索 ${textIndex.length} 个 CAD 文本` : '搜索 CAD 文本'}
              className="min-w-16 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>
          <span
            className="hidden min-w-16 shrink-0 text-center text-xs font-medium text-slate-500 sm:inline"
            title={activeMatch?.displayText || textIndexError || undefined}
          >
            {textIndexError
              ? textIndexError
              : hasSearchQuery
                ? `${searchMatches.length > 0 ? activeMatchIndex + 1 : 0}/${searchMatches.length}`
                : `${textIndex.length}项`}
          </span>
          <button
            type="submit"
            disabled={!hasSearchQuery || searchMatches.length === 0}
            className={cadSearchButtonClass}
            title="定位"
            aria-label="定位 CAD 文本"
          >
            <LocateFixed className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => handleStepMatch(-1)}
            disabled={searchMatches.length === 0}
            className={cadSearchButtonClass}
            title="上一个"
            aria-label="上一个 CAD 文本搜索结果"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => handleStepMatch(1)}
            disabled={searchMatches.length === 0}
            className={cadSearchButtonClass}
            title="下一个"
            aria-label="下一个 CAD 文本搜索结果"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {hasSearchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className={cadSearchButtonClass}
              title="清除"
              aria-label="清除 CAD 文本搜索"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>
      )}

      {state.status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-sm font-medium text-white backdrop-blur-sm">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在加载 CAD 文件
        </div>
      )}

      {state.status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-6 text-center text-slate-500">
          <FileWarning className="h-10 w-10 text-amber-500" />
          <div className="text-base font-semibold text-slate-800">无法打开 CAD 预览</div>
          <p className="max-w-xl text-sm">
            {state.message}。当前访问链接将在 {formatExpiry(expiresAt)} 过期。
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {onRefresh && (
              <button type="button" onClick={onRefresh} className={primaryButtonClass}>
                <RefreshCw className="h-4 w-4" />
                刷新链接
              </button>
            )}
            {fallbackPreviewUrl && (
              <a href={fallbackPreviewUrl} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                <ExternalLink className="h-4 w-4" />
                备用预览
              </a>
            )}
            <a href={sourceUrl} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
              <Download className="h-4 w-4" />
              下载源文件
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
