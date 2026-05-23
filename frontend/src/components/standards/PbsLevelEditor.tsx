import React, { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, Loader2, Layers } from 'lucide-react';
import { Card } from '../ui/Card';
import type { PbsLevelTemplate } from '../../lib/api';
import { createPbsLevel, updatePbsLevel, deletePbsLevel } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { useDialog } from '../ui/Dialog';

interface PbsLevelEditorProps {
  standardId: string;
  levels: PbsLevelTemplate[];
  onLevelsChange: (levels: PbsLevelTemplate[]) => void;
}

export function PbsLevelEditor({ standardId, levels, onLevelsChange }: PbsLevelEditorProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  
  // Draft for new or edited level
  const [draft, setDraft] = useState<{ code: string; name: string; description: string }>({
    code: '', name: '', description: ''
  });

  const { success, error } = useToast();
  const { confirm } = useDialog();

  const handleStartAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setDraft({ code: '', name: '', description: '' });
  };

  const handleStartEdit = (level: PbsLevelTemplate) => {
    setEditingId(level.id);
    setIsAdding(false);
    setDraft({ code: level.code, name: level.name, description: level.description || '' });
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!draft.code || !draft.name) {
      error('层级编码和名称不能为空');
      return;
    }

    try {
      if (isAdding) {
        setLoadingId('new');
        const nextLevelNo = levels.length > 0 ? Math.max(...levels.map(l => l.level_no)) + 1 : 1;
        const newLevel = await createPbsLevel(standardId, {
          level_no: nextLevelNo,
          code: draft.code,
          name: draft.name,
          description: draft.description || undefined
        });
        onLevelsChange([...levels, newLevel].sort((a, b) => a.level_no - b.level_no));
        success('添加成功');
      } else if (editingId) {
        setLoadingId(editingId);
        const updatedLevel = await updatePbsLevel(editingId, {
          code: draft.code,
          name: draft.name,
          description: draft.description || undefined
        });
        onLevelsChange(levels.map(l => l.id === editingId ? updatedLevel : l));
        success('更新成功');
      }
      handleCancel();
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (level: PbsLevelTemplate) => {
    // Only allow deleting the last level to keep sequence contiguous
    const maxLevelNo = Math.max(...levels.map(l => l.level_no));
    if (level.level_no !== maxLevelNo) {
      error('只能从最底层（最后一个层级）开始删除');
      return;
    }

    const accepted = await confirm({
      title: '删除 PBS 层级',
      description: `确定要删除层级 [Level ${level.level_no}: ${level.name}] 吗？`,
      confirmText: '删除',
      danger: true,
    });
    if (!accepted) return;

    setLoadingId(level.id);
    try {
      await deletePbsLevel(level.id);
      onLevelsChange(levels.filter(l => l.id !== level.id));
      success('删除成功');
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Card className="glass-card flex flex-col rounded-2xl p-6 mt-4">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-lg font-black tracking-tighter text-slate-900">PBS 层级规范 (PBS Levels)</h3>
          </div>
        </div>
        {!isAdding && !editingId && (
          <button
            onClick={handleStartAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-adnoc-blue/10 px-3 py-1.5 text-xs text-adnoc-blue font-bold hover:bg-adnoc-blue/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            添加层级 (Level {levels.length + 1})
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="w-20 px-4 py-3 text-xs font-semibold text-slate-500 text-center">级别</th>
              <th className="w-40 px-4 py-3 text-xs font-semibold text-slate-500">编码 (Code)</th>
              <th className="w-40 px-4 py-3 text-xs font-semibold text-slate-500">名称 (Name)</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500">说明 (Description)</th>
              <th className="w-32 px-4 py-3 text-xs font-semibold text-slate-500 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {levels.map((level) => {
              const isEditing = editingId === level.id;
              const isLoading = loadingId === level.id;
              const isDeletable = level.level_no === Math.max(...levels.map(l => l.level_no));

              if (isEditing) {
                return (
                  <tr key={level.id} className="bg-indigo-50/30">
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                        {level.level_no}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={draft.code}
                        onChange={e => setDraft({ ...draft, code: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                        placeholder="e.g. system"
                        className="w-full rounded border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        autoFocus
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={draft.name}
                        onChange={e => setDraft({ ...draft, name: e.target.value })}
                        placeholder="e.g. 系统"
                        className="w-full rounded border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={draft.description}
                        onChange={e => setDraft({ ...draft, description: e.target.value })}
                        placeholder="可选说明"
                        className="w-full rounded border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={handleSave} disabled={isLoading} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button onClick={handleCancel} disabled={isLoading} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={level.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 shadow-sm">
                      {level.level_no}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{level.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{level.name}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{level.description || <span className="opacity-40">-</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ opacity: 1 }}>
                      <button onClick={() => handleStartEdit(level)} disabled={!!editingId || isAdding} className="p-1.5 text-slate-400 hover:text-adnoc-blue hover:bg-adnoc-blue/10 rounded-md transition-colors disabled:opacity-30">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => handleDelete(level)} 
                        disabled={!!editingId || isAdding || !isDeletable || isLoading}
                        title={isDeletable ? "删除此层级" : "只能从最底层删除"}
                        className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                         {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {isAdding && (
              <tr className="bg-indigo-50/30">
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600 shadow-sm border border-indigo-200">
                    {levels.length + 1}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={draft.code}
                    onChange={e => setDraft({ ...draft, code: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                    placeholder="e.g. system"
                    className="w-full rounded border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    autoFocus
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={e => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. 系统"
                    className="w-full rounded border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={draft.description}
                    onChange={e => setDraft({ ...draft, description: e.target.value })}
                    placeholder="可选说明"
                    className="w-full rounded border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={handleSave} disabled={loadingId === 'new'} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                      {loadingId === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button onClick={handleCancel} disabled={loadingId === 'new'} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {levels.length === 0 && !isAdding && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                      <Layers className="h-5 w-5 text-slate-400" />
                    </div>
                    <p className="text-sm font-medium">尚未定义 PBS 层级模板</p>
                    <p className="text-xs opacity-70">点击上方按钮添加第一级（如：机组、区域、站场等）</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
