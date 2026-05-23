import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardList, Cog, Files, FolderTree, GripVertical, Loader2, Pencil, Plus, Save, Sparkles, Tag, Trash2, Upload, X } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { PermissionGate } from '../../auth/PermissionGate';
import {
  createAttribute,
  createStandardClass,
  createStandardAttribute,
  deleteAttribute,
  getClassAttributes,
  getStandardDetail,
  getStandardCommonAttributes,
  moveClassParent,
  reorderAttributes,
  updateAttribute,
  updateStandardClass,
  updateStandardIcon,
  type AttributeDefinition,
  type AttributeUpdatePayload,
  type AttributeValueType,
  type ClassDefinitionDomain,
  type ClassCreatePayload,
  type StandardDetail,
} from '../../lib/api';
import { createStandardIconPreview } from '../../lib/standardAssets';
import { getStandardKindLabel, getValueTypeLabel, localizeStandardDetail } from '../../lib/standardLocalization';
import { PbsLevelEditor } from '../../components/standards/PbsLevelEditor';
import { DefinitionField, DefinitionModal, definitionInputClass } from '../../components/standards/DefinitionModal';
import { DefinitionTree, type DefinitionTreeNode } from '../../components/standards/DefinitionTree';
import { StandardImportDialog } from '../../components/standards/StandardImportDialog';
import { useUiDisplaySettings } from '../../settings/uiDisplaySettings';
import { DocumentTypesPage } from './DocumentTypesPage';
import { DeliveryRulesManager } from './DeliveryRulesManager';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { useDialog } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';

type StandardClass = StandardDetail['classes'][number];
type StandardDetailTab = 'tag' | 'equipment' | 'documents' | 'delivery' | 'pbs';
type ObjectDefinitionScope = ClassDefinitionDomain;
const ATTRIBUTE_PAGE_SIZE = 20;
const NEW_ATTRIBUTE_ID = '__new_attribute__';
const ATTRIBUTE_VALUE_TYPES: AttributeValueType[] = ['string', 'number', 'integer', 'boolean', 'date', 'enum', 'json'];

function standardDetailOptionsForTab(tab: StandardDetailTab) {
  return {
    includeEquipmentClasses: tab === 'equipment' || tab === 'delivery',
  };
}

const OBJECT_SCOPE_CONFIG: Record<ObjectDefinitionScope, {
  treeTitle: string;
  commonLabel: string;
  commonScopeTitle: string;
  commonDescription: string;
  rootActionLabel: string;
  childActionLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  classModalLabel: string;
}> = {
  tag: {
    treeTitle: '位号类型定义',
    commonLabel: '位号公共属性',
    commonScopeTitle: '位号公共属性',
    commonDescription: '适用于该标准下所有位号类型的全局共用属性',
    rootActionLabel: '新增根类别',
    childActionLabel: '子级别',
    emptyTitle: '请选择一个位号类型',
    emptyDescription: '查看标准位号类型层级和属性定义。',
    classModalLabel: '位号类别',
  },
  equipment: {
    treeTitle: '设备类型定义',
    commonLabel: '设备公共属性',
    commonScopeTitle: '设备公共属性',
    commonDescription: '适用于该标准下所有设备类型的全局共用属性',
    rootActionLabel: '新增设备根类别',
    childActionLabel: '子设备类别',
    emptyTitle: '请选择一个设备类型',
    emptyDescription: '查看标准设备类型层级和设备属性定义。',
    classModalLabel: '设备类别',
  },
};

interface AttributeDraft {
  code: string;
  name: string;
  value_type: AttributeValueType;
  is_required: boolean;
  unit_family: string;
  enum_options: string;
  description: string;
}

interface ClassDraft {
  id?: string;
  code: string;
  name: string;
  parent_id: string;
  description: string;
  status: 'draft' | 'active' | 'deprecated' | 'archived';
}

function createEmptyAttributeDraft(): AttributeDraft {
  return {
    code: '',
    name: '',
    value_type: 'string',
    is_required: false,
    unit_family: '',
    enum_options: '',
    description: '',
  };
}

function classToDraft(classItem?: StandardClass, parentId?: string | null): ClassDraft {
  return {
    id: classItem?.id,
    code: classItem?.code ?? '',
    name: classItem?.name ?? '',
    parent_id: parentId ?? classItem?.parent_id ?? '',
    description: classItem?.description ?? '',
    status: (classItem?.status as ClassDraft['status']) ?? 'active',
  };
}

function sortAttributes(attributes: AttributeDefinition[]) {
  return [...attributes].sort((left, right) => {
    const sortOrderDifference = left.sort_order - right.sort_order;
    return sortOrderDifference === 0 ? left.code.localeCompare(right.code, 'zh-CN') : sortOrderDifference;
  });
}

function renumberAttributes(attributes: AttributeDefinition[]) {
  return attributes.map((attribute, sortOrder) => ({ ...attribute, sort_order: sortOrder }));
}

