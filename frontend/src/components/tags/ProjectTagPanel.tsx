import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Puzzle,
  Search,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  AttributeDefinition,
  ClassDefinition,
  PbsNode,
  ProjectTagSearchItem,
  ProjectTagBrowseItem,
  StandardDetail,
} from '../../lib/api';
import {
  createProjectTag,
  deleteProjectTag,
  getAllClassAttributes,
  getAllStandardCommonAttributes,
  searchProjectTags,
} from '../../lib/api';
import { useToast } from '../ui/Toast';
import { TagCreateForm } from './TagCreateForm';
import {
  primaryButtonClass,
  primaryButtonIconClass,
  secondaryButtonClass,
  secondaryButtonIconClass,
} from '../ui/buttonStyles';
import { SearchableSelect } from '../ui/SearchableSelect';
import { useDialog } from '../ui/Dialog';

interface ProjectTagPanelProps {
  projectId: string;
  selectedNode: PbsNode;
  standard: StandardDetail | null;
  refreshToken: number;
  onEditNode?: () => void;
  onTagsChanged: () => void;
  onOpenTagDetail?: (tagId: string) => void;
}

type BooleanFilterValue = '' | 'true' | 'false';

interface NumericFilterValue {
  min: string;
  max: string;
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10';

export function ProjectTagPanel({
  projectId,
  selectedNode,
  standard,
  refreshToken,
  onEditNode,
  onTagsChanged,
  onOpenTagDetail,
}: ProjectTagPanelProps) {
  const { success, error: showError } = useToast();
  const { confirm } = useDialog();
  const [tagFormState, setTagFormState] = useState<{ show: boolean; parentTag?: ProjectTagSearchItem | null }>({
    show: false,
  });
  const [keyword, setKeyword] = useState('');
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'archived'>('');
  const [textFilters, setTextFilters] = useState<Record<string, string>>({});
  const [enumFilters, setEnumFilters] = useState<Record<string, string>>({});
  const [booleanFilters, setBooleanFilters] = useState<Record<string, BooleanFilterValue>>({});
  const [numericFilters, setNumericFilters] = useState<Record<string, NumericFilterValue>>({});
  const [items, setItems] = useState<Array<ProjectTagBrowseItem | ProjectTagSearchItem>>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTagIds, setExpandedTagIds] = useState<Set<string>>(new Set());
  const [openActionTagId, setOpenActionTagId] = useState<string | null>(null);
  const [deletingTagIds, setDeletingTagIds] = useState<Set<string>>(new Set());
  const [filterCommonAttributes, setFilterCommonAttributes] = useState<AttributeDefinition[]>([]);
  const [filterClassAttributes, setFilterClassAttributes] = useState<AttributeDefinition[]>([]);
  const [areAttributeFiltersOpen, setAreAttributeFiltersOpen] = useState(false);
  const [isLoadingFilterAttributes, setIsLoadingFilterAttributes] = useState(false);
  const [attributeFilterError, setAttributeFilterError] = useState<string | null>(null);

  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const deferredKeyword = useDeferredValue(keyword);

  const classes = useMemo(() => standard?.classes ?? [], [standard]);
  const selectedClass = useMemo(
    () => classes.find((item) => item.id === classId) ?? null,
    [classId, classes],
  );
  const visibleAttributes = useMemo(
    () => [...filterCommonAttributes, ...(classId ? filterClassAttributes : [])],
    [classId, filterClassAttributes, filterCommonAttributes],
  );

  useEffect(() => {
    if (classId && !selectedClass) {
      setClassId('');
    }
  }, [classId, selectedClass]);

