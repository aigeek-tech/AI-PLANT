import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { ProjectDataQualityDashboard } from '../../components/quality/ProjectDataQualityDashboard';
import { useToast } from '../../components/ui/Toast';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import {
  secondaryButtonClass,
  secondaryButtonIconClass,
  softPrimaryButtonClass,
  softPrimaryButtonIconClass,
} from '../../components/ui/buttonStyles';
import {
  ApiError,
  getPbsNodes,
  getProjects,
  type PbsNode,
  type Project,
} from '../../lib/api';

export function ProjectDataQualityPage() {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { error: showError } = useToast();
  const selectedProjectId = searchParams.get('projectId') ?? '';

  const [projects, setProjects] = useState<Project[]>([]);
  const [pbsNodes, setPbsNodes] = useState<PbsNode[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);
  const [isPbsLoading, setIsPbsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (routeProjectId) {
      setSearchParams({ projectId: routeProjectId }, { replace: true });
      navigate(`/data-quality?projectId=${encodeURIComponent(routeProjectId)}`, { replace: true });
    }
  }, [navigate, routeProjectId, setSearchParams]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: `${project.code} · ${project.name}`,
        keywords: `${project.code} ${project.name} ${project.overview ?? ''}`,
      })),
    [projects],
  );

  const loadProjects = useCallback(async () => {
    setIsProjectsLoading(true);
    setLoadError(null);
    try {
      const nextProjects = await getProjects();
      setProjects(nextProjects);
      if (!selectedProjectId && nextProjects.length > 0) {
        setSearchParams({ projectId: nextProjects[0].id }, { replace: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '项目列表加载失败';
      setLoadError(message);
      showError(message);
    } finally {
      setIsProjectsLoading(false);
    }
  }, [selectedProjectId, setSearchParams, showError]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadPbsNodes = useCallback(async () => {
    if (!selectedProjectId) {
      setPbsNodes([]);
      return;
    }

    setIsPbsLoading(true);
    setLoadError(null);
    try {
      const nextPbsNodes = await getPbsNodes(selectedProjectId);
      setPbsNodes(nextPbsNodes);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        navigate('/403', { replace: true });
        return;
      }
      const message = error instanceof Error ? error.message : 'PBS 范围加载失败';
      setLoadError(message);
      showError(message);
    } finally {
      setIsPbsLoading(false);
    }
  }, [navigate, selectedProjectId, showError]);

  useEffect(() => {
    void loadPbsNodes();
  }, [loadPbsNodes]);

  const handleProjectChange = (projectId: string) => {
    if (!projectId) {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ projectId }, { replace: false });
  };

  const handleRefresh = () => {
    void loadProjects();
    void loadPbsNodes();
  };

  const hasUnavailableSelection = Boolean(selectedProjectId && !selectedProject && !isProjectsLoading);

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-col overflow-visible xl:h-[calc(100vh-theme(spacing.10))] xl:min-h-0 xl:overflow-hidden">
      <header className="shrink-0 rounded-2xl border border-white/60 bg-white/80 px-5 py-4 shadow-sm backdrop-blur-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-slate-500">
              <Link to="/projects" className="font-medium transition hover:text-adnoc-blue">
                工程管理
              </Link>
              <span>/</span>
              <span className="font-semibold text-slate-900">数据质量</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">项目数据质量</h1>
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
            <label className="min-w-0 sm:min-w-64">
              <span className="sr-only">选择项目</span>
              <SearchableSelect
                value={selectedProjectId}
                options={projectOptions}
                onChange={handleProjectChange}
                disabled={isProjectsLoading || projects.length === 0}
                clearable
                placeholder={isProjectsLoading ? '正在加载项目...' : '选择项目'}
                searchPlaceholder="搜索项目编码或名称"
                emptyMessage="没有匹配的项目"
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
              />
            </label>

            {selectedProject && (
              <Link to={`/projects/${selectedProject.id}`} className={secondaryButtonClass}>
                <span className={secondaryButtonIconClass}>
                  <ExternalLink className="h-4 w-4" />
                </span>
                打开项目
              </Link>
            )}

            <button
              type="button"
              onClick={handleRefresh}
              disabled={isProjectsLoading || isPbsLoading}
              className={softPrimaryButtonClass}
            >
              <span className={softPrimaryButtonIconClass}>
                {isProjectsLoading || isPbsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </span>
              刷新
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 pt-4">
        {isProjectsLoading && projects.length === 0 ? (
          <StatePanel>
            <Loader2 className="mr-2 h-6 w-6 animate-spin text-adnoc-blue" />
            正在加载项目
          </StatePanel>
        ) : loadError && !selectedProject ? (
          <StatePanel tone="danger">
            <AlertTriangle className="mr-2 h-6 w-6" />
            {loadError}
          </StatePanel>
        ) : projects.length === 0 ? (
          <StatePanel>暂无可查看的数据质量项目</StatePanel>
        ) : hasUnavailableSelection ? (
          <StatePanel tone="danger">
            <AlertTriangle className="mr-2 h-6 w-6" />
            当前项目不可用或没有访问权限
          </StatePanel>
        ) : !selectedProjectId ? (
          <StatePanel>请选择项目</StatePanel>
        ) : isPbsLoading ? (
          <StatePanel>
            <Loader2 className="mr-2 h-6 w-6 animate-spin text-adnoc-blue" />
            正在加载项目范围
          </StatePanel>
        ) : (
          <ProjectDataQualityDashboard key={selectedProjectId} projectId={selectedProjectId} pbsNodes={pbsNodes} />
        )}
      </div>
    </div>
  );
}

function StatePanel({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <div
      className={`flex h-full min-h-0 items-center justify-center rounded-3xl border p-8 text-center text-sm font-semibold ${
        tone === 'danger'
          ? 'border-red-100 bg-red-50 text-red-600'
          : 'border-slate-200 bg-white/70 text-slate-400'
      }`}
    >
      {children}
    </div>
  );
}
