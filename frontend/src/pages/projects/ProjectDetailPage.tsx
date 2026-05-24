import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  LayoutGrid,
  Loader2,
  GripVertical,
  Building2,
  Map,
  Layers,
  Cpu,
  Package,
  FolderOpen,
  Folder,
  Pencil,
  Trash2,
  UsersRound,
  Upload,
  AlertTriangle,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import {
  deleteProject,
  getPbsNodes,
  createPbsNode,
  updatePbsNode,
  getProjectDetail,
  getStandardDetail,
  type PbsNode,
  type Project,
  type StandardDetail,
  ApiError,
} from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../auth/AuthProvider';
import { useDialog } from '../../components/ui/Dialog';
import {
  secondaryButtonClass,
  secondaryButtonIconClass,
  softPrimaryButtonClass,
  softPrimaryButtonIconClass,
} from '../../components/ui/buttonStyles';
import { PbsNodeForm, type PbsNodeFormData } from '../../components/pbs/PbsNodeForm';
import { TagImportDialog } from '../../components/tags/TagImportDialog';
import { ProjectTagPanel } from '../../components/tags/ProjectTagPanel';
import { CreateProjectModal } from '../../components/projects/CreateProjectModal';
import { ProjectDocumentWorkspace } from '../../components/documents/ProjectDocumentWorkspace';
import { ProjectMembersDialog } from '../../components/projects/ProjectMembersDialog';
import { TagDetailPage } from './TagDetailPage';
import { usePlugins } from '../../plugins/PluginProvider';

/* ================================================================= */
/*  Drop position types                                               */
/* ================================================================= */
type DropPosition = 'before' | 'inside' | 'after';
interface DropTarget {
  nodeId: string;
  position: DropPosition;
}

interface PbsNodeTypeVisual {
  icon: LucideIcon;
  label: string;
  wrapperClassName: string;
  iconClassName: string;
}

const PLUGIN_ACTION_ICON_MAP: Record<string, LucideIcon> = {
  AlertTriangle,
  CalendarDays,
  Package,
  Plug: Package,
};

const PBS_NODE_TYPE_VISUALS: Record<string, PbsNodeTypeVisual> = {
  site: {
    icon: Building2,
    label: '站场',
    wrapperClassName: 'bg-sky-50 text-sky-600 ring-sky-100',
    iconClassName: 'text-sky-600',
  },
  area: {
    icon: Map,
    label: '区域',
    wrapperClassName: 'bg-cyan-50 text-cyan-600 ring-cyan-100',
    iconClassName: 'text-cyan-600',
  },
  unit: {
    icon: Layers,
    label: '单元',
    wrapperClassName: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
    iconClassName: 'text-indigo-600',
  },
  system: {
    icon: Cpu,
    label: '系统',
    wrapperClassName: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    iconClassName: 'text-emerald-600',
  },
  package: {
    icon: Package,
    label: '包',
    wrapperClassName: 'bg-amber-50 text-amber-600 ring-amber-100',
    iconClassName: 'text-amber-600',
  },
  folder: {
    icon: Folder,
    label: '通用节点',
    wrapperClassName: 'bg-slate-50 text-slate-500 ring-slate-100',
    iconClassName: 'text-slate-500',
  },
};

const DEFAULT_PBS_NODE_TYPE_VISUAL: PbsNodeTypeVisual = {
  icon: Folder,
  label: '节点',
  wrapperClassName: 'bg-slate-50 text-slate-500 ring-slate-100',
  iconClassName: 'text-slate-500',
};

const PBS_TREE_DEPTH_INDENT_REM = 0.72;
const PBS_TREE_ROW_BASE_PADDING_REM = 0.1;
const PBS_TREE_DROP_OFFSET_REM = 1.15;

function normalizePbsNodeType(value?: string | null) {
  return value?.trim().toLowerCase() ?? '';
}

function getTreeIndent(depth: number, offsetRem = PBS_TREE_ROW_BASE_PADDING_REM) {
  return `${depth * PBS_TREE_DEPTH_INDENT_REM + offsetRem}rem`;
}

