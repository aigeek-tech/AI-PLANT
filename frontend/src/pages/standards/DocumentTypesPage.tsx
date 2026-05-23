import React, { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, FileText, Globe2, GripVertical, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import {
  createDocumentType,
  createDocumentTypeAttribute,
  deleteDocumentTypeAttribute,
  getCommonDocumentTypeAttributes,
  getDocumentTypeDetail,
  getDocumentTypes,
  getStandards,
  reorderDocumentTypeAttributes,
  reorderCommonDocumentTypeAttributes,
  updateDocumentType,
  updateDocumentTypeAttribute,
  type AttributeValueType,
  type DocumentType,
  type DocumentTypeAttribute,
  type DocumentTypeDetail,
  type Standard,
} from '../../lib/api';
import { primaryButtonClass, secondaryButtonClass } from '../../components/ui/buttonStyles';
import { useDialog } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';
import { DefinitionField, DefinitionModal, definitionInputClass } from '../../components/standards/DefinitionModal';
import { DefinitionTree } from '../../components/standards/DefinitionTree';
import { getValueTypeLabel } from '../../lib/standardLocalization';
import { SearchableSelect } from '../../components/ui/SearchableSelect';

const COMMON_SCOPE = '__common__';
const VALUE_TYPES: AttributeValueType[] = ['string', 'number', 'integer', 'boolean', 'date', 'enum', 'json'];
const ATTRIBUTE_PAGE_SIZE = 20;
const NEW_ATTRIBUTE_ID = '__new_document_attribute__';

type TreeType = DocumentType & { children: TreeType[] };
type SelectedScope = typeof COMMON_SCOPE | string;

interface TypeDraft {
  id?: string;
  code: string;
  name: string;
  parent_id: string;
  description: string;
  allowed_extensions: string;
  status: 'active' | 'archived';
}

interface AttributeDraft {
  id?: string;
  code: string;
  name: string;
  group_name: string;
  value_type: AttributeValueType;
  is_required: boolean;
  unit_family: string;
  enum_options: string;
  description: string;
  status: 'active' | 'archived';
}

function splitCommaText(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function typeToDraft(type?: DocumentType, parentId?: string | null): TypeDraft {
  return {
    id: type?.id,
    code: type?.code ?? '',
    name: type?.name ?? '',
    parent_id: parentId ?? type?.parent_id ?? '',
    description: type?.description ?? '',
    allowed_extensions: (type?.allowed_extensions ?? []).join(', '),
    status: type?.status ?? 'active',
  };
}

function attributeToDraft(attribute?: DocumentTypeAttribute): AttributeDraft {
  return {
    id: attribute?.id,
    code: attribute?.code ?? '',
    name: attribute?.name ?? '',
    group_name: attribute?.group_name ?? '',
    value_type: attribute?.value_type ?? 'string',
    is_required: attribute?.is_required ?? false,
    unit_family: attribute?.unit_family ?? '',
    enum_options: (attribute?.enum_options ?? []).join(', '),
    description: attribute?.description ?? '',
    status: attribute?.status ?? 'active',
  };
}

function buildTypeTree(types: DocumentType[]) {
  const nodes = new Map<string, TreeType>();
  types.forEach((type) => nodes.set(type.id, { ...type, children: [] }));
  const roots: TreeType[] = [];
  types.forEach((type) => {
    const node = nodes.get(type.id)!;
    if (type.parent_id && nodes.has(type.parent_id)) {
      nodes.get(type.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortNodes = (items: TreeType[]) => {
    items.sort((left, right) => left.code.localeCompare(right.code, 'zh-CN'));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

function isDescendant(types: DocumentType[], draggedId: string, maybeParentId: string) {
  let currentId: string | null = maybeParentId;
  while (currentId) {
    if (currentId === draggedId) return true;
    currentId = types.find((type) => type.id === currentId)?.parent_id ?? null;
  }
  return false;
}

interface DocumentTypesPageProps {
  standardId?: string;
  embedded?: boolean;
}

export function DocumentTypesPage({ standardId: fixedStandardId, embedded = false }: DocumentTypesPageProps = {}) {
  const [standards, setStandards] = useState<Standard[]>([]);
  const [selectedStandardId, setSelectedStandardId] = useState<string>(fixedStandardId ?? '');
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [commonAttributes, setCommonAttributes] = useState<DocumentTypeAttribute[]>([]);
  const [selectedScope, setSelectedScope] = useState<SelectedScope>(COMMON_SCOPE);
  const [selectedType, setSelectedType] = useState<DocumentTypeDetail | null>(null);
  const [, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null);
  const [attributeDraft, setAttributeDraft] = useState<AttributeDraft | null>(null);
  const [attributePage, setAttributePage] = useState(1);
  const [editingAttributeId, setEditingAttributeId] = useState<string | null>(null);
  const [isSavingAttribute, setIsSavingAttribute] = useState(false);
  const [deletingAttributeId, setDeletingAttributeId] = useState<string | null>(null);
  const [draggingAttributeId, setDraggingAttributeId] = useState<string | null>(null);
  const [dragOverAttributeId, setDragOverAttributeId] = useState<string | null>(null);
  const { success, error: showError } = useToast();
  const { confirm } = useDialog();

  const tree = useMemo(() => buildTypeTree(types), [types]);
  const isCommonSelected = selectedScope === COMMON_SCOPE;
  const orderedAttributes = useMemo(
    () => [...(isCommonSelected ? commonAttributes : selectedType?.attributes ?? [])].sort((left, right) => {
      const sortOrderDifference = left.sort_order - right.sort_order;
      return sortOrderDifference === 0 ? left.code.localeCompare(right.code, 'zh-CN') : sortOrderDifference;
    }),
    [commonAttributes, isCommonSelected, selectedType?.attributes],
  );
  const attributeTotalPages = Math.max(1, Math.ceil(orderedAttributes.length / ATTRIBUTE_PAGE_SIZE));
  const pagedAttributes = orderedAttributes.slice((attributePage - 1) * ATTRIBUTE_PAGE_SIZE, attributePage * ATTRIBUTE_PAGE_SIZE);
  const attributeStart = orderedAttributes.length > 0 ? (attributePage - 1) * ATTRIBUTE_PAGE_SIZE + 1 : 0;
  const attributeEnd = Math.min(orderedAttributes.length, attributePage * ATTRIBUTE_PAGE_SIZE);
  const attributeRangeLabel = orderedAttributes.length > 0
    ? `显示第 ${attributeStart}-${attributeEnd} 条，共 ${orderedAttributes.length} 条`
    : '暂无属性';
  const parentCandidates = types.filter((type) => !typeDraft?.id || (type.id !== typeDraft.id && !isDescendant(types, typeDraft.id, type.id)));
  const currentScopeTitle = isCommonSelected ? '公共属性' : (selectedType?.name ?? '文档类型');
  const currentScopeDescription = isCommonSelected
    ? '适用于该标准下所有文档类型的全局共用属性'
    : (selectedType?.description ?? null);

  const loadCommonAttributes = useCallback(async (standardId: string) => {
    setCommonAttributes(await getCommonDocumentTypeAttributes(standardId));
  }, []);

  const loadTypes = useCallback(async (nextSelectedScope?: SelectedScope) => {
    if (!selectedStandardId) return;
    setIsLoading(true);
    try {
      const [nextTypes] = await Promise.all([
        getDocumentTypes(selectedStandardId),
        loadCommonAttributes(selectedStandardId),
      ]);
      setTypes(nextTypes);
      setSelectedScope(nextSelectedScope ?? COMMON_SCOPE);
    } catch (loadError) {
      showError(loadError instanceof Error ? loadError.message : '加载文档类型失败');
    } finally {
      setIsLoading(false);
    }
  }, [loadCommonAttributes, selectedStandardId, showError]);

  const loadDetail = useCallback(async (typeId: string) => {
    setIsDetailLoading(true);
    try {
      setSelectedType(await getDocumentTypeDetail(typeId));
    } catch (loadError) {
      showError(loadError instanceof Error ? loadError.message : '加载文档类型详情失败');
      setSelectedType(null);
    } finally {
      setIsDetailLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (fixedStandardId) {
      setSelectedStandardId(fixedStandardId);
      setSelectedScope(COMMON_SCOPE);
      return;
    }

    getStandards()
      .then((data) => {
        setStandards(data);
        if (data[0]?.id) {
          setSelectedStandardId(data[0].id);
        }
      })
      .catch((error) => showError(error instanceof Error ? error.message : '加载标准列表失败'));
  }, [fixedStandardId, showError]);

  useEffect(() => {
    if (selectedStandardId) {
      void loadTypes(COMMON_SCOPE);
    }
  }, [loadTypes, selectedStandardId]);

  useEffect(() => {
    setAttributePage(1);
    setEditingAttributeId(null);
    setAttributeDraft(null);
    setDeletingAttributeId(null);
    setDraggingAttributeId(null);
    setDragOverAttributeId(null);
    if (selectedScope === COMMON_SCOPE) {
      setSelectedType(null);
      return;
    }
    void loadDetail(selectedScope);
  }, [loadDetail, selectedScope]);

  function startCreatingType(parentId: string | null = null) {
    setTypeDraft(typeToDraft(undefined, parentId));
  }

  function startEditingType(typeId: string) {
    const targetType = types.find((type) => type.id === typeId);
    if (!targetType) {
      return;
    }
    setTypeDraft(typeToDraft(targetType));
  }

  async function handleMoveType(draggedId: string, targetId: string | null) {
    if (!selectedStandardId || draggedId === targetId) {
      return;
    }

    const draggedType = types.find((type) => type.id === draggedId);
    if (!draggedType || draggedType.parent_id === targetId) {
      return;
    }

    if (targetId && isDescendant(types, draggedId, targetId)) {
      showError('不能把类型拖到自己的子节点下。');
      return;
    }

    try {
      await updateDocumentType(draggedId, {
        standard_id: selectedStandardId,
        code: draggedType.code,
        name: draggedType.name,
        parent_id: targetId,
        description: draggedType.description,
        status: draggedType.status,
        allowed_extensions: draggedType.allowed_extensions,
        metadata: draggedType.metadata,
      });
      await loadTypes(selectedScope);
    } catch (moveError) {
      showError(moveError instanceof Error ? moveError.message : '保存类型移动失败');
    }
  }

  async function handleSaveType(event: React.FormEvent) {
    event.preventDefault();
    if (!typeDraft) return;

    const payload = {
      standard_id: selectedStandardId,
      code: typeDraft.code.trim(),
      name: typeDraft.name.trim(),
      parent_id: typeDraft.parent_id || null,
      description: typeDraft.description.trim() || null,
      allowed_extensions: splitCommaText(typeDraft.allowed_extensions),
      status: typeDraft.status,
      metadata: {},
    };

    try {
      const savedType = typeDraft.id
        ? await updateDocumentType(typeDraft.id, payload)
        : await createDocumentType(payload);
      setTypeDraft(null);
      success(typeDraft.id ? '文档类型已更新' : '文档类型已创建');
      await loadTypes(savedType.id);
      await loadDetail(savedType.id);
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : '保存文档类型失败');
    }
  }

  function startCreatingAttribute() {
    setEditingAttributeId(NEW_ATTRIBUTE_ID);
    setAttributeDraft(attributeToDraft());
    setAttributePage(attributeTotalPages);
  }

  function startEditingAttribute(attribute: DocumentTypeAttribute) {
    setEditingAttributeId(attribute.id);
    setAttributeDraft(attributeToDraft(attribute));
  }

  function updateAttributeDraft<TField extends keyof AttributeDraft>(field: TField, value: AttributeDraft[TField]) {
    setAttributeDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function cancelEditingAttribute() {
    setEditingAttributeId(null);
    setAttributeDraft(null);
  }

  async function saveAttribute() {
    if (!attributeDraft || !selectedStandardId || !editingAttributeId) return;

    const ownerTypeId = isCommonSelected ? null : selectedScope;
    const payload = {
      standard_id: selectedStandardId,
      code: attributeDraft.code.trim(),
      name: attributeDraft.name.trim(),
      group_name: attributeDraft.group_name.trim() || null,
      value_type: attributeDraft.value_type,
      is_required: attributeDraft.is_required,
      unit_family: attributeDraft.unit_family.trim() || null,
      enum_options: attributeDraft.value_type === 'enum' ? splitCommaText(attributeDraft.enum_options) : [],
      description: attributeDraft.description.trim() || null,
      status: attributeDraft.status,
    };

    if (!payload.code || !payload.name) {
      showError('属性编码和名称不能为空。');
      return;
    }

    const normalizedCode = payload.code.toLowerCase();
    const hasDuplicateCode = orderedAttributes.some((attribute) => (
      attribute.code.toLowerCase() === normalizedCode && attribute.id !== editingAttributeId
    ));

    if (hasDuplicateCode) {
      showError('当前作用域下已存在相同的属性编码。');
      return;
    }

    setIsSavingAttribute(true);
    try {
      let savedAttribute: DocumentTypeAttribute;
      if (editingAttributeId === NEW_ATTRIBUTE_ID) {
        savedAttribute = await createDocumentTypeAttribute(ownerTypeId, payload);
        success(isCommonSelected ? '公共属性已创建' : '类型属性已创建');
      } else {
        savedAttribute = await updateDocumentTypeAttribute(editingAttributeId, payload);
        success('属性已更新');
      }

      await loadCommonAttributes(selectedStandardId);
      if (!isCommonSelected) {
        await loadDetail(selectedScope);
      }
      await loadTypes(selectedScope);
      const nextIndex = Math.max(orderedAttributes.findIndex((attribute) => attribute.id === savedAttribute.id), orderedAttributes.length);
      setAttributePage(Math.floor(Math.max(nextIndex, 0) / ATTRIBUTE_PAGE_SIZE) + 1);
      cancelEditingAttribute();
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : '保存属性失败');
    } finally {
      setIsSavingAttribute(false);
    }
  }

  async function handleDeleteAttribute(attribute: DocumentTypeAttribute) {
    const accepted = await confirm({
      title: '删除文档属性',
      description: `确认删除属性 ${attribute.name}？已有图纸的属性值不会被自动删除。`,
      confirmText: '删除',
      danger: true,
    });
    if (!accepted) return;

    setDeletingAttributeId(attribute.id);
    try {
      await deleteDocumentTypeAttribute(attribute.id);
      success('属性已删除');
      if (selectedStandardId) {
        await loadCommonAttributes(selectedStandardId);
      }
      if (!isCommonSelected) {
        await loadDetail(selectedScope);
      }
      await loadTypes(selectedScope);
    } catch (deleteError) {
      showError(deleteError instanceof Error ? deleteError.message : '删除属性失败');
    } finally {
      setDeletingAttributeId(null);
    }
  }

  async function handleReorderAttribute(draggedId: string, targetId: string, position: 'before' | 'after') {
    if (isCommonSelected || editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null) {
      return;
    }

    const draggedAttribute = orderedAttributes.find((attribute) => attribute.id === draggedId);
    if (!draggedAttribute || draggedId === targetId) {
      return;
    }

    const attributesWithoutDragged = orderedAttributes.filter((attribute) => attribute.id !== draggedId);
    const targetIndex = attributesWithoutDragged.findIndex((attribute) => attribute.id === targetId);
    if (targetIndex < 0) {
      return;
    }

    const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    const nextAttributes = [
      ...attributesWithoutDragged.slice(0, insertIndex),
      draggedAttribute,
      ...attributesWithoutDragged.slice(insertIndex),
    ];

    try {
      if (selectedScope === COMMON_SCOPE) {
        await reorderCommonDocumentTypeAttributes(selectedStandardId, nextAttributes.map((attribute) => attribute.id));
        await loadCommonAttributes(selectedStandardId);
      } else {
        await reorderDocumentTypeAttributes(selectedScope, nextAttributes.map((attribute) => attribute.id));
        await loadDetail(selectedScope);
      }
      await loadTypes(selectedScope);
    } catch (reorderError) {
      showError(reorderError instanceof Error ? reorderError.message : '保存属性排序失败');
    } finally {
      setDraggingAttributeId(null);
      setDragOverAttributeId(null);
    }
  }

  return (
    <div className={clsx('flex h-full flex-col', embedded ? 'min-h-0 w-full gap-4 animate-fade-in' : '')}>
      {!embedded && (
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">文档类型配置</h1>
            <p className="mt-1 text-sm text-slate-500">当前标准下的文档类型树、公共属性和类型专属属性。</p>
          </div>
          <div className="flex items-center gap-3">
            {!fixedStandardId && (
              <SearchableSelect
                value={selectedStandardId}
                onChange={(nextValue) => {
                  setSelectedStandardId(nextValue);
                  setSelectedScope(COMMON_SCOPE);
                }}
                className={definitionInputClass}
                placeholder="选择标准"
                clearable
                options={standards.map((standard) => ({
                  value: standard.id,
                  label: `${standard.code} - ${standard.name}`,
                }))}
                searchPlaceholder="搜索标准编码或名称"
              />
            )}
            <button type="button" onClick={() => startCreatingType(null)} disabled={!selectedStandardId} className={primaryButtonClass}>
              <Plus className="h-4 w-4" />
              新建类型
            </button>
          </div>
        </div>
      )}

      <div className={clsx('grid min-h-0 flex-1 gap-4', embedded ? 'grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]' : 'grid-cols-[340px_1fr]')}>
        <DefinitionTree
          title="文档类型定义"
          titleIcon={<FileText className="h-5 w-5 text-slate-300" />}
          commonLabel="公共属性"
          commonSelected={isCommonSelected}
          selectedId={isCommonSelected ? null : selectedScope}
          nodes={tree}
          rootActionLabel="新增根类型"
          childActionLabel="子级别"
          searchPlaceholder="搜索文档类型编码或名称"
          renderNodeIcon={() => <FileText className="h-4 w-4 shrink-0" />}
          onSelectCommon={() => setSelectedScope(COMMON_SCOPE)}
          onSelectNode={setSelectedScope}
          onMove={handleMoveType}
          onAddRoot={() => startCreatingType(null)}
          onAddChild={startCreatingType}
          onEditNode={startEditingType}
        />

        {embedded ? (
          <div className="min-h-[420px] xl:min-h-0">
            {isDetailLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-adnoc-blue" />
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-4 animate-fade-in">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-2">
                  <div className="min-w-0 space-y-1">
                    <h2 className="truncate text-2xl font-black tracking-tight text-slate-900">{currentScopeTitle}</h2>
                    {currentScopeDescription && <p className="text-sm text-slate-500">{currentScopeDescription}</p>}
                    {!isCommonSelected && selectedType && (
                      <div className="flex flex-wrap items-center gap-2 text-xs font-bold tracking-normal text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">{selectedType.code}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">层级 {selectedType.level_no}</span>
                        {selectedType.allowed_extensions.map((extension) => (
                          <span key={extension} className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">
                            .{extension}
                          </span>
                        ))}
                        {selectedType.allowed_extensions.length === 0 && (
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">未限制扩展名</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isCommonSelected && selectedType && (
                      <button type="button" onClick={() => startEditingType(selectedType.id)} className={secondaryButtonClass}>
                        <Pencil className="h-4 w-4" />
                        编辑类型
                      </button>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold tracking-wide text-slate-500">
                      <span className="text-slate-700">属性清单</span>
                      <span>{attributeRangeLabel}</span>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/60 bg-white p-0 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-900/5">
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
                    <div className="text-xs font-bold tracking-wide text-slate-500">
                      当前页 {attributePage} / {attributeTotalPages}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={startCreatingAttribute}
                        disabled={editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-adnoc-blue px-3 py-1.5 text-xs font-bold text-white shadow-sm shadow-adnoc-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        新增属性
                      </button>
                      <button
                        type="button"
                        onClick={() => setAttributePage((current) => Math.max(1, current - 1))}
                        disabled={attributePage <= 1}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-adnoc-blue hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        上一页
                      </button>
                      <button
                        type="button"
                        onClick={() => setAttributePage((current) => Math.min(attributeTotalPages, current + 1))}
                        disabled={attributePage >= attributeTotalPages}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-adnoc-blue hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        下一页
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <AttributeTable
                      attributes={pagedAttributes}
                      editingAttributeId={editingAttributeId}
                      attributeDraft={attributeDraft}
                      isSavingAttribute={isSavingAttribute}
                      deletingAttributeId={deletingAttributeId}
                      draggingAttributeId={draggingAttributeId}
                      dragOverAttributeId={dragOverAttributeId}
                      canReorder={!isCommonSelected}
                      onDragStateChange={(draggingId, overId) => {
                        setDraggingAttributeId(draggingId);
                        setDragOverAttributeId(overId);
                      }}
                      onReorder={handleReorderAttribute}
                      onEdit={startEditingAttribute}
                      onDelete={handleDeleteAttribute}
                      onDraftChange={updateAttributeDraft}
                      onDraftSave={() => void saveAttribute()}
                      onDraftCancel={cancelEditingAttribute}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <section className="min-h-0 overflow-hidden rounded-3xl border border-white/50 bg-white/70 shadow-xl shadow-slate-200/50 backdrop-blur-xl">
            {isDetailLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-adnoc-blue" />
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="border-b border-slate-100 px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-adnoc-blue/10 p-3 text-adnoc-blue">
                          {isCommonSelected ? <Globe2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-slate-900">{isCommonSelected ? '文档公共属性' : selectedType?.name}</h2>
                          <p className="font-mono text-xs text-slate-400">{isCommonSelected ? 'COMMON' : selectedType?.code}</p>
                        </div>
                      </div>
                      {!isCommonSelected && selectedType?.description && (
                        <p className="mt-3 text-sm text-slate-500">{selectedType.description}</p>
                      )}
                      {!isCommonSelected && selectedType && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                            层级 {selectedType.level_no}
                          </span>
                          {selectedType.allowed_extensions.length > 0 ? selectedType.allowed_extensions.map((extension) => (
                            <span key={extension} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                              .{extension}
                            </span>
                          )) : <span className="text-xs text-slate-400">未限制扩展名</span>}
                        </div>
                      )}
                    </div>
                    {!isCommonSelected && selectedType && (
                      <button type="button" onClick={() => startEditingType(selectedType.id)} className={secondaryButtonClass}>
                        <Pencil className="h-4 w-4" />
                        编辑类型
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900">{isCommonSelected ? '公共属性模板' : '类型专属属性'}</h3>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold tracking-wide text-slate-500">
                      <span className="text-slate-700">属性清单</span>
                      <span>{attributeRangeLabel}</span>
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/60 bg-white p-0 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-900/5">
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
                      <div className="text-xs font-bold tracking-wide text-slate-500">
                        当前页 {attributePage} / {attributeTotalPages}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={startCreatingAttribute}
                          disabled={editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-adnoc-blue px-3 py-1.5 text-xs font-bold text-white shadow-sm shadow-adnoc-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          新增属性
                        </button>
                        <button
                          type="button"
                          onClick={() => setAttributePage((current) => Math.max(1, current - 1))}
                          disabled={attributePage <= 1}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-adnoc-blue hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                          上一页
                        </button>
                        <button
                          type="button"
                          onClick={() => setAttributePage((current) => Math.min(attributeTotalPages, current + 1))}
                          disabled={attributePage >= attributeTotalPages}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-adnoc-blue hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          下一页
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <AttributeTable
                        attributes={pagedAttributes}
                        editingAttributeId={editingAttributeId}
                        attributeDraft={attributeDraft}
                        isSavingAttribute={isSavingAttribute}
                        deletingAttributeId={deletingAttributeId}
                        draggingAttributeId={draggingAttributeId}
                        dragOverAttributeId={dragOverAttributeId}
                        canReorder={!isCommonSelected}
                        onDragStateChange={(draggingId, overId) => {
                          setDraggingAttributeId(draggingId);
                          setDragOverAttributeId(overId);
                        }}
                        onReorder={handleReorderAttribute}
                        onEdit={startEditingAttribute}
                        onDelete={handleDeleteAttribute}
                        onDraftChange={updateAttributeDraft}
                        onDraftSave={() => void saveAttribute()}
                        onDraftCancel={cancelEditingAttribute}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {typeDraft && (
        <TypeModal
          draft={typeDraft}
          parentCandidates={parentCandidates}
          onChange={setTypeDraft}
          onSubmit={handleSaveType}
          onClose={() => setTypeDraft(null)}
        />
      )}
    </div>
  );
}

function AttributeTable({
  attributes,
  editingAttributeId,
  attributeDraft,
  isSavingAttribute,
  deletingAttributeId,
  draggingAttributeId,
  dragOverAttributeId,
  canReorder,
  onDragStateChange,
  onReorder,
  onEdit,
  onDelete,
  onDraftChange,
  onDraftSave,
  onDraftCancel,
}: {
  attributes: DocumentTypeAttribute[];
  editingAttributeId: string | null;
  attributeDraft: AttributeDraft | null;
  isSavingAttribute: boolean;
  deletingAttributeId: string | null;
  draggingAttributeId: string | null;
  dragOverAttributeId: string | null;
  canReorder: boolean;
  onDragStateChange: (draggingId: string | null, overId: string | null) => void;
  onReorder: (draggedId: string, targetId: string, position: 'before' | 'after') => void | Promise<void>;
  onEdit: (attribute: DocumentTypeAttribute) => void;
  onDelete: (attribute: DocumentTypeAttribute) => void | Promise<void>;
  onDraftChange: <TField extends keyof AttributeDraft>(field: TField, value: AttributeDraft[TField]) => void;
  onDraftSave: () => void;
  onDraftCancel: () => void;
}) {
  if (attributes.length === 0 && !(editingAttributeId === NEW_ATTRIBUTE_ID && attributeDraft)) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center space-y-3 text-center text-slate-400">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-100 bg-slate-50 shadow-inner">
          <span className="text-xl opacity-30">-</span>
        </div>
        <span className="text-sm font-semibold">暂无属性定义</span>
        <span className="max-w-[240px] text-xs opacity-60">当前分类下还没有配置属性，点击右上角“新增属性”即可补充。</span>
      </div>
    );
  }

  return (
    <div className="relative max-h-[calc(100vh-20rem)] overflow-x-auto overflow-y-auto xl:min-h-0 xl:max-h-none xl:flex-1">
      <table className="min-w-[1020px] w-full table-fixed border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/90 shadow-sm backdrop-blur-md">
          <tr>
            <th className="w-[130px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">分组</th>
            <th className="w-[170px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">属性编码</th>
            <th className="w-[180px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">属性名称</th>
            <th className="w-[160px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">数据类型</th>
            <th className="w-[120px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">是否必填</th>
            <th className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">说明</th>
            <th className="w-[180px] border-b border-slate-200 px-4 py-2.5 text-right text-xs font-semibold tracking-wide text-slate-600">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {attributes.map((attribute) => (
            editingAttributeId === attribute.id && attributeDraft ? (
              <AttributeEditorRow
                key={attribute.id}
                draft={attributeDraft}
                title={`编辑属性 / ${attribute.name}`}
                description="调整编码、类型、必填规则和说明，不会再挤压表格列宽。"
                isSaving={isSavingAttribute}
                onChange={onDraftChange}
                onSave={onDraftSave}
                onCancel={onDraftCancel}
              />
            ) : (
            <tr
              key={attribute.id}
              onDragOver={(event) => {
                if (!canReorder || !draggingAttributeId || draggingAttributeId === attribute.id || editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                onDragStateChange(draggingAttributeId, attribute.id);
              }}
              onDragLeave={(event) => {
                const relatedTarget = event.relatedTarget;
                if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                  onDragStateChange(draggingAttributeId, null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData('text/plain');
                const rowRect = event.currentTarget.getBoundingClientRect();
                const dropPosition = event.clientY > rowRect.top + rowRect.height / 2 ? 'after' : 'before';
                if (draggedId) {
                  void onReorder(draggedId, attribute.id, dropPosition);
                }
              }}
              className={clsx(
                'group align-top transition-colors hover:bg-slate-50/80',
                draggingAttributeId === attribute.id && 'opacity-50',
                dragOverAttributeId === attribute.id && draggingAttributeId !== attribute.id && 'bg-blue-50/80 ring-1 ring-inset ring-adnoc-blue/30',
              )}
            >
              <td className="px-3 py-3 text-center">
                <span
                  draggable={canReorder && editingAttributeId === null && !isSavingAttribute && deletingAttributeId === null}
                  onDragStart={(event) => {
                    if (!canReorder || editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.setData('text/plain', attribute.id);
                    event.dataTransfer.effectAllowed = 'move';
                    onDragStateChange(attribute.id, null);
                  }}
                  onDragEnd={() => onDragStateChange(null, null)}
                  title="拖拽调整排序"
                  className={clsx(
                    'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-300 transition-colors',
                    editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null
                      ? 'cursor-not-allowed opacity-30'
                      : 'cursor-grab hover:border-adnoc-blue hover:text-adnoc-blue active:cursor-grabbing',
                  )}
                >
                  <GripVertical className="h-4 w-4" />
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-[13px] font-semibold text-slate-600">
                <span className="select-all rounded border border-slate-200/80 bg-slate-100/50 px-2 py-1">{attribute.code}</span>
              </td>
              <td className="px-4 py-3 text-[15px] font-semibold text-slate-800">
                <div className="line-clamp-2">{attribute.name}</div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded border border-indigo-100/50 bg-indigo-50 px-2.5 py-1 text-[13px] font-bold tracking-normal text-indigo-700 shadow-sm">
                    {getValueTypeLabel(attribute.value_type)}
                  </span>
                  {attribute.enum_options?.length > 0 && (
                    <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                      含枚举选项
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                {attribute.is_required ? (
                  <span className="inline-flex items-center rounded-full border border-rose-200/60 bg-rose-50 px-2.5 py-1 text-xs font-bold tracking-normal text-rose-600 shadow-sm">
                    必填
                  </span>
                ) : (
                  <span className="rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 text-xs font-medium tracking-normal text-slate-500">
                    选填
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="space-y-2">
                  <p className="line-clamp-2 text-sm leading-6 text-slate-600">
                    {attribute.description || <span className="italic opacity-50">暂无说明。</span>}
                  </p>
                  {(attribute.unit_family || attribute.enum_options.length > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {attribute.unit_family && (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold tracking-normal text-slate-600">
                          {attribute.unit_family}
                        </span>
                      )}
                      {attribute.enum_options.slice(0, 3).map((item) => (
                        <span key={String(item)} className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                          {String(item)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(attribute)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:border-adnoc-blue hover:text-adnoc-blue"
                  >
                    <Pencil className="h-4 w-4" />
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(attribute)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:border-rose-400 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </button>
                </div>
              </td>
            </tr>
            )
          ))}
          {editingAttributeId === NEW_ATTRIBUTE_ID && attributeDraft && (
            <AttributeEditorRow
              draft={attributeDraft}
              title="新增属性"
              description="为当前类别补充一个新的属性定义，保存后默认排在末尾。"
              isSaving={isSavingAttribute}
              onChange={onDraftChange}
              onSave={onDraftSave}
              onCancel={onDraftCancel}
            />
          )}
        </tbody>
      </table>
    </div>
  );
}

function AttributeEditorRow({
  draft,
  title,
  description,
  isSaving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: AttributeDraft;
  title: string;
  description: string;
  isSaving: boolean;
  onChange: <TField extends keyof AttributeDraft>(field: TField, value: AttributeDraft[TField]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <tr className="bg-blue-50/30">
      <td colSpan={7} className="px-4 py-4">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-blue-50/60 to-slate-50 p-4 shadow-sm shadow-blue-500/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-bold tracking-wide text-adnoc-blue/70">{title}</p>
              <p className="text-sm text-slate-500">{description}</p>
            </div>
            <div className="inline-flex items-center gap-2">
              <button
                onClick={onSave}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-adnoc-blue px-3 py-2 text-xs font-bold text-white shadow-sm shadow-adnoc-blue/20 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                保存
              </button>
              <button
                onClick={onCancel}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                取消
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_180px_140px]">
            <label className="space-y-1.5">
              <span className="text-xs font-bold tracking-wide text-slate-600">属性编码</span>
              <input
                value={draft.code}
                onChange={(event) => onChange('code', event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/20"
                placeholder="例如 drawing_no"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold tracking-wide text-slate-600">属性名称</span>
              <input
                value={draft.name}
                onChange={(event) => onChange('name', event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/20"
                placeholder="例如 图纸编号"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold tracking-wide text-slate-600">数据类型</span>
              <SearchableSelect
                value={draft.value_type}
                onChange={(nextValue) => onChange('value_type', nextValue as AttributeValueType)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold tracking-normal focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/20"
                options={VALUE_TYPES.map((valueType) => ({
                  value: valueType,
                  label: getValueTypeLabel(valueType),
                }))}
                searchPlaceholder="搜索数据类型"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold tracking-wide text-slate-600">填写规则</span>
              <span className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={draft.is_required}
                  onChange={(event) => onChange('is_required', event.target.checked)}
                  className="h-4 w-4 accent-adnoc-blue"
                />
                必填属性
              </span>
            </label>
            <label className="space-y-1.5 md:col-span-2 xl:col-span-4">
              <span className="text-xs font-bold tracking-wide text-slate-600">属性说明</span>
              <textarea
                value={draft.description}
                onChange={(event) => onChange('description', event.target.value)}
                className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/20"
                placeholder="描述该属性的业务含义、约束或填写要求。"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold tracking-wide text-slate-600">单位族</span>
              <input
                value={draft.unit_family}
                onChange={(event) => onChange('unit_family', event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/20"
                placeholder="例如 length / area"
              />
            </label>
            <label className="space-y-1.5 md:col-span-2 xl:col-span-3">
              <span className="text-xs font-bold tracking-wide text-slate-600">枚举值</span>
              <input
                value={draft.enum_options}
                onChange={(event) => onChange('enum_options', event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/20 disabled:bg-slate-50 disabled:text-slate-300"
                placeholder={draft.value_type === 'enum' ? '多个值用逗号分隔' : '仅枚举类型可填写'}
                disabled={draft.value_type !== 'enum'}
              />
            </label>
          </div>
        </div>
      </td>
    </tr>
  );
}

function TypeModal({
  draft,
  parentCandidates,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: TypeDraft;
  parentCandidates: DocumentType[];
  onChange: (next: TypeDraft) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <DefinitionModal
      title={draft.id ? '编辑文档类型' : '新建文档类型'}
      onSubmit={onSubmit}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>取消</button>
          <button type="submit" className={primaryButtonClass}>保存</button>
        </>
      }
    >
      <DefinitionField label="编码" required>
        <input value={draft.code} onChange={(event) => onChange({ ...draft, code: event.target.value })} required className={definitionInputClass} />
      </DefinitionField>
      <DefinitionField label="名称" required>
        <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} required className={definitionInputClass} />
      </DefinitionField>
      <DefinitionField label="上级类型">
        <SearchableSelect
          value={draft.parent_id}
          onChange={(nextValue) => onChange({ ...draft, parent_id: nextValue })}
          className={definitionInputClass}
          placeholder="根类型"
          clearable
          options={parentCandidates.map((type) => ({
            value: type.id,
            label: `${'　'.repeat(Math.max(0, type.level_no - 1))}${type.code} - ${type.name}`,
          }))}
          searchPlaceholder="搜索上级类型"
        />
      </DefinitionField>
      <DefinitionField label="描述">
        <textarea value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} rows={3} className={definitionInputClass} />
      </DefinitionField>
      <DefinitionField label="允许扩展名">
        <input
          value={draft.allowed_extensions}
          onChange={(event) => onChange({ ...draft, allowed_extensions: event.target.value })}
          placeholder="pdf, dwg, xlsx"
          className={definitionInputClass}
        />
      </DefinitionField>
      <DefinitionField label="状态">
        <SearchableSelect
          value={draft.status}
          onChange={(nextValue) => onChange({ ...draft, status: nextValue as TypeDraft['status'] })}
          className={definitionInputClass}
          options={[
            { value: 'active', label: '启用' },
            { value: 'archived', label: '归档' },
          ]}
          searchPlaceholder="搜索状态"
        />
      </DefinitionField>
    </DefinitionModal>
  );
}
