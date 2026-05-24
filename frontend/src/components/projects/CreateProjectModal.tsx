import React, { useState, useEffect } from 'react';
import { X, Folder, AlertCircle, Trash2 } from 'lucide-react';
import { createProject, deleteProject, getStandards, updateProject } from '../../lib/api';
import type { Project, Standard } from '../../lib/api';
import { useAuth } from '../../auth/AuthProvider';
import { useDialog } from '../ui/Dialog';
import { ProjectThumbnailPicker } from './ProjectThumbnailPicker';
import { SearchableSelect } from '../ui/SearchableSelect';

interface CreateProjectModalProps {
  onClose: () => void;
  onSuccess: (project?: Project) => void;
  onDeleted?: (project: Project) => void | Promise<void>;
  mode?: 'create' | 'edit';
  initialProject?: Project | null;
}

export function CreateProjectModal({
  onClose,
  onSuccess,
  onDeleted,
  mode = 'create',
  initialProject = null,
}: CreateProjectModalProps) {
  const { can } = useAuth();
  const { confirm } = useDialog();
  const initialStandardId =
    typeof initialProject?.reference_attributes?.standard_id === 'string'
      ? initialProject.reference_attributes.standard_id
      : '';
  const [formData, setFormData] = useState(() => ({
    code: initialProject?.code ?? '',
    name: initialProject?.name ?? '',
    overview: initialProject?.overview ?? '',
    reference_standard_id: initialStandardId,
  }));
  const [standards, setStandards] = useState<Standard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(initialProject?.thumbnail_url ?? null);
  const canDelete = Boolean(
    initialProject
    && mode === 'edit'
    && (can('project.delete', initialProject.id) || can('project.update', initialProject.id))
  );

  useEffect(() => {
    getStandards().then(setStandards).catch(() => setError('无法加载标准库选项'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const payload = {
      code: formData.code.trim(),
      name: formData.name.trim(),
      overview: formData.overview.trim() || null,
      reference_attributes: formData.reference_standard_id
        ? { standard_id: formData.reference_standard_id }
        : {},
      thumbnail_url: thumbnailUrl,
      status: initialProject?.status ?? 'active',
    };

    try {
      setIsSubmitting(true);
      const savedProject =
        mode === 'edit' && initialProject
          ? await updateProject(initialProject.id, payload)
          : await createProject(payload);
      onSuccess(savedProject);
    } catch (error) {
      setError(error instanceof Error ? error.message : mode === 'edit' ? '更新项目失败' : '创建项目失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!initialProject) {
      return;
    }

    const accepted = await confirm({
      title: '删除项目',
      description: `确认删除项目“${initialProject.name}”吗？这会同时删除 PBS、TAG、图纸、导入记录、关系和项目成员授权，且不可恢复。`,
      confirmText: '删除项目',
      danger: true,
    });
    if (!accepted) {
      return;
    }

    setError(null);
    setIsDeleting(true);
    try {
      await deleteProject(initialProject.id);
      if (onDeleted) {
        await onDeleted(initialProject);
      } else {
        onClose();
      }
    } catch (deleteError) {
      const message =
        deleteError instanceof Error && deleteError.message === 'Forbidden'
          ? '当前账号没有删除项目权限'
          : deleteError instanceof Error
            ? deleteError.message
            : '删除项目失败';
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal panel */}
      <div className="relative max-h-[94dvh] w-full max-w-lg scale-100 transform overflow-y-auto rounded-2xl border border-white/20 bg-white/60 p-4 opacity-100 shadow-2xl backdrop-blur-xl transition-all sm:p-6">
        <div className="absolute right-0 top-0 pr-4 pt-4">
          <button
            onClick={onClose}
            className="rounded-full rounded-md bg-white p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-adnoc-blue focus:ring-offset-2"
          >
            <span className="sr-only">关闭</span>
            <X className="h-5 w-5 border-none" />
          </button>
        </div>

        <div className="sm:flex sm:items-start">
          <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-adnoc-blue/10 sm:mx-0 sm:h-10 sm:w-10">
            <Folder className="h-6 w-6 text-adnoc-blue" />
          </div>
          <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
            <h3 className="text-lg font-semibold leading-6 text-gray-900">
              {mode === 'edit' ? '编辑项目详情' : '创建新项目'}
            </h3>
            <div className="mt-2 text-sm text-gray-500">
              {mode === 'edit' ? '更新项目基础信息与参考标准。' : '定义项目的基本信息和属性。'}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">项目代码 *</label>
            <input
              type="text"
              required
              className="w-full rounded-xl border-0 bg-white px-4 py-2.5 text-sm ring-1 ring-inset ring-gray-300 transition-all placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-adnoc-blue"
              placeholder="如: PRJ-2026-001"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">项目名称 *</label>
            <input
              type="text"
              required
              className="w-full rounded-xl border-0 bg-white px-4 py-2.5 text-sm ring-1 ring-inset ring-gray-300 transition-all placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-adnoc-blue"
              placeholder="输入项目全称"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">项目概况</label>
            <textarea
              className="w-full rounded-xl border-0 bg-white px-4 py-2.5 text-sm ring-1 ring-inset ring-gray-300 transition-all placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-adnoc-blue"
              rows={3}
              placeholder="项目简介及相关描述"
              value={formData.overview}
              onChange={(e) => setFormData({ ...formData, overview: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 flex justify-between">
              <span>参考标准库</span>
              <span className="text-xs text-gray-400 font-normal">可选</span>
            </label>
            <SearchableSelect
              className="w-full rounded-xl border-0 bg-white px-4 py-2.5 text-sm ring-1 ring-inset ring-gray-300 transition-all focus:ring-2 focus:ring-inset focus:ring-adnoc-blue"
              value={formData.reference_standard_id}
              onChange={(nextValue) => setFormData({ ...formData, reference_standard_id: nextValue })}
              placeholder="-- 不参考 --"
              clearable
              options={standards.map((std) => ({
                value: std.id,
                label: `${std.name} (${std.code})`,
              }))}
              searchPlaceholder="搜索标准库名称或编码"
            />
          </div>

          <ProjectThumbnailPicker
            value={thumbnailUrl}
            disabled={isSubmitting}
            onChange={setThumbnailUrl}
          />

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-gray-200/50 pt-5">
            <div>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={isSubmitting || isDeleting}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-200 transition-all hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  {isDeleting ? (
                    <span className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-200 border-t-red-500"></div>
                      删除中...
                    </span>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      删除项目
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting || isDeleting}
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-all hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-adnoc-blue focus:ring-offset-2 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isDeleting}
                className="inline-flex items-center justify-center rounded-xl bg-adnoc-blue px-4 py-2 text-sm font-medium text-white shadow-lg shadow-adnoc-blue/20 transition-all hover:bg-adnoc-light hover:shadow-xl hover:shadow-adnoc-blue/30 focus:outline-none focus:ring-2 focus:ring-adnoc-blue focus:ring-offset-2 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white"></div>
                    {mode === 'edit' ? '保存中...' : '提交中...'}
                  </span>
                ) : (
                  mode === 'edit' ? '保存修改' : '创建'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