function getPbsNodeTypeVisual(node: PbsNode) {
  const visual =
    PBS_NODE_TYPE_VISUALS[normalizePbsNodeType(node.level_code)] ??
    PBS_NODE_TYPE_VISUALS[normalizePbsNodeType(node.node_type)] ??
    DEFAULT_PBS_NODE_TYPE_VISUAL;

  return {
    ...visual,
    label: node.level_name || visual.label || node.node_type || DEFAULT_PBS_NODE_TYPE_VISUAL.label,
  };
}

function isPbsTreeNode(node: PbsNode) {
  const levelCode = normalizePbsNodeType(node.level_code);
  const nodeType = normalizePbsNodeType(node.node_type);
  return levelCode !== 'tag' && levelCode !== 'component' && nodeType !== 'tag' && nodeType !== 'component';
}

/* ================================================================= */
/*  Component                                                         */
/* ================================================================= */
export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [standard, setStandard] = useState<StandardDetail | null>(null);
  const [nodes, setNodes] = useState<PbsNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  /* drag & drop */
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isTagImportOpen, setIsTagImportOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'pbs' | 'documents'>(
    searchParams.get('view') === 'documents' ? 'documents' : 'pbs',
  );
  const [tagSearchRefreshToken, setTagSearchRefreshToken] = useState(0);
  const [openTagDetailId, setOpenTagDetailId] = useState<string | null>(null);

  const { success, error: showError } = useToast();
  const { can } = useAuth();
  const { slots } = usePlugins();
  const { confirm } = useDialog();
  const projectDetailActions = project
    ? slots
        .filter((slot) => slot.slot === 'project.detail.actions')
        .filter((slot) => {
          const permissions = slot.permissions ?? [];
          if (permissions.length === 0) {
            return true;
          }
          if (slot.requireAny) {
            return permissions.some((permission) => can(permission, project.id));
          }
          return permissions.every((permission) => can(permission, project.id));
        })
        .map((slot) => ({
          ...slot,
          to: slot.to.replace('{projectId}', encodeURIComponent(project.id)),
          icon: PLUGIN_ACTION_ICON_MAP[slot.icon ?? ''] ?? Package,
        }))
    : [];
  const projectStandardId =
    typeof project?.reference_attributes?.standard_id === 'string'
      ? project.reference_attributes.standard_id
      : null;
  const shouldLoadStandard = viewMode === 'pbs' || isTagImportOpen || Boolean(openTagDetailId);

  /* ---- Data loading ---- */
  useEffect(() => {
    if (!projectId) {
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      setIsLoading(true);
      try {
        const [fetchedNodes, fetchedProject] = await Promise.all([
          getPbsNodes(projectId),
          getProjectDetail(projectId),
        ]);

        if (cancelled) {
          return;
        }

        setNodes(fetchedNodes);
        setProject(fetchedProject);
        setStandard(null);
        setExpandedIds(new Set(fetchedNodes.filter(isPbsTreeNode).map((n) => n.id)));
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          if (e instanceof ApiError && e.status === 403) {
            navigate('/403', { replace: true });
          } else {
            showError('数据加载失败');
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [navigate, projectId, showError]);

  useEffect(() => {
    if (!projectStandardId) {
      setStandard(null);
      return;
    }
    if (!shouldLoadStandard || standard?.id === projectStandardId) {
      return;
    }

    let cancelled = false;
    getStandardDetail(projectStandardId, { includeEquipmentClasses: false })
      .then((nextStandard) => {
        if (!cancelled) {
          setStandard(nextStandard);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          showError('参考标准详情加载失败');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectStandardId, shouldLoadStandard, showError, standard?.id]);

  const pbsTreeNodes = useMemo(() => nodes.filter(isPbsTreeNode), [nodes]);
  const selectedNode = pbsTreeNodes.find((n) => n.id === selectedNodeId) ?? null;

  useEffect(() => {
    if (searchParams.get('view') === 'documents') {
      setViewMode('documents');
    } else if (searchParams.get('view') === 'data-quality' && projectId) {
      navigate(`/data-quality?projectId=${encodeURIComponent(projectId)}`, { replace: true });
    } else if (searchParams.get('view') === 'ai') {
      setViewMode('pbs');
    }
  }, [navigate, projectId, searchParams]);

  /* ---- Tree helpers ---- */
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getChildren = (parentId: string | null) =>
    pbsTreeNodes.filter((n) => (n.parent_id || null) === parentId);

  const isDescendant = (nodeId: string, potentialAncestor: string): boolean => {
    let current = nodes.find((n) => n.id === nodeId);
    while (current) {
      if (current.parent_id === potentialAncestor) return true;
      current = nodes.find((n) => n.id === current!.parent_id);
    }
    return false;
  };

  /* ---- Create PBS node ---- */
  const handleCreateNode = (data: PbsNodeFormData) => {
    const parentId = creatingUnder === '__ROOT__' ? null : creatingUnder;
    setIsLoading(true);
    createPbsNode(projectId!, { ...data, parent_id: parentId ?? undefined })
      .then((newNode) => {
        setNodes((prev) => [...prev, newNode]);
        setCreatingUnder(null);
        if (parentId) setExpandedIds((prev) => new Set(prev).add(parentId));
        setTagSearchRefreshToken((current) => current + 1);
        success('节点创建成功');
      })
      .catch((e) => showError(e?.message || '创建失败'))
      .finally(() => setIsLoading(false));
  };

  const handleAddNodeClick = () => {
    setEditingNodeId(null);
    if (selectedNodeId) {
      setCreatingUnder(selectedNodeId);
      setExpandedIds((prev) => new Set(prev).add(selectedNodeId));
    } else {
      setCreatingUnder('__ROOT__');
    }
  };

  const handleStartEditNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setCreatingUnder(null);
    setEditingNodeId(nodeId);
  };

  const handleUpdateNode = (data: PbsNodeFormData) => {
    if (!editingNodeId) return;
    const editingNode = nodes.find((node) => node.id === editingNodeId);
    if (!editingNode) {
      showError('未找到要编辑的 PBS 节点');
      setEditingNodeId(null);
      return;
    }

    setIsLoading(true);
    updatePbsNode(editingNodeId, {
      ...data,
      parent_id: editingNode.parent_id ?? undefined,
    })
      .then((updatedNode) => {
        setNodes((prev) => prev.map((node) => (node.id === updatedNode.id ? updatedNode : node)));
        setEditingNodeId(null);
        setTagSearchRefreshToken((current) => current + 1);
        success('节点更新成功');
      })
      .catch((e) => showError(e?.message || '节点更新失败'))
      .finally(() => setIsLoading(false));
  };

  /* ---- Drag & Drop handlers ---- */
  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    setDragNodeId(nodeId);
    e.dataTransfer.effectAllowed = 'move';
    const el = e.currentTarget as HTMLElement;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.position = 'absolute';
    clone.style.top = '-1000px';
    clone.style.background = 'white';
    clone.style.borderRadius = '12px';
    clone.style.padding = '6px 16px';
    clone.style.border = '2px solid rgb(21, 108, 250)';
    clone.style.boxShadow = '0 8px 24px rgba(21,108,250,0.18)';
    clone.style.opacity = '0.95';
    clone.style.zIndex = '9999';
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, 20, 18);
    requestAnimationFrame(() => document.body.removeChild(clone));
  };

  const handleDragOver = (e: React.DragEvent, nodeId: string) => {
    e.preventDefault();
    if (!dragNodeId || dragNodeId === nodeId) return;
    if (isDescendant(nodeId, dragNodeId)) return;
    
    const dragNode = nodes.find(n => n.id === dragNodeId);
    const targetNode = nodes.find(n => n.id === nodeId);
    if (!dragNode || !targetNode) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    let position: DropPosition;
    if (ratio < 0.25) position = 'before';
    else if (ratio > 0.75) position = 'after';
    else position = 'inside';

    // Strict level enforcement for drag operations
    if (standard && standard.pbs_levels && standard.pbs_levels.length > 0) {
      const dragLevelNo = dragNode.level_no ?? 0;
      const expectedParentLevelNo = dragLevelNo - 1;
      
      let targetParentLevelNo = 0;
      if (position === 'inside') {
        targetParentLevelNo = targetNode.level_no ?? 0;
      } else {
        const pNode = nodes.find(n => n.id === targetNode.parent_id);
        targetParentLevelNo = pNode?.level_no ?? 0;
      }
      
      // If it doesn't match the strict hierarchy, disallow the drop interaction here
      if (targetParentLevelNo !== expectedParentLevelNo) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
    }

    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ nodeId, position });
  };

  const handleDragLeave = () => setDropTarget(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragNodeId || !dropTarget) return;
    const dragNode = nodes.find((n) => n.id === dragNodeId);
    const targetNode = nodes.find((n) => n.id === dropTarget.nodeId);
    if (!dragNode || !targetNode) return;
    let newParentId: string | null;
    if (dropTarget.position === 'inside') newParentId = targetNode.id;
    else newParentId = targetNode.parent_id || null;
    if (newParentId && isDescendant(newParentId, dragNodeId)) {
      showError('不能将节点拖入自己的子节点');
      setDragNodeId(null);
      setDropTarget(null);
      return;
    }
    
    // Verify levels right before DB update just in case
    if (standard && standard.pbs_levels && standard.pbs_levels.length > 0) {
      const dragLevelNo = dragNode.level_no ?? 0;
      const newParentNode = newParentId ? nodes.find(n => n.id === newParentId) : null;
      const newParentLevelNo = newParentNode?.level_no ?? 0;
      if (newParentLevelNo !== dragLevelNo - 1) {
         showError(`层级规范冲突: 只能拖拽到合适的上级节点下`);
         setDragNodeId(null);
         setDropTarget(null);
         return;
      }
    }

    try {
      const updated = await updatePbsNode(dragNodeId, {
        code: dragNode.code,
        name: dragNode.name,
        description: dragNode.description,
        node_type: dragNode.node_type,
        status: dragNode.status,
        parent_id: newParentId ?? undefined,
      });
      setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      if (newParentId) setExpandedIds((prev) => new Set(prev).add(newParentId!));
      setTagSearchRefreshToken((current) => current + 1);
      success('层级调整成功');
    } catch {
      showError('层级调整失败');
    }
    setDragNodeId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragNodeId(null);
    setDropTarget(null);
  };

  /* ================================================================ */
  /*  PBS Tree Node Render                                             */
  /* ================================================================ */
  const renderTreeNode = (node: PbsNode, depth: number) => {
    const children = getChildren(node.id);
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedNodeId === node.id;
    const isEditingNode = editingNodeId === node.id;
    const isDragging = dragNodeId === node.id;
    const isDropInside = dropTarget?.nodeId === node.id && dropTarget.position === 'inside';
    const isDropBefore = dropTarget?.nodeId === node.id && dropTarget.position === 'before';
    const isDropAfter = dropTarget?.nodeId === node.id && dropTarget.position === 'after';
    const showFormHere = creatingUnder === node.id;
    const nodeTypeVisual = getPbsNodeTypeVisual(node);
    const NodeTypeIcon = normalizePbsNodeType(node.node_type) === 'folder' && isExpanded ? FolderOpen : nodeTypeVisual.icon;
    const nodeTitle = [node.code, node.name, nodeTypeVisual.label].filter(Boolean).join(' · ');
    const dragHandleLeftRem = depth * PBS_TREE_DEPTH_INDENT_REM - 0.85;

    return (
      <div key={node.id} className={isDragging ? 'opacity-30' : ''}>
        {isDropBefore && (
          <div
            className="h-[3px] rounded-full bg-adnoc-blue mx-2 transition-all"
            style={{ marginLeft: getTreeIndent(depth, PBS_TREE_DROP_OFFSET_REM) }}
          />
        )}

        <div
          draggable
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onClick={() => {
            setSelectedNodeId(node.id);
          }}
          title={nodeTitle}
          className={`group relative flex items-center gap-0.5 rounded-lg px-1 py-1 text-sm cursor-pointer transition-all ${
            isSelected
              ? 'bg-adnoc-blue/10 text-adnoc-blue font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          } ${isDropInside ? 'ring-2 ring-adnoc-blue ring-inset bg-adnoc-blue/5 rounded-xl' : ''}`}
          style={{ paddingLeft: getTreeIndent(depth) }}
        >
          <span
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-60"
            style={{ left: `${dragHandleLeftRem}rem` }}
          >
            <GripVertical className="h-3.5 w-3.5 text-slate-400" />
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
            className="shrink-0 p-0.5 rounded hover:bg-slate-200/60 transition-colors"
          >
            {children.length > 0 ? (
              isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <span className="inline-block w-3.5" />
            )}
          </button>
          <span
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md ring-1 ${nodeTypeVisual.wrapperClassName}`}
            title={`层级: ${nodeTypeVisual.label}`}
            aria-label={`层级: ${nodeTypeVisual.label}`}
          >
            <NodeTypeIcon className={`h-3 w-3 ${nodeTypeVisual.iconClassName}`} />
          </span>
          <span className="min-w-0 flex-1 truncate select-none">
            <span className="font-mono text-xs opacity-60 mr-1">{node.code}</span>
            {node.name}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleStartEditNode(node.id);
            }}
            title="编辑节点"
            className={`rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-adnoc-blue ${
              isSelected || isEditingNode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>

        {isDropAfter && (!children.length || !isExpanded) && (
          <div className="h-[3px] rounded-full bg-adnoc-blue mx-2 transition-all" style={{ marginLeft: getTreeIndent(depth, PBS_TREE_DROP_OFFSET_REM) }} />
        )}

        {isExpanded && children.length > 0 && (
          <div>{children.map((child) => renderTreeNode(child, depth + 1))}</div>
        )}

        {isDropAfter && children.length > 0 && isExpanded && (
          <div className="h-[3px] rounded-full bg-adnoc-blue mx-2 transition-all" style={{ marginLeft: getTreeIndent(depth + 1, PBS_TREE_DROP_OFFSET_REM) }} />
        )}

        {showFormHere && (
          <div className="my-2" style={{ marginLeft: getTreeIndent(depth + 1), marginRight: '0.5rem' }}>
            <PbsNodeForm
              parentNode={node}
              pbsLevels={standard?.pbs_levels ?? []}
              onSubmit={handleCreateNode}
              onCancel={() => setCreatingUnder(null)}
            />
          </div>
        )}

        {isEditingNode && (
          <div className="my-2" style={{ marginLeft: getTreeIndent(depth + 1), marginRight: '0.5rem' }}>
            <PbsNodeForm
              editingNode={node}
              pbsLevels={standard?.pbs_levels ?? []}
              onSubmit={handleUpdateNode}
              onCancel={() => setEditingNodeId(null)}
            />
          </div>
        )}
      </div>
    );
  };

  const rootNodes = getChildren(null);
  const viewTitle = viewMode === 'pbs' ? 'PBS 数据架构' : '图纸清单';
  const handleProjectSaved = async (savedProject?: Project) => {
    if (!savedProject) {
      setIsProjectModalOpen(false);
      return;
    }

    try {
      const nextStandard =
        typeof savedProject.reference_attributes?.standard_id === 'string' &&
        savedProject.reference_attributes.standard_id
          ? await getStandardDetail(savedProject.reference_attributes.standard_id, { includeEquipmentClasses: false })
          : null;
      setProject(savedProject);
      setStandard(nextStandard);
      setIsProjectModalOpen(false);
      setTagSearchRefreshToken((current) => current + 1);
      success('项目信息已更新');
    } catch (e) {
      console.error(e);
      showError('项目已更新，但参考标准详情刷新失败');
      setProject(savedProject);
      setStandard(null);
      setIsProjectModalOpen(false);
    }
  };

  const handleProjectDeleted = async (deletedProject: Project) => {
    setIsProjectModalOpen(false);
    success(`项目“${deletedProject.name}”已删除`);
    navigate('/projects', { replace: true });
  };

  const handleDeleteProject = async () => {
    if (!project) {
      return;
    }

    const accepted = await confirm({
      title: '删除项目',
      description: `确认删除项目“${project.name}”吗？这会同时删除 PBS、TAG、图纸、导入记录、关系和项目成员授权，且不可恢复。`,
      confirmText: '删除项目',
      danger: true,
    });
    if (!accepted) {
      return;
    }

    try {
      await deleteProject(project.id);
      await handleProjectDeleted(project);
    } catch (deleteError) {
      const message =
        deleteError instanceof Error && deleteError.message === 'Forbidden'
          ? '当前账号没有删除项目权限'
          : deleteError instanceof Error
            ? deleteError.message
            : '删除项目失败';
      showError(message);
    }
  };

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */
  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-col lg:h-[calc(100vh-theme(spacing.16))]">
      {/* Header */}
      <div className="z-10 flex flex-col gap-3 border-b border-gray-200/50 bg-white/80 px-3 py-3 backdrop-blur-xl sm:px-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:px-6 lg:py-4">
        <div className="flex min-w-0 items-center text-sm text-gray-500">
          <Link to="/projects" className="hover:text-adnoc-blue transition-colors">项目管理</Link>
          <ChevronRight className="h-4 w-4 mx-1" />
          <span className="text-gray-900 font-medium">{viewTitle}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          {projectDetailActions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {projectDetailActions.map((action) => {
                const Icon = action.icon;
                return (
              <Link
                    key={`${action.pluginId}:${action.to}`}
                    to={action.to}
                    title={action.title ?? action.label}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-adnoc-blue hover:shadow-sm"
                  >
                    <Icon className="h-4 w-4" />
                    {action.label}
                  </Link>
                );
              })}
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setViewMode('pbs')}
              className={`rounded-lg px-3 py-2 text-sm transition ${viewMode === 'pbs' ? 'bg-white text-adnoc-blue shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              PBS / TAG
            </button>
            <button
              type="button"
              onClick={() => setViewMode('documents')}
              className={`rounded-lg px-3 py-2 text-sm transition ${viewMode === 'documents' ? 'bg-white text-adnoc-blue shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              图纸
            </button>
          </div>
          {viewMode === 'pbs' && project && can('project.tag.import', project.id) && (
            <button
              onClick={() => setIsTagImportOpen(true)}
              disabled={!standard}
              className={softPrimaryButtonClass}
              title={standard ? '导入项目级 TAG Excel' : '请先为项目关联标准后再导入'}
            >
              <span className={softPrimaryButtonIconClass}>
                <Upload className="h-4 w-4" />
              </span>
              导入 TAG
            </button>
          )}
          {project && can('project.update', project.id) && (
            <button
              onClick={() => setIsProjectModalOpen(true)}
              className={secondaryButtonClass}
            >
              <span className={secondaryButtonIconClass}>
                <Pencil className="h-4 w-4" />
              </span>
              编辑项目
            </button>
          )}
          {project && (can('project.delete', project.id) || can('project.update', project.id)) && (
            <button
              type="button"
              onClick={() => {
                void handleDeleteProject();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-200 transition-all hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              <Trash2 className="h-4 w-4" />
              删除项目
            </button>
          )}
          {project && can('project.member.manage', project.id) && (
            <button
              onClick={() => setIsMembersOpen(true)}
              className={secondaryButtonClass}
            >
              <span className={secondaryButtonIconClass}>
                <UsersRound className="h-4 w-4" />
              </span>
              成员管理
            </button>
          )}
        </div>
      </div>

      {viewMode === 'documents' ? (
        <div className="flex-1 overflow-visible p-3 sm:p-4 lg:overflow-hidden lg:p-6">
          <ProjectDocumentWorkspace
            projectId={projectId!}
            standardId={projectStandardId}
            pbsNodes={nodes}
          />
        </div>
      ) : (
      <div className="flex flex-1 flex-col overflow-visible lg:flex-row lg:overflow-hidden">
        {/* ============== Left Panel: PBS Tree ============== */}
        <div className="relative z-0 flex max-h-[46dvh] w-full flex-col border-b border-gray-200/50 bg-white/50 backdrop-blur-md lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-3 sm:p-4">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-adnoc-blue" />
              PBS 层级结构
            </h3>
            <button
              onClick={handleAddNodeClick}
              title={selectedNodeId ? '在选中节点下新增子节点' : '新增根节点'}
              className={`${softPrimaryButtonClass} px-3 py-2 text-xs`}
            >
              <span className={softPrimaryButtonIconClass}>
                <Plus className="h-3.5 w-3.5" />
              </span>
              新增节点
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-adnoc-blue" />
              </div>
            ) : pbsTreeNodes.length === 0 && creatingUnder !== '__ROOT__' ? (
              <div className="text-center py-8 text-sm text-gray-500">
                暂无 PBS 节点，点击上方按钮创建
              </div>
            ) : (
              <>
                {creatingUnder === '__ROOT__' && (
                  <div className="mb-3">
                    <PbsNodeForm
                      pbsLevels={standard?.pbs_levels ?? []}
                      onSubmit={handleCreateNode}
                      onCancel={() => setCreatingUnder(null)}
                    />
                  </div>
                )}
                <div className="space-y-0.5">
                  {rootNodes.map((node) => renderTreeNode(node, 0))}
                </div>
                {dragNodeId && (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      if (!dragNodeId) return;
                      const dragNode = nodes.find((n) => n.id === dragNodeId);
                      if (!dragNode) return;
                      try {
                        const updated = await updatePbsNode(dragNodeId, {
                          code: dragNode.code, name: dragNode.name,
                          description: dragNode.description, node_type: dragNode.node_type,
                          status: dragNode.status, parent_id: undefined,
                        });
                        setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
                        setTagSearchRefreshToken((current) => current + 1);
                        success('已移动至根级别');
                      } catch { showError('移动失败'); }
                      setDragNodeId(null); setDropTarget(null);
                    }}
                    className="mt-4 rounded-xl border-2 border-dashed border-slate-200 py-3 text-center text-xs text-slate-400 hover:border-adnoc-blue hover:text-adnoc-blue transition-colors"
                  >
                    拖拽到此处移入根级别
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ============== Right Panel: Tags ============== */}
        <div className="relative flex min-h-[520px] flex-1 flex-col overflow-visible bg-gray-50/50 lg:min-h-0 lg:overflow-hidden">
          {selectedNode ? (
            <ProjectTagPanel
              projectId={projectId!}
              selectedNode={selectedNode}
              standard={standard}
              refreshToken={tagSearchRefreshToken}
              onEditNode={() => handleStartEditNode(selectedNode.id)}
              onTagsChanged={() => {}}
              onOpenTagDetail={setOpenTagDetailId}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              <div className="text-center">
                <LayoutGrid className="mx-auto h-12 w-12 text-gray-300 opacity-50 mb-3" />
                <p>请在左侧选择一个 PBS 节点查看下属标签</p>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {isProjectModalOpen && project && (
        <CreateProjectModal
          mode="edit"
          initialProject={project}
          onClose={() => setIsProjectModalOpen(false)}
          onSuccess={(savedProject) => {
            void handleProjectSaved(savedProject);
          }}
          onDeleted={(deletedProject) => {
            void handleProjectDeleted(deletedProject);
          }}
        />
      )}
      {projectId && (
        <TagImportDialog
          open={isTagImportOpen}
          projectId={projectId}
          pbsNodes={nodes}
          classes={standard?.classes ?? []}
          onClose={() => setIsTagImportOpen(false)}
          onImported={() => {
            setTagSearchRefreshToken((current) => current + 1);
          }}
        />
      )}
      {projectId && (
        <ProjectMembersDialog
          open={isMembersOpen}
          projectId={projectId}
          onClose={() => setIsMembersOpen(false)}
        />
      )}
      {projectId && openTagDetailId && (
        <div className="fixed inset-0 z-50 bg-gray-50">
          <TagDetailPage
            projectId={projectId}
            tagId={openTagDetailId}
            initialProject={project}
            initialStandard={standard}
            initialPbsNodes={nodes}
            mode="overlay"
            onClose={() => setOpenTagDetailId(null)}
            onOpenTag={setOpenTagDetailId}
            onOpenDocuments={() => {
              setViewMode('documents');
              setOpenTagDetailId(null);
            }}
            onSaved={() => setTagSearchRefreshToken((current) => current + 1)}
          />
        </div>
      )}
    </div>
  );
}