  useEffect(() => {
    if (!areAttributeFiltersOpen) {
      return;
    }

    if (!standard?.id || (classId && !selectedClass)) {
      setFilterCommonAttributes([]);
      setFilterClassAttributes([]);
      setIsLoadingFilterAttributes(false);
      setAttributeFilterError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingFilterAttributes(true);
    setAttributeFilterError(null);

    (async () => {
      try {
        const [nextCommonAttributes, nextClassAttributes] = await Promise.all([
          getAllStandardCommonAttributes(standard.id, 'tag'),
          classId ? getAllClassAttributes(classId) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setFilterCommonAttributes(nextCommonAttributes);
        setFilterClassAttributes(nextClassAttributes);
      } catch (loadError) {
        if (cancelled) return;
        console.error(loadError);
        setFilterCommonAttributes([]);
        setFilterClassAttributes([]);
        setAttributeFilterError('属性条件加载失败，请重新选择类别或稍后重试');
      } finally {
        if (!cancelled) {
          setIsLoadingFilterAttributes(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [areAttributeFiltersOpen, classId, selectedClass, standard?.id]);

  const attributeFilters = useMemo(() => {
    const filters: Array<{ code: string; operator: 'contains' | 'equals' | 'gte' | 'lte'; value: unknown }> = [];

    visibleAttributes.forEach((attribute) => {
      if (attribute.value_type === 'number' || attribute.value_type === 'integer') {
        const numeric = numericFilters[attribute.code];
        if (numeric?.min.trim()) {
          filters.push({
            code: attribute.code,
            operator: 'gte',
            value: Number(numeric.min),
          });
        }
        if (numeric?.max.trim()) {
          filters.push({
            code: attribute.code,
            operator: 'lte',
            value: Number(numeric.max),
          });
        }
        return;
      }

      if (attribute.value_type === 'enum') {
        const value = enumFilters[attribute.code];
        if (value?.trim()) {
          filters.push({ code: attribute.code, operator: 'equals', value: value.trim() });
        }
        return;
      }

      if (attribute.value_type === 'boolean') {
        const value = booleanFilters[attribute.code];
        if (value === 'true' || value === 'false') {
          filters.push({ code: attribute.code, operator: 'equals', value: value === 'true' });
        }
        return;
      }

      const value = textFilters[attribute.code];
      if (value?.trim()) {
        filters.push({ code: attribute.code, operator: 'contains', value: value.trim() });
      }
    });

    return filters;
  }, [booleanFilters, enumFilters, numericFilters, textFilters, visibleAttributes]);

  const isSearchMode =
    Boolean(deferredKeyword.trim()) || Boolean(classId) || Boolean(status) || attributeFilters.length > 0;
  const queryKey = JSON.stringify({
    nodeId: selectedNode.id,
    keyword: deferredKeyword.trim(),
    classId,
    status,
    attributeFilters,
    refreshToken,
  });

  const loadPage = useCallback(
    async (nextPage: number, replace: boolean) => {
      const requestMode = isSearchMode ? 'structured' : 'browse';

      if (replace) {
        setIsInitialLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const result = await searchProjectTags(projectId, {
          mode: requestMode,
          pbs_node_id: selectedNode.id,
          include_descendants: true,
          include_children: false,
          keyword: deferredKeyword.trim() || undefined,
          class_id: classId || undefined,
          status: status || undefined,
          attribute_filters: attributeFilters.length > 0 ? attributeFilters : undefined,
          page: nextPage,
          page_size: 20,
        });

        setItems((current) => (replace ? result.items : [...current, ...result.items]));
        setPage(result.page);
        setHasMore(result.has_more);
        setError(null);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : '加载 TAG 列表失败';
        setError(message);
        if (replace) {
          setItems([]);
        }
      } finally {
        if (replace) {
          setIsInitialLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    },
    [attributeFilters, classId, deferredKeyword, isSearchMode, projectId, selectedNode.id, status],
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(false);
    setExpandedTagIds(new Set());
    void loadPage(1, true);
  }, [loadPage, queryKey]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || isInitialLoading || isLoadingMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadPage(page + 1, false);
        }
      },
      { rootMargin: '160px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, isInitialLoading, isLoadingMore, loadPage, page]);

  async function handleCreateTag(data: {
    tag_no: string;
    name: string;
    class_id?: string;
    parent_tag_id?: string;
    attribute_values: Record<string, unknown>;
  }) {
    try {
      await createProjectTag(projectId, {
        tag_no: data.tag_no,
        name: data.name,
        pbs_node_id: selectedNode.id,
        class_id: data.class_id,
        parent_tag_id: data.parent_tag_id,
        attribute_values: data.attribute_values,
        status: 'active',
      });
      setTagFormState({ show: false });
      success('Tag 创建成功');
      onTagsChanged();
      setExpandedTagIds((current) => {
        if (!data.parent_tag_id) {
          return current;
        }
        const next = new Set(current);
        next.add(data.parent_tag_id);
        return next;
      });
      await loadPage(1, true);
    } catch (createError) {
      showError(createError instanceof Error ? createError.message : 'Tag 创建失败');
    }
  }

  async function handleDeleteTag(tag: ProjectTagSearchItem, childCount: number) {
    const confirmed = await confirm({
      title: '删除 TAG',
      description: childCount > 0
        ? `确定删除 ${tag.tag_no}？其下 ${childCount} 个部件也会一并删除，此操作不可撤销。`
        : `确定删除 ${tag.tag_no}？此操作不可撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    setDeletingTagIds((current) => {
      const next = new Set(current);
      next.add(tag.id);
      return next;
    });
    setOpenActionTagId(null);

    try {
      await deleteProjectTag(tag.id);
      success('Tag 删除成功');
      onTagsChanged();
      await loadPage(1, true);
    } catch (deleteError) {
      showError(deleteError instanceof Error ? deleteError.message : 'Tag 删除失败');
    } finally {
      setDeletingTagIds((current) => {
        const next = new Set(current);
        next.delete(tag.id);
        return next;
      });
    }
  }

  function resetFilters() {
    setKeyword('');
    setClassId('');
    setStatus('');
    setTextFilters({});
    setEnumFilters({});
    setBooleanFilters({});
    setNumericFilters({});
  }

  function toggleAttributeFilters() {
    if (!areAttributeFiltersOpen) {
      setAreAttributeFiltersOpen(true);
      return;
    }
    setTextFilters({});
    setEnumFilters({});
    setBooleanFilters({});
    setNumericFilters({});
    setFilterCommonAttributes([]);
    setFilterClassAttributes([]);
    setAttributeFilterError(null);
    setAreAttributeFiltersOpen(false);
  }

  function handleClassFilterChange(nextClassId: string) {
    setClassId(nextClassId);
    setTextFilters({});
    setEnumFilters({});
    setBooleanFilters({});
    setNumericFilters({});
    setFilterCommonAttributes([]);
    setFilterClassAttributes([]);
    setAttributeFilterError(null);
  }

  function toggleExpanded(tagId: string) {
    setExpandedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  }

  function renderTagDetailButton(tag: ProjectTagSearchItem, className: string, children: React.ReactNode) {
    return (
      <button
        type="button"
        onClick={() => onOpenTagDetail?.(tag.id)}
        className={className}
      >
        {children}
      </button>
    );
  }

  function renderAttributeFilter(attribute: AttributeDefinition) {
    if (attribute.value_type === 'number' || attribute.value_type === 'integer') {
      const value = numericFilters[attribute.code] ?? { min: '', max: '' };
      return (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={value.min}
            onChange={(event) =>
              setNumericFilters((current) => ({
                ...current,
                [attribute.code]: { ...value, min: event.target.value },
              }))
            }
            placeholder="最小值"
            type="number"
            className={inputClass}
          />
          <input
            value={value.max}
            onChange={(event) =>
              setNumericFilters((current) => ({
                ...current,
                [attribute.code]: { ...value, max: event.target.value },
              }))
            }
            placeholder="最大值"
            type="number"
            className={inputClass}
          />
        </div>
      );
    }

    if (attribute.value_type === 'enum') {
      return (
        <SearchableSelect
          value={enumFilters[attribute.code] ?? ''}
          onChange={(nextValue) =>
            setEnumFilters((current) => ({ ...current, [attribute.code]: nextValue }))
          }
          className={inputClass}
          placeholder="全部"
          clearable
          options={attribute.enum_options.map((option, index) => {
            const optionValue = String(option);
            return { value: optionValue, label: optionValue, keywords: `${attribute.id} ${index}` };
          })}
          searchPlaceholder={`搜索${attribute.name}`}
        />
      );
    }

    if (attribute.value_type === 'boolean') {
      return (
        <SearchableSelect
          value={booleanFilters[attribute.code] ?? ''}
          onChange={(nextValue) =>
            setBooleanFilters((current) => ({
              ...current,
              [attribute.code]: nextValue as BooleanFilterValue,
            }))
          }
          className={inputClass}
          placeholder="全部"
          clearable
          options={[
            { value: 'true', label: '是' },
            { value: 'false', label: '否' },
          ]}
          searchPlaceholder={`搜索${attribute.name}`}
        />
      );
    }

    return (
      <input
        value={textFilters[attribute.code] ?? ''}
        onChange={(event) =>
          setTextFilters((current) => ({ ...current, [attribute.code]: event.target.value }))
        }
        placeholder={attribute.description || `按${attribute.name}模糊搜索`}
        className={inputClass}
      />
    );
  }

  function renderBrowseRows(tag: ProjectTagBrowseItem | ProjectTagSearchItem, isComponent = false) {
    const children = 'children' in tag && Array.isArray(tag.children) ? tag.children : [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedTagIds.has(tag.id);
    const isActionMenuOpen = openActionTagId === tag.id;
    const isDeleting = deletingTagIds.has(tag.id);
    const attrCount = Object.keys(tag.attribute_values || {}).length;

    return (
      <React.Fragment key={tag.id}>
        <tr className={`group cursor-pointer transition hover:bg-slate-50/60 ${isComponent ? 'bg-slate-50/30' : ''}`}>
          <td className="px-6 py-3.5">
            <div className={`inline-flex items-center gap-2 ${isComponent ? 'pl-6' : ''}`}>
              {!isComponent && hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleExpanded(tag.id)}
                  className="rounded p-0.5 text-slate-400 transition hover:bg-slate-200"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-5" />
              )}
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-md ${
                  isComponent ? 'bg-amber-100 text-amber-600' : 'bg-adnoc-blue/10 text-adnoc-blue'
                }`}
              >
                {isComponent ? <Puzzle className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
              </div>
              {renderTagDetailButton(
                tag,
                'font-mono text-slate-700 transition hover:text-adnoc-blue hover:underline',
                tag.tag_no,
              )}
            </div>
          </td>
          <td className="px-6 py-3.5 text-slate-700">
            {renderTagDetailButton(tag, 'text-left transition hover:text-adnoc-blue hover:underline', tag.name)}
          </td>
          <td className="px-6 py-3.5">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                tag.class_name ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {tag.class_name || '未关联'}
            </span>
          </td>
          <td className="px-6 py-3.5 text-xs text-slate-400">{attrCount} 项</td>
          <td className="px-6 py-3.5">
            <div
              className={`relative flex items-center gap-1 transition-opacity ${
                isActionMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {!isComponent && (
                <button
                  type="button"
                  onClick={() => setTagFormState({ show: true, parentTag: tag })}
                  title="添加部件"
                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-adnoc-blue/10 hover:text-adnoc-blue"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpenActionTagId((current) => (current === tag.id ? null : tag.id))}
                aria-expanded={isActionMenuOpen}
                aria-haspopup="menu"
                title="更多操作"
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {isActionMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-8 z-20 w-32 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isDeleting}
                    onClick={() => {
                      void handleDeleteTag(tag, children.length);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    删除
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
        {hasChildren && isExpanded && children.map((child) => renderBrowseRows(child, true))}
      </React.Fragment>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-gray-100 bg-white/80 p-6 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-800">{selectedNode.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-slate-500">{selectedNode.code}</span>
              {selectedNode.node_type !== 'folder' && (
                <span className="rounded-full bg-adnoc-blue/10 px-2 py-0.5 text-xs font-medium text-adnoc-blue">
                  {selectedNode.node_type}
                </span>
              )}
              <span className="text-xs text-slate-400">检索范围: 当前节点及下级子树</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {onEditNode && (
              <button type="button" onClick={onEditNode} className={secondaryButtonClass}>
                <span className={secondaryButtonIconClass}>
                  <Pencil className="h-4 w-4" />
                </span>
                编辑节点
              </button>
            )}
            <button
              type="button"
              onClick={() => setTagFormState({ show: true, parentTag: null })}
              className={primaryButtonClass}
            >
              <span className={primaryButtonIconClass}>
                <Plus className="h-4 w-4" />
              </span>
              新增设备 (Tag)
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-3xl border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_220px_180px_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="按位号、名称搜索，或结合属性条件过滤"
                className={`${inputClass} pl-10`}
              />
            </label>
            <SearchableSelect
              value={classId}
              onChange={handleClassFilterChange}
              className={inputClass}
              placeholder="全部类别"
              clearable
              options={classes.map((item: ClassDefinition) => ({
                value: item.id,
                label: `${item.code} · ${item.name}`,
              }))}
              searchPlaceholder="搜索类别编码或名称"
            />
            <SearchableSelect
              value={status}
              onChange={(nextValue) => setStatus(nextValue as '' | 'active' | 'archived')}
              className={inputClass}
              placeholder="全部状态"
              clearable
              options={[
                { value: 'active', label: '启用' },
                { value: 'archived', label: '归档' },
              ]}
              searchPlaceholder="搜索状态"
            />
            <button type="button" onClick={resetFilters} className={secondaryButtonClass}>
              清空条件
            </button>
          </div>

          <div className="mt-3 flex justify-end">
            <button type="button" onClick={toggleAttributeFilters} className={secondaryButtonClass}>
              {areAttributeFiltersOpen ? '收起属性条件' : '属性条件'}
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI 搜索预留到后续版本，本次先提供结构化属性搜索。</span>
          </div>

          {isLoadingFilterAttributes && (
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>正在加载当前类别的属性条件...</span>
            </div>
          )}

          {attributeFilterError && (
            <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              {attributeFilterError}
            </div>
          )}

          {areAttributeFiltersOpen && visibleAttributes.length > 0 && (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleAttributes.map((attribute) => (
                <div key={attribute.id}>
                  <label className="mb-1 block text-xs font-semibold tracking-wide text-slate-500">
                    {attribute.name}
                    {attribute.unit_family ? ` (${attribute.unit_family})` : ''}
                  </label>
                  {renderAttributeFilter(attribute)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {tagFormState.show && (
        <TagCreateForm
          projectId={projectId}
          pbsNodeName={selectedNode.name}
          parentTag={tagFormState.parentTag ?? null}
          onSubmit={(payload) => {
            void handleCreateTag(payload);
          }}
          onCancel={() => setTagFormState({ show: false })}
        />
      )}

      <div className="flex-1 overflow-auto p-6">
        {error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">{error}</div>
        ) : isInitialLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-adnoc-blue" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white p-12 text-slate-400">
            <TagIcon className="mb-4 h-10 w-10 text-slate-200" />
            <p>{isSearchMode ? '没有符合条件的 TAG' : '当前范围暂无绑定的工程对象'}</p>
            <p className="mt-1 text-xs">{isSearchMode ? '可以调整属性条件或清空筛选后重试' : '点击上方按钮添加设备 Tag'}</p>
          </div>
        ) : isSearchMode ? (
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-slate-50">
                <tr>
                  <th className="px-6 py-4 font-semibold text-slate-600">位号</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">名称</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">所属 PBS</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">父级</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">类别</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">命中属性</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100/70">
                {items.map((item) => {
                  const tag = item as ProjectTagSearchItem;
                  return (
                    <tr key={tag.id} className="hover:bg-slate-50/60">
                      <td className="px-6 py-3.5 font-mono text-slate-700">
                        {renderTagDetailButton(tag, 'transition hover:text-adnoc-blue hover:underline', tag.tag_no)}
                      </td>
                      <td className="px-6 py-3.5 text-slate-700">
                        {renderTagDetailButton(tag, 'text-left transition hover:text-adnoc-blue hover:underline', tag.name)}
                      </td>
                      <td className="px-6 py-3.5 text-slate-500">
                        {tag.pbs_node_code || '-'} {tag.pbs_node_name || ''}
                      </td>
                      <td className="px-6 py-3.5 text-slate-500">
                        {tag.parent_tag_no ? `${tag.parent_tag_no} ${tag.parent_tag_name || ''}` : '-'}
                      </td>
                      <td className="px-6 py-3.5 text-slate-500">{tag.class_name || '未关联'}</td>
                      <td className="px-6 py-3.5 text-xs text-slate-400">
                        {tag.matched_attribute_codes.length > 0 ? tag.matched_attribute_codes.join(', ') : '关键词命中'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-visible rounded-2xl border border-gray-100 bg-white shadow-sm">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="border-b border-gray-100 bg-slate-50">
                <tr>
                  <th className="px-6 py-4 font-semibold text-slate-600">位号 (Tag No)</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">名称</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">类别 (Class)</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">属性数</th>
                  <th className="w-20 px-6 py-4 font-semibold text-slate-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100/60">
                {(items as ProjectTagBrowseItem[]).map((tag) => renderBrowseRows(tag))}
              </tbody>
            </table>
          </div>
        )}

        <div ref={loadMoreRef} className="flex h-16 items-center justify-center">
          {isLoadingMore ? <Loader2 className="h-5 w-5 animate-spin text-adnoc-blue" /> : null}
        </div>
      </div>
    </div>
  );
}
