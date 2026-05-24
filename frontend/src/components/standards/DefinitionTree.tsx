import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, GripVertical, Pencil, Plus, Search, X } from 'lucide-react';

export interface DefinitionTreeNode {
  id: string;
  name: string;
  code?: string | null;
  children: DefinitionTreeNode[];
}

export function DefinitionTree({
  title,
  titleIcon,
  commonLabel,
  commonSelected,
  selectedId,
  nodes,
  rootActionLabel,
  childActionLabel,
  commonPrefix = '✨',
  searchPlaceholder = '搜索类别编码或名称',
  showTitle = true,
  showSelectedActions = true,
  showNodeCodes = true,
  showCommon = true,
  showRootAction = true,
  allowDragDrop = true,
  renderNodeIcon,
  onSelectCommon,
  onSelectNode,
  onMove,
  onAddRoot,
  onAddChild,
  onEditNode,
}: {
  title: string;
  titleIcon?: ReactNode;
  commonLabel: string;
  commonSelected: boolean;
  selectedId: string | null;
  nodes: DefinitionTreeNode[];
  rootActionLabel: string;
  childActionLabel: string;
  commonPrefix?: ReactNode;
  searchPlaceholder?: string;
  showTitle?: boolean;
  showSelectedActions?: boolean;
  showNodeCodes?: boolean;
  showCommon?: boolean;
  showRootAction?: boolean;
  allowDragDrop?: boolean;
  renderNodeIcon?: (selected: boolean) => ReactNode;
  onSelectCommon: () => void;
  onSelectNode: (id: string) => void;
  onMove: (draggedId: string, targetId: string | null) => void | Promise<void>;
  onAddRoot: () => void;
  onAddChild: (id: string) => void;
  onEditNode: (id: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedSearchQuery = normalizeTreeSearchValue(searchQuery);
  const isSearching = normalizedSearchQuery.length > 0;
  const visibleNodes = isSearching ? filterTreeNodes(nodes, normalizedSearchQuery) : nodes;
  const selectedNode = showSelectedActions && selectedId ? findTreeNode(nodes, selectedId) : null;

  return (
    <div className="glass-card flex max-h-[70dvh] min-h-[360px] min-w-0 flex-col rounded-2xl p-3 sm:p-4 xl:h-full xl:max-h-none xl:min-h-0">
      {showTitle && (
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="text-base font-black tracking-tighter text-slate-900 sm:text-lg">{title}</h3>
          {titleIcon}
        </div>
      )}

      <div className="relative mb-3 shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-10 w-full rounded-xl border border-slate-200 bg-white/85 pl-9 pr-9 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/15"
          placeholder={searchPlaceholder}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-100 hover:text-slate-500"
            aria-label="清空类别搜索"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {selectedNode && (
        <div className="mb-2 rounded-xl border border-slate-100 bg-slate-50/80 p-2">
          <div className="mb-2 truncate px-1 text-[11px] font-semibold text-slate-500" title={selectedNode.name}>
            已选：{selectedNode.name}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onEditNode(selectedNode.id)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:border-adnoc-blue/30 hover:text-adnoc-blue"
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </button>
            <button
              type="button"
              onClick={() => onAddChild(selectedNode.id)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:border-adnoc-blue/30 hover:text-adnoc-blue"
            >
              <Plus className="h-3.5 w-3.5" />
              {childActionLabel}
            </button>
          </div>
        </div>
      )}

      {showCommon && (
      <div className="mb-2">
        <button
          type="button"
          onClick={onSelectCommon}
          className={clsx(
            'group relative flex w-full cursor-pointer items-center rounded-lg px-2 py-2 transition-all',
            commonSelected ? 'bg-indigo-50 font-medium text-indigo-600 shadow-sm' : 'text-slate-700 hover:bg-slate-50',
          )}
        >
          {commonSelected && <div className="absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r-md bg-indigo-600" />}
          <span className={clsx('pl-2 text-[15px] tracking-tight', commonSelected ? 'font-bold' : 'font-medium')}>
            {commonPrefix} {commonLabel}
          </span>
        </button>
      </div>
      )}

      <div
        className="flex-1 space-y-1 overflow-y-auto rounded-2xl border border-slate-100 bg-white/30 p-2 backdrop-blur-sm"
        onDragOver={(event) => {
          if (!allowDragDrop) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          if (!allowDragDrop) {
            return;
          }
          event.preventDefault();
          const draggedId = event.dataTransfer.getData('text/plain');
          if (draggedId) {
            void onMove(draggedId, null);
          }
        }}
      >
        {nodes.length === 0 ? (
          showRootAction ? (
            <TreeActionButton label={rootActionLabel} onClick={onAddRoot} />
          ) : (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center">
              <p className="text-sm font-semibold text-slate-500">暂无类别</p>
            </div>
          )
        ) : visibleNodes.length === 0 ? (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center">
            <Search className="mb-2 h-5 w-5 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">没有匹配的类别</p>
            <p className="mt-1 text-xs text-slate-400">换一个编码或名称关键词试试</p>
          </div>
        ) : (
          <>
            {visibleNodes.map((node) => (
              <DefinitionTreeNodeItem
                key={node.id}
                node={node}
                selectedId={selectedId}
                showNodeCodes={showNodeCodes}
                renderNodeIcon={renderNodeIcon}
                onSelectNode={onSelectNode}
                onMove={onMove}
                onEditNode={onEditNode}
                allowDragDrop={allowDragDrop}
                allowEdit={showSelectedActions}
                forceExpanded={isSearching}
              />
            ))}
            {showRootAction && (
            <div className={clsx('mt-3 border-t border-slate-100 pt-3', isSearching && 'hidden')}>
              <TreeActionButton label={rootActionLabel} onClick={onAddRoot} />
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DefinitionTreeNodeItem({
  node,
  selectedId,
  showNodeCodes,
  renderNodeIcon,
  onSelectNode,
  onMove,
  onEditNode,
  allowDragDrop,
  allowEdit,
  forceExpanded,
}: {
  node: DefinitionTreeNode;
  selectedId: string | null;
  showNodeCodes: boolean;
  renderNodeIcon?: (selected: boolean) => React.ReactNode;
  onSelectNode: (id: string) => void;
  onMove: (draggedId: string, targetId: string | null) => void | Promise<void>;
  onEditNode: (id: string) => void;
  allowDragDrop: boolean;
  allowEdit: boolean;
  forceExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedId === node.id;
  const isExpanded = forceExpanded || expanded;

  return (
    <div className="select-none relative">
      <div
        draggable={allowDragDrop}
        onDragStart={(event) => {
          if (!allowDragDrop) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          event.dataTransfer.setData('text/plain', node.id);
          event.dataTransfer.effectAllowed = 'move';
          event.currentTarget.classList.add('opacity-40', 'scale-[0.98]');
        }}
        onDragOver={(event) => {
          if (!allowDragDrop) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          event.currentTarget.classList.add('ring-2', 'ring-adnoc-blue', 'bg-blue-50/80');
        }}
        onDragLeave={(event) => {
          if (!allowDragDrop) {
            return;
          }
          event.currentTarget.classList.remove('ring-2', 'ring-adnoc-blue', 'bg-blue-50/80');
        }}
        onDrop={(event) => {
          if (!allowDragDrop) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.classList.remove('ring-2', 'ring-adnoc-blue', 'bg-blue-50/80');
          const draggedId = event.dataTransfer.getData('text/plain');
          if (draggedId && draggedId !== node.id) {
            void onMove(draggedId, node.id);
          }
        }}
        onDragEnd={(event) => {
          if (!allowDragDrop) {
            return;
          }
          event.currentTarget.classList.remove('opacity-40', 'scale-[0.98]');
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelectNode(node.id);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (allowEdit) {
            onEditNode(node.id);
          }
        }}
        className={clsx(
          'group relative flex cursor-pointer items-center rounded-lg px-2 py-2 transition-all',
          isSelected ? 'bg-blue-50/60 font-medium text-adnoc-blue shadow-sm' : 'text-slate-700 hover:bg-slate-50',
        )}
      >
        {isSelected && <div className="absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r-md bg-adnoc-blue" />}
        <div className="relative z-10 flex w-full items-center gap-2 pl-1">
          <div
            className={clsx(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded p-0.5 transition-colors',
              node.children.length > 0
                ? isSelected
                  ? 'cursor-pointer text-adnoc-blue hover:bg-blue-100'
                  : 'cursor-pointer text-slate-400 hover:bg-slate-200'
                : 'invisible',
            )}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>

          {renderNodeIcon ? renderNodeIcon(isSelected) : null}

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              title={node.name}
              className={clsx('truncate text-[15px] leading-5 tracking-tight', isSelected ? 'font-bold' : 'font-medium')}
            >
              {node.name}
            </span>
            {showNodeCodes && node.code && (
            <span
              title={node.code}
              className={clsx(
                   'hidden shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide sm:inline-flex',
                  isSelected ? 'bg-blue-100/50 text-blue-700' : 'bg-slate-100 text-slate-500',
                )}
              >
                {node.code}
              </span>
            )}
          </div>

          <div
            className={clsx(
              'absolute right-0 top-1/2 z-10 -translate-y-1/2 shrink-0 cursor-grab opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100',
              isSelected ? 'text-blue-400 hover:text-blue-600' : 'text-slate-300 hover:text-slate-500',
            )}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        </div>
      </div>

      {isExpanded && node.children.length > 0 && (
        <div className="relative mt-0.5 pl-6">
          <div className="absolute bottom-4 left-[13px] top-0 w-px bg-slate-200 transition-colors group-hover:bg-slate-300" />
          <div className="space-y-0.5">
            {node.children.map((child) => (
              <div key={child.id} className="relative">
                <div className="absolute left-[-13px] top-[17px] h-px w-[13px] bg-slate-200 transition-colors group-hover:bg-slate-300" />
                <DefinitionTreeNodeItem
                  node={child}
                  selectedId={selectedId}
                  showNodeCodes={showNodeCodes}
                renderNodeIcon={renderNodeIcon}
                onSelectNode={onSelectNode}
                onMove={onMove}
                onEditNode={onEditNode}
                allowDragDrop={allowDragDrop}
                allowEdit={allowEdit}
                forceExpanded={forceExpanded}
              />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeTreeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function filterTreeNodes(nodes: DefinitionTreeNode[], searchQuery: string): DefinitionTreeNode[] {
  return nodes.flatMap((node) => {
    const filteredChildren = filterTreeNodes(node.children, searchQuery);
    const selfMatches = normalizeTreeSearchValue(`${node.name} ${node.code ?? ''}`).includes(searchQuery);
    if (!selfMatches && filteredChildren.length === 0) {
      return [];
    }

    return [{ ...node, children: filteredChildren }];
  });
}

function findTreeNode(nodes: DefinitionTreeNode[], targetId: string): DefinitionTreeNode | null {
  for (const node of nodes) {
    if (node.id === targetId) {
      return node;
    }

    const childResult = findTreeNode(node.children, targetId);
    if (childResult) {
      return childResult;
    }
  }

  return null;
}

function TreeActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/80 px-3.5 py-3 text-left text-sm font-semibold text-slate-500 transition hover:border-adnoc-blue/40 hover:bg-blue-50/40 hover:text-adnoc-blue"
    >
      <Plus className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