function moveAttribute(
  attributes: AttributeDefinition[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'after',
) {
  if (draggedId === targetId) {
    return attributes;
  }

  const draggedAttribute = attributes.find((attribute) => attribute.id === draggedId);
  if (!draggedAttribute) {
    return attributes;
  }

  const attributesWithoutDragged = attributes.filter((attribute) => attribute.id !== draggedId);
  const targetIndex = attributesWithoutDragged.findIndex((attribute) => attribute.id === targetId);
  if (targetIndex < 0) {
    return attributes;
  }

  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  return renumberAttributes([
    ...attributesWithoutDragged.slice(0, insertIndex),
    draggedAttribute,
    ...attributesWithoutDragged.slice(insertIndex),
  ]);
}

function getClassesForScope(standard: StandardDetail, scope: ObjectDefinitionScope) {
  return scope === 'equipment' ? (standard.equipment_classes ?? []) : standard.classes;
}

function getCommonAttributesForScope(standard: StandardDetail, scope: ObjectDefinitionScope) {
  return scope === 'equipment' ? (standard.equipment_common_attributes ?? []) : (standard.common_attributes ?? []);
}

function getCommonAttributeCountForScope(standard: StandardDetail, scope: ObjectDefinitionScope) {
  return scope === 'equipment'
    ? (standard.equipment_common_attribute_count ?? standard.equipment_common_attributes?.length ?? 0)
    : (standard.common_attribute_count ?? standard.common_attributes?.length ?? 0);
}

function getDefaultSelectedClassId() {
  return 'common';
}

function replaceClassesForScope(standard: StandardDetail, scope: ObjectDefinitionScope, classes: StandardClass[]): StandardDetail {
  return scope === 'equipment'
    ? { ...standard, equipment_classes: classes }
    : { ...standard, classes };
}

function replaceClassForScope(
  standard: StandardDetail,
  scope: ObjectDefinitionScope,
  classId: string,
  updater: (classItem: StandardClass) => StandardClass,
): StandardDetail {
  return replaceClassesForScope(
    standard,
    scope,
    getClassesForScope(standard, scope).map((classItem) => (
      classItem.id === classId ? updater(classItem) : classItem
    )),
  );
}

function replaceCommonAttributesForScope(
  standard: StandardDetail,
  scope: ObjectDefinitionScope,
  attributes: AttributeDefinition[],
  total?: number,
): StandardDetail {
  return scope === 'equipment'
    ? {
        ...standard,
        equipment_common_attributes: attributes,
        equipment_common_attribute_count: total ?? standard.equipment_common_attribute_count,
      }
    : {
        ...standard,
        common_attributes: attributes,
        common_attribute_count: total ?? standard.common_attribute_count,
      };
}

export function StandardDetailPage() {
  const { standardId } = useParams<{ standardId: string }>();
  const navigate = useNavigate();
  const { settings: uiDisplaySettings } = useUiDisplaySettings();
  const { confirm } = useDialog();
  const { error: showError } = useToast();
  const [standard, setStandard] = useState<StandardDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [attributePage, setAttributePage] = useState(1);
  const [editingAttributeId, setEditingAttributeId] = useState<string | null>(null);
  const [attributeDraft, setAttributeDraft] = useState<AttributeDraft | null>(null);
  const [isSavingAttribute, setIsSavingAttribute] = useState(false);
  const [deletingAttributeId, setDeletingAttributeId] = useState<string | null>(null);
  const [draggingAttributeId, setDraggingAttributeId] = useState<string | null>(null);
  const [dragOverAttributeId, setDragOverAttributeId] = useState<string | null>(null);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [activeTab, setActiveTab] = useState<StandardDetailTab>('tag');
  const [loadedEquipmentDefinitionStandardId, setLoadedEquipmentDefinitionStandardId] = useState<string | null>(null);
  const [classDraft, setClassDraft] = useState<ClassDraft | null>(null);
  const [isSavingClass, setIsSavingClass] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAttributesLoading, setIsAttributesLoading] = useState(false);
  const [attributeTotalCount, setAttributeTotalCount] = useState(0);
  const [attributeTotalPages, setAttributeTotalPages] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectScope: ObjectDefinitionScope = activeTab === 'equipment' ? 'equipment' : 'tag';
  const isObjectTab = activeTab === 'tag' || activeTab === 'equipment';

  useEffect(() => {
    if (!standardId) {
      return;
    }

    const activeStandardId = standardId;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const data = localizeStandardDetail(await getStandardDetail(activeStandardId, { includeEquipmentClasses: false }));
        if (!cancelled) {
          setStandard(data);
          setLoadedEquipmentDefinitionStandardId(null);
          setSelectedClassId(getDefaultSelectedClassId());
          setAttributePage(1);
        }
      } catch {
        if (!cancelled) {
          setError('加载标准详情失败，请稍后重试。');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [standardId]);

  useEffect(() => {
    if (!standardId || !standard || (activeTab !== 'equipment' && activeTab !== 'delivery')) {
      return;
    }
    if (loadedEquipmentDefinitionStandardId === standardId) {
      return;
    }

    let cancelled = false;
    getStandardDetail(standardId, {
      includeTagClasses: false,
      includeEquipmentClasses: true,
      includePbsLevels: false,
    })
      .then((data) => {
        if (cancelled) {
          return;
        }
        const localized = localizeStandardDetail(data);
        setStandard((current) => {
          if (!current || current.id !== standardId) {
            return localized;
          }
          return {
            ...current,
            equipment_classes: localized.equipment_classes,
            equipment_common_attributes: localized.equipment_common_attributes,
            equipment_common_attribute_count: localized.equipment_common_attribute_count,
          };
        });
        setLoadedEquipmentDefinitionStandardId(standardId);
      })
      .catch(() => {
        if (!cancelled) {
          setError('加载设备类型失败，请稍后重试。');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, loadedEquipmentDefinitionStandardId, standard, standardId]);

  useEffect(() => {
    if (!isObjectTab || !standardId || !selectedClassId) {
      return;
    }

    const activeStandardId = standardId;
    const activeSelectedClassId = selectedClassId;
    const activeObjectScope = objectScope;
    let cancelled = false;

    async function loadAttributes() {
      setIsAttributesLoading(true);
      try {
        const result = activeSelectedClassId === 'common'
          ? await getStandardCommonAttributes(activeStandardId, attributePage, ATTRIBUTE_PAGE_SIZE, activeObjectScope)
          : await getClassAttributes(activeSelectedClassId, attributePage, ATTRIBUTE_PAGE_SIZE);
        if (cancelled) {
          return;
        }
        setAttributeTotalCount(result.total);
        setAttributeTotalPages(result.total_pages);
        setStandard((current) => {
          if (!current) {
            return current;
          }
          if (activeSelectedClassId === 'common') {
            return replaceCommonAttributesForScope(current, activeObjectScope, result.items, result.total);
          }
          return replaceClassForScope(current, activeObjectScope, activeSelectedClassId, (classItem) => ({
            ...classItem,
            attributes: result.items,
            attribute_count: result.total,
          }));
        });
      } catch {
        if (!cancelled) {
          setError('加载属性分页失败，请稍后重试。');
        }
      } finally {
        if (!cancelled) {
          setIsAttributesLoading(false);
        }
      }
    }

    void loadAttributes();

    return () => {
      cancelled = true;
    };
  }, [isObjectTab, standardId, selectedClassId, attributePage, objectScope]);

  useEffect(() => {
    setAttributePage(1);
    setEditingAttributeId(null);
    setAttributeDraft(null);
    setDeletingAttributeId(null);
    setDraggingAttributeId(null);
    setDragOverAttributeId(null);
    setAttributeTotalCount(0);
    setAttributeTotalPages(1);
  }, [selectedClassId, objectScope]);

  useEffect(() => {
    if (!standard) {
      return;
    }

    setSelectedClassId((current) => {
      const classes = getClassesForScope(standard, objectScope);
      const hasCommonAttributes = getCommonAttributeCountForScope(standard, objectScope) > 0;
      if (current === 'common' && hasCommonAttributes) {
        return current;
      }
      if (current && classes.some((item) => item.id === current)) {
        return current;
      }
      return getDefaultSelectedClassId();
    });
  }, [standard, objectScope]);

  const isCommon = selectedClassId === 'common';
  const objectClasses = standard ? getClassesForScope(standard, objectScope) : [];
  const commonAttributes = standard ? getCommonAttributesForScope(standard, objectScope) : [];
  const scopeConfig = OBJECT_SCOPE_CONFIG[objectScope];
  const selectedClass = isCommon ? null : (objectClasses.find((item) => item.id === selectedClassId) ?? null);

  const currentScope = isCommon 
    ? { id: 'common', name: scopeConfig.commonScopeTitle, description: scopeConfig.commonDescription, attributes: commonAttributes }
    : selectedClass;
  const classTree = buildClassTree(objectClasses);
  const classParentCandidates = objectClasses.filter((item) => !classDraft?.id || (item.id !== classDraft.id && !canMoveClass(objectClasses, classDraft.id, item.id)));

  const handleIconFiles = async (fileList: FileList | File[]) => {
    if (!standardId || fileList.length === 0) {
      return;
    }

    const [file] = Array.from(fileList);
    if (!file.type.startsWith('image/')) {
      showError('只能上传图片文件');
      return;
    }

    setIsUploadingIcon(true);
    try {
      const preview = await createStandardIconPreview(file);
      await updateStandardIcon(standardId, preview);
      setStandard((current) => (current ? { ...current, thumbnail_url: preview } : current));
    } catch {
      showError('处理图片失败，请稍后重试。');
    } finally {
      setIsUploadingIcon(false);
    }
  };

  const reloadStandard = async () => {
    if (!standardId) return;
    const includeEquipmentClasses = standardDetailOptionsForTab(activeTab).includeEquipmentClasses;
    const data = localizeStandardDetail(await getStandardDetail(standardId, { includeEquipmentClasses }));
    setStandard(data);
    setLoadedEquipmentDefinitionStandardId(includeEquipmentClasses ? standardId : null);
    setSelectedClassId((current) => {
      const classes = getClassesForScope(data, objectScope);
      const hasCommonAttributes = getCommonAttributeCountForScope(data, objectScope) > 0;
      if (current === 'common' && hasCommonAttributes) {
        return current;
      }
      if (current && classes.some((item) => item.id === current)) {
        return current;
      }
      return getDefaultSelectedClassId();
    });
  };

  const selectClass = (classId: string) => {
    setSelectedClassId(classId);
  };

  const startCreatingClass = (parentId: string | null) => {
    setEditingAttributeId(null);
    setAttributeDraft(null);
    setClassDraft(classToDraft(undefined, parentId));
  };

  const updateClassDraft = <TField extends keyof ClassDraft>(field: TField, value: ClassDraft[TField]) => {
    setClassDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const startEditingClass = (classId: string) => {
    const targetClass = objectClasses.find((item) => item.id === classId);
    if (!targetClass) {
      return;
    }
    setEditingAttributeId(null);
    setAttributeDraft(null);
    setClassDraft(classToDraft(targetClass));
  };

  const closeClassModal = () => {
    setClassDraft(null);
  };

  const saveClass = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!standard || !standardId || !classDraft) {
      return;
    }

    const payload = toClassPayload(classDraft);
    if (!payload.code || !payload.name) {
      showError('类别编码和名称不能为空。');
      return;
    }

    const normalizedCode = payload.code.toLowerCase();
    const hasDuplicateCode = objectClasses.some((classItem) => (
      classItem.code.toLowerCase() === normalizedCode && classItem.id !== classDraft.id
    ));
    if (hasDuplicateCode) {
      showError('当前标准下已存在相同的类别编码。');
      return;
    }

    setIsSavingClass(true);
    try {
      const savedClass = classDraft.id
        ? await updateStandardClass(classDraft.id, payload)
        : await createStandardClass(standardId, { ...payload, applies_to: objectScope });
      setStandard((current) => (current ? {
        ...replaceClassesForScope(
          current,
          objectScope,
          classDraft.id
            ? getClassesForScope(current, objectScope).map((item) => (item.id === savedClass.id ? { ...item, ...savedClass } : item))
            : [...getClassesForScope(current, objectScope), savedClass],
        ),
      } : current));
      setSelectedClassId(savedClass.id);
      closeClassModal();
    } catch (saveError) {
      showError('保存类别失败: ' + (saveError instanceof Error ? saveError.message : String(saveError)));
    } finally {
      setIsSavingClass(false);
    }
  };

  const handleMoveClass = async (draggedId: string, targetId: string | null) => {
    if (!standard || draggedId === targetId) {
      return;
    }

    const draggedClass = objectClasses.find((item) => item.id === draggedId);
    if (!draggedClass || draggedClass.parent_id === targetId) {
      return;
    }

    if (!canMoveClass(objectClasses, draggedId, targetId)) {
      showError('不能把类别拖到自己的子节点下。');
      return;
    }

    const previousStandard = standard;
    const targetLevel = targetId
      ? (objectClasses.find((item) => item.id === targetId)?.level_no ?? 0) + 1
      : 1;

    setStandard(replaceClassesForScope(
      standard,
      objectScope,
      objectClasses.map((item) => (
        item.id === draggedId ? { ...item, parent_id: targetId, level_no: targetLevel } : item
      )),
    ));

    try {
      const movedClass = await moveClassParent(draggedId, targetId);
      setStandard((current) => (current
        ? replaceClassForScope(current, objectScope, movedClass.id, (item) => ({ ...item, ...movedClass }))
        : current));
    } catch (moveError) {
      setStandard(previousStandard);
      showError('保存类别移动失败: ' + (moveError instanceof Error ? moveError.message : String(moveError)));
    }
  };

  const handleReorderAttribute = async (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after',
  ) => {
    if (!standard || !currentScope || isCommon || editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null) {
      return;
    }

    const currentAttributes = sortAttributes(currentScope.attributes);
    const nextAttributes = moveAttribute(currentAttributes, draggedId, targetId, position);
    const currentOrder = currentAttributes.map((attribute) => attribute.id).join(',');
    const nextOrder = nextAttributes.map((attribute) => attribute.id).join(',');
    setDraggingAttributeId(null);
    setDragOverAttributeId(null);

    if (currentOrder === nextOrder) {
      return;
    }

    const previousStandard = standard;
    setStandard(replaceClassForScope(standard, objectScope, currentScope.id, (classItem) => ({
      ...classItem,
      attributes: nextAttributes,
    })));

    try {
      const persistedAttributes = await reorderAttributes(currentScope.id, nextAttributes.map((attribute) => attribute.id));
      const persistedSortOrder = new Map(persistedAttributes.map((attribute) => [attribute.id, attribute.sort_order]));

      setStandard((current) => (current
        ? replaceClassForScope(current, objectScope, currentScope.id, (classItem) => ({
            ...classItem,
            attributes: sortAttributes(classItem.attributes.map((attribute) => ({
              ...attribute,
              sort_order: persistedSortOrder.get(attribute.id) ?? attribute.sort_order,
            }))),
          }))
        : current));
    } catch (reorderError) {
      setStandard(previousStandard);
      showError('保存属性排序失败: ' + (reorderError instanceof Error ? reorderError.message : String(reorderError)));
    }
  };

  const handleDeleteAttribute = async (attribute: AttributeDefinition) => {
    if (!standard || !currentScope || editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null) {
      return;
    }

    const shouldDelete = await confirm({
      title: '删除属性',
      description: `确认删除属性“${attribute.name}”吗？删除后会以归档方式保留。`,
      confirmText: '删除',
      danger: true,
    });
    if (!shouldDelete) {
      return;
    }

    setDeletingAttributeId(attribute.id);
    try {
      await deleteAttribute(attribute.id);
      const nextTotal = Math.max(0, attributeTotalCount - 1);
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / ATTRIBUTE_PAGE_SIZE));

      setStandard((current) => {
        if (!current) return current;
        if (isCommon) {
           return replaceCommonAttributesForScope(
             current,
             objectScope,
             getCommonAttributesForScope(current, objectScope).filter((item) => item.id !== attribute.id),
             nextTotal,
           );
        }
        return replaceClassForScope(current, objectScope, currentScope.id, (classItem) => ({
          ...classItem,
          attributes: classItem.attributes.filter((item) => item.id !== attribute.id),
        }));
      });
      setAttributeTotalCount(nextTotal);
      setAttributeTotalPages(nextTotalPages);
      setAttributePage((current) => Math.min(current, nextTotalPages));
    } catch (deleteError) {
      showError('删除属性失败: ' + (deleteError instanceof Error ? deleteError.message : String(deleteError)));
    } finally {
      setDeletingAttributeId(null);
    }
  };

  const startEditingAttribute = (attribute: AttributeDefinition) => {
    setEditingAttributeId(attribute.id);
    setAttributeDraft({
      code: attribute.code,
      name: attribute.name,
      value_type: attribute.value_type,
      is_required: attribute.is_required,
      unit_family: attribute.unit_family ?? '',
      enum_options: attribute.enum_options.map(String).join(', '),
      description: attribute.description ?? '',
    });
  };

  const startCreatingAttribute = () => {
    if (!currentScope) {
      return;
    }

    setEditingAttributeId(NEW_ATTRIBUTE_ID);
    setAttributeDraft(createEmptyAttributeDraft());
    setAttributePage(Math.max(1, attributeTotalPages));
  };

  const updateAttributeDraft = <TField extends keyof AttributeDraft>(field: TField, value: AttributeDraft[TField]) => {
    setAttributeDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const cancelEditingAttribute = () => {
    setEditingAttributeId(null);
    setAttributeDraft(null);
  };

  const saveAttribute = async () => {
    if (!attributeDraft || !currentScope || !editingAttributeId) {
      return;
    }

    const payload = toAttributePayload(attributeDraft);
    if (!payload.code || !payload.name) {
      showError('属性编码和名称不能为空。');
      return;
    }

    const normalizedCode = payload.code.toLowerCase();
    const hasDuplicateCode = currentScope.attributes.some((attribute) => (
      attribute.code.toLowerCase() === normalizedCode && attribute.id !== editingAttributeId
    ));

    if (hasDuplicateCode) {
      showError('当前类别下已存在相同的属性编码。');
      return;
    }

    setIsSavingAttribute(true);
    try {
      if (editingAttributeId === NEW_ATTRIBUTE_ID) {
        const createPayload = { ...payload, applies_to: objectScope };
        if (isCommon && standardId) {
          const createdAttribute = await createStandardAttribute(standardId, createPayload);
          const nextAttributes = sortAttributes([...currentScope.attributes, createdAttribute]);
          const nextIndex = nextAttributes.findIndex((attribute) => attribute.id === createdAttribute.id);
          
          setStandard((current) => (current ? {
            ...replaceCommonAttributesForScope(
              current,
              objectScope,
              sortAttributes([...getCommonAttributesForScope(current, objectScope), createdAttribute]),
              attributeTotalCount + 1,
            ),
          } : current));
          setAttributeTotalCount((current) => current + 1);
          setAttributePage(Math.floor(Math.max(nextIndex, 0) / ATTRIBUTE_PAGE_SIZE) + 1);
        } else {
          const createdAttribute = await createAttribute(currentScope.id, createPayload);
          const nextAttributes = sortAttributes([...currentScope.attributes, createdAttribute]);
          const nextIndex = nextAttributes.findIndex((attribute) => attribute.id === createdAttribute.id);
  
          setStandard((current) => (current
            ? replaceClassForScope(current, objectScope, currentScope.id, (classItem) => ({
                ...classItem,
                attributes: sortAttributes([...classItem.attributes, createdAttribute]),
                attribute_count: (classItem.attribute_count ?? attributeTotalCount) + 1,
              }))
            : current));
          setAttributeTotalCount((current) => current + 1);
          setAttributePage(Math.floor(Math.max(nextIndex, 0) / ATTRIBUTE_PAGE_SIZE) + 1);
        }
      } else {
        const updatedAttribute = await updateAttribute(editingAttributeId, payload);
        const nextAttributes = sortAttributes(currentScope.attributes.map((attribute) => (
          attribute.id === updatedAttribute.id ? updatedAttribute : attribute
        )));
        const nextIndex = nextAttributes.findIndex((attribute) => attribute.id === updatedAttribute.id);

        setStandard((current) => {
          if (!current) return current;
          if (isCommon) {
             return replaceCommonAttributesForScope(
               current,
               objectScope,
               sortAttributes(getCommonAttributesForScope(current, objectScope).map((attribute) => (
                 attribute.id === updatedAttribute.id ? updatedAttribute : attribute
               ))),
             );
          }
          return replaceClassForScope(current, objectScope, currentScope.id, (classItem) => ({
            ...classItem,
            attributes: sortAttributes(classItem.attributes.map((attribute) => (
              attribute.id === updatedAttribute.id ? updatedAttribute : attribute
            ))),
          }));
        });
        setAttributePage(Math.floor(Math.max(nextIndex, 0) / ATTRIBUTE_PAGE_SIZE) + 1);
      }

      cancelEditingAttribute();
    } catch (saveError) {
      showError('保存属性失败: ' + (saveError instanceof Error ? saveError.message : String(saveError)));
    } finally {
      setIsSavingAttribute(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center animate-fade-in">
        <div className="space-y-4 text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-adnoc-blue" />
          <p className="animate-pulse font-medium text-slate-400">正在加载标准详情...</p>
        </div>
      </div>
    );
  }

  if (error || !standard) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/50 text-slate-400 backdrop-blur-sm animate-fade-in">
        <Sparkles className="mb-4 h-12 w-12 opacity-20" />
        <p className="text-lg font-medium">{error || '未找到该标准'}</p>
        <button onClick={() => navigate('/standards')} className="mt-6 font-semibold text-adnoc-blue hover:underline">
          返回列表重试
        </button>
      </div>
    );
  }

  const orderedAttributes = currentScope ? sortAttributes(currentScope.attributes) : [];
  const pagedAttributes = currentScope ? orderedAttributes : [];
  const visibleAttributeTotal = currentScope ? attributeTotalCount : 0;
  const visibleAttributeTotalPages = currentScope ? attributeTotalPages : 1;
  const attributeStart = currentScope && visibleAttributeTotal > 0
    ? (attributePage - 1) * ATTRIBUTE_PAGE_SIZE + 1
    : 0;
  const attributeEnd = currentScope
    ? Math.min(visibleAttributeTotal, attributePage * ATTRIBUTE_PAGE_SIZE)
    : 0;
  const attributeRangeLabel = visibleAttributeTotal > 0
    ? `显示第 ${attributeStart}-${attributeEnd} 条，共 ${visibleAttributeTotal} 条`
    : '暂无属性';

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 animate-fade-in">
      <div className="flex shrink-0 items-center justify-between">
        <button
          onClick={() => navigate('/standards')}
          className="group flex items-center gap-2 text-xs font-bold text-slate-400 transition-colors hover:text-adnoc-blue"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          返回标准列表
        </button>
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold tracking-wide text-slate-500">
          标准详情
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white/70 p-1 shadow-sm backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('tag')}
            className={clsx(
              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition',
              activeTab === 'tag' ? 'bg-adnoc-blue text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            <Tag className="h-3 w-3" />
            Tag 位号
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('equipment')}
            className={clsx(
              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition',
              activeTab === 'equipment' ? 'bg-adnoc-blue text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            <Cog className="h-3 w-3" />
            Equipment 设备
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('documents')}
            className={clsx(
              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition',
              activeTab === 'documents' ? 'bg-adnoc-blue text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            <Files className="h-3 w-3" />
            文档类型
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('delivery')}
            className={clsx(
              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition',
              activeTab === 'delivery' ? 'bg-adnoc-blue text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            <ClipboardList className="h-3 w-3" />
            交付规则
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pbs')}
            className={clsx(
              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition',
              activeTab === 'pbs' ? 'bg-adnoc-blue text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            <FolderTree className="h-3 w-3" />
            PBS 层级
          </button>
        </div>

        <PermissionGate permission="standard.write" scopeId={standard.id}>
          <button
            type="button"
            onClick={() => setIsImporting(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-adnoc-blue transition hover:border-blue-300 hover:bg-blue-100"
          >
            <Sparkles className="h-3 w-3" />
            AI 补录
          </button>
        </PermissionGate>

        <div className="ml-auto flex min-w-[360px] max-w-[560px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-1.5 py-1">
          <div
            className="group relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-white bg-gradient-to-br from-white to-blue-50 text-adnoc-blue shadow-sm transition-transform hover:scale-105"
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploadingIcon ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : standard.thumbnail_url ? (
              <img src={standard.thumbnail_url} alt="标准图标" className="h-full w-full object-cover" />
            ) : (
              <Upload className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-adnoc-blue" />
            )}
            <div className="absolute inset-x-0 bottom-0 bg-adnoc-blue/80 text-center text-[6px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
              更新
            </div>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={(event) => {
                if (event.target.files) {
                  void handleIconFiles(event.target.files);
                }
              }}
            />
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="min-w-0 flex-1 truncate text-[11px] font-black leading-4 text-slate-900">{standard.name}</div>
            <div className="flex shrink-0 items-center gap-1 text-[10px] leading-4">
              <span className="shrink-0 rounded-full border border-blue-100 bg-blue-50 px-1.5 py-0 font-bold text-adnoc-blue">
                {getStandardKindLabel(standard.code)}
              </span>
              {standard.version_label && (
                <span className="hidden shrink-0 rounded-full border border-indigo-100 bg-indigo-50 px-1.5 py-0 font-bold text-indigo-700 2xl:inline-flex">
                  版本 {standard.version_label}
                </span>
              )}
              <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0 font-bold text-slate-600">
                {standard.classes.length} 个位号类型
              </span>
              <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0 font-bold text-slate-600">
                {(standard.equipment_classes ?? []).length} 个设备类型
              </span>
            </div>
          </div>
        </div>
      </div>

      <StandardImportDialog
        open={isImporting}
        targetMode="merge"
        targetStandardId={standard.id}
        targetStandardName={standard.name}
        onClose={() => setIsImporting(false)}
        onImported={() => {
          void reloadStandard();
        }}
      />

      {isObjectTab && (
      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <DefinitionTree
          title={scopeConfig.treeTitle}
          titleIcon={<FolderTree className="h-5 w-5 text-slate-300" />}
          commonLabel={scopeConfig.commonLabel}
          commonSelected={selectedClassId === 'common'}
          selectedId={selectedClassId === 'common' ? null : selectedClassId}
          nodes={classTree}
          rootActionLabel={scopeConfig.rootActionLabel}
          childActionLabel={scopeConfig.childActionLabel}
          searchPlaceholder="搜索类别编码或名称"
          showTitle={false}
          showSelectedActions={false}
          showNodeCodes={uiDisplaySettings.showStandardClassCodes}
          onSelectCommon={() => selectClass('common')}
          onSelectNode={selectClass}
          onMove={handleMoveClass}
          onAddRoot={() => startCreatingClass(null)}
          onAddChild={startCreatingClass}
          onEditNode={startEditingClass}
        />

        <div className="min-h-[420px] xl:min-h-0">
          {currentScope ? (
            <div className="flex h-full min-h-0 flex-col gap-4 animate-fade-in">
              <div
                className={clsx(
                  'flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl px-3 py-2 transition-colors',
                  selectedClass && 'cursor-pointer hover:bg-white/60',
                )}
                onDoubleClick={() => {
                  if (selectedClass) {
                    startEditingClass(selectedClass.id);
                  }
                }}
                title={selectedClass ? '双击编辑类别' : undefined}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-2xl font-black tracking-tight text-slate-900">{currentScope.name}</h2>
                    {selectedClass && (
                      <>
                        <span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-xs font-bold uppercase tracking-wide text-slate-500">
                          {selectedClass.code}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
                          层级 {selectedClass.level_no}
                        </span>
                      </>
                    )}
                  </div>
                  {currentScope.description && <p className="text-sm text-slate-500">{currentScope.description}</p>}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {selectedClass && (
                    <>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditingClass(selectedClass.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:border-adnoc-blue/40 hover:text-adnoc-blue"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        编辑类别
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          startCreatingClass(selectedClass.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:border-adnoc-blue/40 hover:text-adnoc-blue"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {scopeConfig.childActionLabel}
                      </button>
                    </>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold tracking-wide text-slate-500">
                    <span className="text-slate-700">{objectScope === 'equipment' ? '设备属性清单' : '位号属性清单'}</span>
                    <span>{attributeRangeLabel}</span>
                  </div>
                </div>
              </div>

              <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/60 bg-white p-0 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-900/5">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
                  <div className="text-xs font-bold tracking-wide text-slate-500">
                    当前页 {attributePage} / {visibleAttributeTotalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={startCreatingAttribute}
                      disabled={editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-adnoc-blue px-3 py-1.5 text-xs font-bold text-white shadow-sm shadow-adnoc-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      新增属性
                    </button>
                    <button
                      onClick={() => setAttributePage((current) => Math.max(1, current - 1))}
                      disabled={attributePage <= 1}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-adnoc-blue hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      上一页
                    </button>
                    <button
                      onClick={() => setAttributePage((current) => Math.min(visibleAttributeTotalPages, current + 1))}
                      disabled={attributePage >= visibleAttributeTotalPages}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-adnoc-blue hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一页
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="relative max-h-[calc(100vh-20rem)] overflow-x-auto overflow-y-auto xl:min-h-0 xl:max-h-none xl:flex-1">
                  <table className="min-w-[1020px] w-full table-fixed border-separate border-spacing-0 text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50/90 shadow-sm backdrop-blur-md">
                      <tr>
                        <th className="w-[56px] border-b border-slate-200 px-3 py-2.5 text-center text-xs font-semibold tracking-wide text-slate-600">排序</th>
                        <th className="w-[170px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">属性编码</th>
                        <th className="w-[180px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">属性名称</th>
                        <th className="w-[160px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">数据类型</th>
                        <th className="w-[120px] border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">是否必填</th>
                        <th className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600">说明</th>
                        <th className="w-[180px] border-b border-slate-200 px-4 py-2.5 text-right text-xs font-semibold tracking-wide text-slate-600">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {pagedAttributes.map((attribute) => {
                        const isEditing = editingAttributeId === attribute.id;
                        const isDeleting = deletingAttributeId === attribute.id;
                        const isDraggingAttribute = draggingAttributeId === attribute.id;
                        const isAttributeDropTarget = dragOverAttributeId === attribute.id && draggingAttributeId !== attribute.id;

                        if (isEditing && attributeDraft) {
                          return (
                            <AttributeEditorRow
                              key={attribute.id}
                              draft={attributeDraft}
                              title={`编辑属性 / ${attribute.name}`}
                              description="调整编码、类型、必填规则和说明，不会再挤压表格列宽。"
                              isSaving={isSavingAttribute}
                              onChange={updateAttributeDraft}
                              onSave={() => void saveAttribute()}
                              onCancel={cancelEditingAttribute}
                            />
                          );
                        }

                        return (
                          <tr
                            key={attribute.id}
                            onDragOver={(event) => {
                              if (
                                !draggingAttributeId
                                || draggingAttributeId === attribute.id
                                || editingAttributeId !== null
                                || isSavingAttribute
                                || deletingAttributeId !== null
                              ) {
                                return;
                              }

                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              setDragOverAttributeId(attribute.id);
                            }}
                            onDragLeave={(event) => {
                              const relatedTarget = event.relatedTarget;
                              if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                                setDragOverAttributeId(null);
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const draggedId = event.dataTransfer.getData('text/plain');
                              const rowRect = event.currentTarget.getBoundingClientRect();
                              const dropPosition = event.clientY > rowRect.top + rowRect.height / 2 ? 'after' : 'before';
                              if (draggedId) {
                                void handleReorderAttribute(draggedId, attribute.id, dropPosition);
                              }
                            }}
                            className={clsx(
                              'group align-top transition-colors hover:bg-slate-50/80',
                              isDraggingAttribute && 'opacity-50',
                              isAttributeDropTarget && 'bg-blue-50/80 ring-1 ring-inset ring-adnoc-blue/30',
                            )}
                          >
                            <td className="px-3 py-3 text-center">
                              <span
                                draggable={!isCommon && editingAttributeId === null && !isSavingAttribute && deletingAttributeId === null}
                                onDragStart={(event) => {
                                  if (isCommon || editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null) {
                                    event.preventDefault();
                                    return;
                                  }

                                  event.dataTransfer.setData('text/plain', attribute.id);
                                  event.dataTransfer.effectAllowed = 'move';
                                  setDraggingAttributeId(attribute.id);
                                }}
                                onDragEnd={() => {
                                  setDraggingAttributeId(null);
                                  setDragOverAttributeId(null);
                                }}
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
                                  onClick={() => startEditingAttribute(attribute)}
                                  disabled={editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null}
                                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:border-adnoc-blue hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  编辑
                                </button>
                                <button
                                  onClick={() => void handleDeleteAttribute(attribute)}
                                  disabled={editingAttributeId !== null || isSavingAttribute || deletingAttributeId !== null}
                                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:border-rose-400 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {editingAttributeId === NEW_ATTRIBUTE_ID && attributeDraft && (
                        <AttributeEditorRow
                          draft={attributeDraft}
                          title="新增属性"
                          description="为当前类别补充一个新的属性定义，保存后默认排在末尾。"
                          isSaving={isSavingAttribute}
                          onChange={updateAttributeDraft}
                          onSave={() => void saveAttribute()}
                          onCancel={cancelEditingAttribute}
                        />
                      )}
                      {isAttributesLoading && (
                        <tr>
                          <td colSpan={7} className="py-24 text-center text-slate-400">
                            <Loader2 className="mx-auto h-6 w-6 animate-spin text-adnoc-blue" />
                          </td>
                        </tr>
                      )}
                      {!isAttributesLoading && currentScope.attributes.length === 0 && editingAttributeId !== NEW_ATTRIBUTE_ID && (
                        <tr>
                          <td colSpan={7} className="py-24 text-center text-slate-400">
                            <div className="flex flex-col items-center justify-center space-y-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-100 bg-slate-50 shadow-inner">
                                <span className="text-xl opacity-30">-</span>
                              </div>
                              <span className="text-sm font-semibold">暂无属性定义</span>
                              <span className="max-w-[240px] text-xs opacity-60">当前分类下还没有配置属性，点击右上角“新增属性”即可补充。</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : (
            <div className="glass-card flex h-full items-center justify-center rounded-3xl border-2 border-dashed p-12 text-slate-300">
              <div className="text-center">
                <FolderTree className="mx-auto mb-6 h-16 w-16 opacity-10" />
                <h4 className="mb-2 text-xl font-black tracking-tight">{scopeConfig.emptyTitle}</h4>
                <p className="text-sm font-bold opacity-50">{scopeConfig.emptyDescription}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {activeTab === 'documents' && standardId && (
        <div className="min-h-0 flex-1">
          <DocumentTypesPage standardId={standardId} embedded />
        </div>
      )}

      {activeTab === 'delivery' && standardId && (
        <DeliveryRulesManager
          standardId={standardId}
          standard={standard}
          showClassCodes={uiDisplaySettings.showStandardClassCodes}
          onOpenDocumentTypes={() => setActiveTab('documents')}
        />
      )}

      {activeTab === 'pbs' && standardId && (
        <PbsLevelEditor
          standardId={standardId}
          levels={standard.pbs_levels || []}
          onLevelsChange={(levels) => setStandard({ ...standard, pbs_levels: levels })}
        />
      )}

      {classDraft && (
        <ClassModal
          draft={classDraft}
          scopeLabel={scopeConfig.classModalLabel}
          parentCandidates={classParentCandidates}
          isSaving={isSavingClass}
          onChange={updateClassDraft}
          onSubmit={saveClass}
          onClose={closeClassModal}
        />
      )}
    </div>
  );
}

function ClassModal({
  draft,
  scopeLabel,
  parentCandidates,
  isSaving,
  onChange,
  onSubmit,
  onClose,
}: {
  draft: ClassDraft;
  scopeLabel: string;
  parentCandidates: StandardClass[];
  isSaving: boolean;
  onChange: <TField extends keyof ClassDraft>(field: TField, value: ClassDraft[TField]) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <DefinitionModal
      title={draft.id ? `编辑${scopeLabel}` : `新增${scopeLabel}`}
      onSubmit={onSubmit}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-adnoc-blue px-6 py-2.5 text-sm font-bold text-white shadow-sm shadow-adnoc-blue/20 transition hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存
          </button>
        </>
      }
    >
      <DefinitionField label="编码" required>
        <input
          value={draft.code}
          onChange={(event) => onChange('code', event.target.value)}
          required
          className={definitionInputClass}
        />
      </DefinitionField>
      <DefinitionField label="名称" required>
        <input
          value={draft.name}
          onChange={(event) => onChange('name', event.target.value)}
          required
          className={definitionInputClass}
        />
      </DefinitionField>
      <DefinitionField label="上级类别">
        <SearchableSelect
          value={draft.parent_id}
          onChange={(nextValue) => onChange('parent_id', nextValue)}
          className={definitionInputClass}
          placeholder="根类别"
          clearable
          options={parentCandidates.map((item) => ({
            value: item.id,
            label: `${'　'.repeat(Math.max(0, item.level_no - 1))}${item.code} - ${item.name}`,
          }))}
          searchPlaceholder="搜索上级类别"
        />
      </DefinitionField>
      <DefinitionField label="描述">
        <textarea
          value={draft.description}
          onChange={(event) => onChange('description', event.target.value)}
          rows={3}
          className={definitionInputClass}
        />
      </DefinitionField>
      <DefinitionField label="状态">
        <SearchableSelect
          value={draft.status}
          onChange={(nextValue) => onChange('status', nextValue as ClassDraft['status'])}
          className={definitionInputClass}
          options={[
            { value: 'active', label: '启用' },
            { value: 'draft', label: '草稿' },
            { value: 'deprecated', label: '废弃' },
            { value: 'archived', label: '归档' },
          ]}
          searchPlaceholder="搜索状态"
        />
      </DefinitionField>
    </DefinitionModal>
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
                placeholder="例如 flow_rate"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold tracking-wide text-slate-600">属性名称</span>
              <input
                value={draft.name}
                onChange={(event) => onChange('name', event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/20"
                placeholder="例如 流量"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold tracking-wide text-slate-600">数据类型</span>
              <SearchableSelect
                value={draft.value_type}
                onChange={(nextValue) => onChange('value_type', nextValue as AttributeValueType)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold tracking-normal focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/20"
                options={ATTRIBUTE_VALUE_TYPES.map((valueType) => ({
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
                placeholder="例如 flow / pressure"
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

function canMoveClass(classes: StandardClass[], draggedId: string, targetId: string | null) {
  let currentId = targetId;
  while (currentId) {
    if (currentId === draggedId) {
      return false;
    }
    currentId = classes.find((item) => item.id === currentId)?.parent_id ?? null;
  }
  return true;
}

function buildClassTree(classes: StandardClass[]): DefinitionTreeNode[] {
  const map = new Map<string, DefinitionTreeNode>();
  classes.forEach((item) => map.set(item.id, { id: item.id, name: item.name, code: item.code, children: [] }));

  const roots: DefinitionTreeNode[] = [];
  classes.forEach((item) => {
    const node = map.get(item.id)!;
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

function toAttributePayload(draft: AttributeDraft): AttributeUpdatePayload {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    value_type: draft.value_type,
    is_required: draft.is_required,
    unit_family: draft.unit_family.trim() || null,
    enum_options: draft.value_type === 'enum'
      ? draft.enum_options.split(',').map((item) => item.trim()).filter(Boolean)
      : [],
    description: draft.description.trim() || null,
  };
}

function toClassPayload(draft: ClassDraft): ClassCreatePayload {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    parent_id: draft.parent_id || null,
    description: draft.description.trim() || null,
    status: draft.status,
  };
}
