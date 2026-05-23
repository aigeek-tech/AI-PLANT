import React, { useState } from 'react';
import { X, FolderPlus } from 'lucide-react';
import type { PbsNode, PbsLevelTemplate } from '../../lib/api';
import {
  primaryButtonClass,
  secondaryButtonClass,
} from '../ui/buttonStyles';
import { SearchableSelect } from '../ui/SearchableSelect';

export interface PbsNodeFormData {
  code: string;
  name: string;
  description?: string;
  node_type: string;
  level_template_id?: string;
  status: 'active' | 'archived';
}

interface PbsNodeFormProps {
  /** When editing an existing node, pass it here */
  editingNode?: PbsNode | null;
  /** The parent node context (for display only) */
  parentNode?: PbsNode | null;
  /** PBS levels defined in standard for this project */
  pbsLevels?: PbsLevelTemplate[];
  onSubmit: (data: PbsNodeFormData) => void;
  onCancel: () => void;
}

interface PbsNodeFormState {
  code: string;
  name: string;
  description: string;
  nodeType: string;
  status: 'active' | 'archived';
}

function getInitialFormState(editingNode?: PbsNode | null, parentNode?: PbsNode | null): PbsNodeFormState {
  let defaultNodeType = 'folder';
  
  if (editingNode) {
    defaultNodeType = editingNode.node_type || 'folder';
  } else if (parentNode) {
    // Smart default based on parent's node_type for the static fallback types
    const parentType = parentNode.node_type;
    if (parentType === 'site') defaultNodeType = 'area';
    else if (parentType === 'area') defaultNodeType = 'unit';
    else if (parentType === 'unit') defaultNodeType = 'system';
    else if (parentType === 'system') defaultNodeType = 'folder';
  } else {
    // Root node default
    defaultNodeType = 'site';
  }

  return {
    code: editingNode?.code ?? '',
    name: editingNode?.name ?? '',
    description: editingNode?.description ?? '',
    nodeType: defaultNodeType,
    status: editingNode?.status ?? 'active',
  };
}

export function PbsNodeForm({ editingNode, parentNode, pbsLevels = [], onSubmit, onCancel }: PbsNodeFormProps) {
  const [form, setForm] = useState<PbsNodeFormState>(() => getInitialFormState(editingNode, parentNode));
  const { code, name, description, nodeType, status } = form;

  const isEditing = !!editingNode;
  
  // Enforce level hierarchy based on templates
  const targetLevelNo = parentNode ? (parentNode.level_no ?? 0) + 1 : 1;
  const allowedTemplate = !isEditing ? pbsLevels.find((l) => l.level_no === targetLevelNo) : undefined;
  const levelTemplateId = allowedTemplate?.id ?? editingNode?.level_template_id;
  
  const displayNodeType = allowedTemplate ? allowedTemplate.name : (editingNode?.level_name || nodeType);
  const submitNodeType = allowedTemplate ? allowedTemplate.code : nodeType;

  // Cannot create if it violates the strict level template hierarchy
  const isCreationBlocked = !isEditing && pbsLevels.length > 0 && !allowedTemplate;
  const canSubmit = code.trim() && name.trim() && !isCreationBlocked;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      node_type: submitNodeType,
      level_template_id: levelTemplateId,
      status,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-adnoc-blue/20 rounded-xl bg-gradient-to-b from-adnoc-blue/[0.04] to-white/80 shadow-sm backdrop-blur-sm overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FolderPlus className="h-4 w-4 text-adnoc-blue" />
          {isEditing ? '编辑节点' : parentNode ? '新增子节点' : '新增根节点'}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Parent context */}
      {parentNode && !isEditing && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-slate-100/80 px-3 py-1.5 text-xs text-slate-500">
          <span>父节点:</span>
          <span className="font-mono font-medium text-slate-700">{parentNode.code}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600">{parentNode.name}</span>
        </div>
      )}

      {/* Fields */}
      <div className="space-y-2.5 px-4 pb-3">
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              编码 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={code}
              onChange={(e) => setForm((current) => ({ ...current, code: e.target.value }))}
              placeholder="如 SITE-001"
              className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
              placeholder="如 某某站场"
              className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">节点层级 (类型)</label>
            {pbsLevels.length > 0 ? (
              <input
                type="text"
                readOnly
                value={displayNodeType}
                title="层级类型由标准规范严格控制"
                className="w-full rounded-lg border border-slate-200/80 px-3 py-1.5 text-sm shadow-sm bg-slate-50 text-slate-500 cursor-not-allowed"
              />
            ) : (
              <SearchableSelect
                value={nodeType}
                onChange={(nextValue) => setForm((current) => ({ ...current, nodeType: nextValue }))}
                className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-all focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
                options={[
                  { value: 'site', label: '站场 (Site)' },
                  { value: 'area', label: '区域 (Area)' },
                  { value: 'unit', label: '单元 (Unit)' },
                  { value: 'system', label: '系统 (System)' },
                  { value: 'folder', label: '通用节点' },
                ]}
                searchPlaceholder="搜索节点层级"
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">状态</label>
            <SearchableSelect
              value={status}
              onChange={(nextValue) => setForm((current) => ({ ...current, status: nextValue as 'active' | 'archived' }))}
              className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-all focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
              options={[
                { value: 'active', label: '启用' },
                { value: 'archived', label: '归档' },
              ]}
              searchPlaceholder="搜索状态"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">描述</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
            placeholder="可选，节点说明"
            className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
          />
        </div>

        {/* Actions */}
        {isCreationBlocked && (
          <div className="mx-4 mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 shadow-inner">
            该工程的 PBS 层级规范（最大 {Math.max(...pbsLevels.map(l => l.level_no))} 级）不允许在此节点下继续创建子节点。
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className={`${secondaryButtonClass} w-full flex-1 px-3 py-2`}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`${primaryButtonClass} w-full flex-1 px-3 py-2`}
          >
            {isEditing ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </form>
  );
}
