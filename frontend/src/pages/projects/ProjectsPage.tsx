import React, { useState } from 'react';
import { Boxes, DraftingCompass, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CreateProjectModal } from '../../components/projects/CreateProjectModal';
import {
  primaryButtonClass,
  primaryButtonIconClass,
} from '../../components/ui/buttonStyles';
import { PermissionGate } from '../../auth/PermissionGate';
import { getProjects } from '../../lib/api';
import type { Project } from '../../lib/api';

function ProjectIcon({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`relative isolate flex items-center justify-center overflow-hidden rounded-2xl bg-adnoc-blue text-white shadow-lg shadow-blue-900/15 ring-1 ring-white/60 transition-all duration-300 ${
        compact ? 'h-14 w-14' : 'h-16 w-16'
      }`}
    >
      <div className="absolute inset-0 rounded-2xl bg-adnoc-blue" />
      <div className="absolute inset-[2px] rounded-[14px] border border-white/12 bg-[#0b3c79]" />
      <div className="absolute inset-[7px] rounded-xl border border-white/12 bg-[#0f4e9b]" />
      <div className="absolute inset-[7px] opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.35)_1px,transparent_1px)] [background-size:10px_10px]" />
      <div className="absolute left-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-cyan-200" />
      <div className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-white/70" />
      <div className="absolute bottom-2.5 left-2.5 h-1.5 w-1.5 rounded-full bg-white/55" />
      <Boxes className={`${compact ? 'h-6 w-6' : 'h-7 w-7'} relative drop-shadow-sm`} strokeWidth={1.9} />
      <DraftingCompass
        className={`absolute ${compact ? 'bottom-2 right-2 h-4 w-4' : 'bottom-2.5 right-2.5 h-5 w-5'} text-cyan-100/95`}
        strokeWidth={2}
      />
    </div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = async () => {
    try {
      setIsLoading(true);
      const data = await getProjects();
      setProjects(data);
      setError(null);
    } catch {
      setError('获取项目列表失败');
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchProjects();
  }, []);

  return (
    <div className="min-h-full">
      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">项目管理</h1>
        </div>
        <PermissionGate permission="project.create">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className={`${primaryButtonClass} w-full px-5 sm:w-auto`}
          >
            <div className={primaryButtonIconClass}>
              <Plus className="h-4 w-4" />
            </div>
            创建项目
          </button>
        </PermissionGate>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      ) : isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-adnoc-blue border-t-transparent"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-6">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/40 bg-white/60 p-3 shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-gray-200/60 sm:p-4"
            >
              <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-100 shadow-inner">
                <div className="relative aspect-video">
                  {project.thumbnail_url ? (
                    <img
                      src={project.thumbnail_url}
                      alt={`${project.name} 缩略图`}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-50">
                      <div className="transition-transform duration-300 group-hover:-rotate-2 group-hover:scale-105">
                        <ProjectIcon />
                      </div>
                    </div>
                  )}
                  <div className="absolute right-3 top-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium shadow-sm backdrop-blur ${
                        project.status === 'active'
                          ? 'bg-green-100/90 text-green-700'
                          : project.status === 'draft'
                            ? 'bg-yellow-100/90 text-yellow-700'
                            : 'bg-gray-100/90 text-gray-700'
                      }`}
                    >
                      {project.status === 'active' ? '进行中' : project.status === 'draft' ? '草稿' : '已归档'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="px-1 pb-1">
                <h3 className="text-lg font-bold text-gray-900 group-hover:text-adnoc-blue">
                  {project.name}
                </h3>
                <p className="mt-1 text-sm text-gray-500 font-mono">{project.code}</p>
                {project.overview && (
                  <p className="mt-3 line-clamp-2 text-sm text-gray-600 border-t border-gray-100 pt-3">
                    {project.overview}
                  </p>
                )}
              </div>
            </div>
          ))}

          {projects.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
              <div className="mb-4 opacity-80">
                <ProjectIcon />
              </div>
              <h3 className="text-lg font-medium text-gray-900">暂无项目</h3>
              <p className="mt-1 text-sm text-gray-500">点击上方按钮创建一个新项目</p>
            </div>
          )}
        </div>
      )}

      {isCreateModalOpen && (
        <CreateProjectModal
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={() => {
            setIsCreateModalOpen(false);
            fetchProjects();
          }}
        />
      )}
    </div>
  );
}
