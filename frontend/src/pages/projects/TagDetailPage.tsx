import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  Factory,
  FileText,
  GitBranch,
  History,
  Loader2,
  PackageCheck,
  Pencil,
  Puzzle,
  Save,
  Tag as TagIcon,
  Wrench,
  X,
} from 'lucide-react';
import {
  ApiError,
  assignEquipmentToTag,
  createProjectEquipment,
  getAllClassAttributes,
  getAllStandardCommonAttributes,
  getProjectEquipment,
  getPbsNodes,
  getProjectDetail,
  getProjectTagDetail,
  getProjectTags,
  getStandardDetail,
  type AttributeDefinition,
  type ClassDefinition,
  type EquipmentAssetStatus,
  type EquipmentClass,
  type PbsNode,
  type Project,
  type ProjectEquipment,
  type ProjectRelation,
  type ProjectTag,
  type ProjectTagDetail,
  type StandardDetail,
  type TagEquipmentImplementation,
  updateProjectTag,
} from '../../lib/api';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/ui/Toast';
import {
  primaryButtonClass,
  primaryButtonIconClass,
  secondaryButtonClass,
  secondaryButtonIconClass,
  softPrimaryButtonClass,
  softPrimaryButtonIconClass,
} from '../../components/ui/buttonStyles';
import { SearchableSelect } from '../../components/ui/SearchableSelect';

type DetailTab = 'overview' | 'attributes' | 'equipment' | 'relations';

interface TagDraft {
  tag_no: string;
  name: string;
  pbs_node_id: string;
  class_id: string;
  parent_tag_id: string;
  status: 'active' | 'archived';
  attribute_values: Record<string, unknown>;
}

interface EquipmentDraft {
  equipment_no: string;
  name: string;
  class_id: string;
  asset_status: EquipmentAssetStatus;
  attribute_values: Record<string, unknown>;
  installed_from: string;
  notes: string;
}

const equipmentCoreAttributeCodes = new Set([
  'equipment_code',
  'equipment code',
  'CFIHOS-10000031',
  'cfihos-10000031',
  'equipment_class_name',
  'equipment class name',
  'CFIHOS-10000047',
  'cfihos-10000047',
  'tag_name',
  'tag name',
  'CFIHOS-10000166',
  'cfihos-10000166',
  'equipment_actual_installation_date',
  'equipment actual installation date',
  'CFIHOS-10000169',
  'cfihos-10000169',
]);

const equipmentLegacyAttributeAliases: Record<'manufacturer' | 'model' | 'serial_no' | 'purchase_order_no', string[]> = {
  manufacturer: ['manufacturer', 'manufacturer_company_name', 'manufacturer company name', 'CFIHOS-10000158'],
  model: ['model', 'model_part_name', 'model part name', 'CFIHOS-10000159'],
  serial_no: ['serial_no', 'equipment_manufacturer_serial_number', 'equipment manufacturer serial number', 'CFIHOS-10000163'],
  purchase_order_no: ['purchase_order_no', 'purchase_order_number', 'purchase order number', 'CFIHOS-10000128'],
};

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10';

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function emptyEquipmentDraft(equipmentClassId = ''): EquipmentDraft {
  return {
    equipment_no: '',
    name: '',
    class_id: equipmentClassId,
    asset_status: 'in_service',
    attribute_values: {},
    installed_from: todayIsoDate(),
    notes: '',
  };
}

function isEquipmentCoreAttribute(attribute: AttributeDefinition) {
  return (
    equipmentCoreAttributeCodes.has(attribute.code) ||
    equipmentCoreAttributeCodes.has(attribute.code.toLowerCase()) ||
    equipmentCoreAttributeCodes.has(attribute.name) ||
    equipmentCoreAttributeCodes.has(attribute.name.toLowerCase())
  );
}

function legacyAttributeText(attributeValues: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => alias.toLowerCase()));
  for (const [code, value] of Object.entries(attributeValues)) {
    if (!normalizedAliases.has(code.toLowerCase())) continue;
    if (value === null || value === undefined || value === '') continue;
    return String(value).trim() || null;
  }
  return null;
}

function equipmentLegacyFields(attributeValues: Record<string, unknown>) {
  return {
    manufacturer: legacyAttributeText(attributeValues, equipmentLegacyAttributeAliases.manufacturer),
    model: legacyAttributeText(attributeValues, equipmentLegacyAttributeAliases.model),
    serial_no: legacyAttributeText(attributeValues, equipmentLegacyAttributeAliases.serial_no),
    purchase_order_no: legacyAttributeText(attributeValues, equipmentLegacyAttributeAliases.purchase_order_no),
  };
}

function equipmentClassLabel(item: EquipmentClass) {
  return `${item.code} · ${item.name}`;
}

function equipmentLabel(item: ProjectEquipment) {
  const className = item.class_name ? ` · ${item.class_name}` : '';
  return `${item.equipment_no} ${item.name}${className}`;
}

const assetStatusLabels: Record<EquipmentAssetStatus, string> = {
  planned: '计划',
  ordered: '已采购',
  in_service: '在役',
  spare: '备件',
  removed: '已拆除',
  scrapped: '报废',
  archived: '归档',
};

function tagToDraft(tag: ProjectTagDetail): TagDraft {
  return {
    tag_no: tag.tag_no,
    name: tag.name,
    pbs_node_id: tag.pbs_node_id ?? '',
    class_id: tag.class_id ?? '',
    parent_tag_id: tag.parent_tag_id ?? '',
    status: tag.status,
    attribute_values: { ...tag.attribute_values },
  };
}

function normalizeAttributeValue(attribute: AttributeDefinition, value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  if (attribute.value_type === 'number') return Number(value);
  if (attribute.value_type === 'integer') return Number.parseInt(String(value), 10);
  if (attribute.value_type === 'boolean') return Boolean(value);
  return value;
}

interface TagDetailPageProps {
  projectId?: string;
  tagId?: string;
  initialProject?: Project | null;
  initialStandard?: StandardDetail | null;
  initialPbsNodes?: PbsNode[];
  mode?: 'page' | 'overlay';
  onClose?: () => void;
  onOpenTag?: (tagId: string) => void;
  onOpenDocuments?: () => void;
  onSaved?: () => void;
}

export function TagDetailPage({
  projectId: projectIdProp,
  tagId: tagIdProp,
  initialProject,
  initialStandard,
  initialPbsNodes,
  mode = 'page',
  onClose,
  onOpenTag,
  onOpenDocuments,
  onSaved,
}: TagDetailPageProps = {}) {
  const { projectId: routeProjectId, tagId: routeTagId } = useParams<{ projectId: string; tagId: string }>();
  const projectId = projectIdProp ?? routeProjectId;
  const tagId = tagIdProp ?? routeTagId;
  const navigate = useNavigate();
  const { can } = useAuth();
  const { success, error: showError } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [standard, setStandard] = useState<StandardDetail | null>(null);
  const [commonAttributes, setCommonAttributes] = useState<AttributeDefinition[]>([]);
  const [classAttributes, setClassAttributes] = useState<AttributeDefinition[]>([]);
  const [equipmentCommonAttributes, setEquipmentCommonAttributes] = useState<AttributeDefinition[]>([]);
  const [equipmentClassAttributes, setEquipmentClassAttributes] = useState<AttributeDefinition[]>([]);
  const [pbsNodes, setPbsNodes] = useState<PbsNode[]>([]);
  const [allTags, setAllTags] = useState<ProjectTag[]>([]);
  const [allTagsProjectId, setAllTagsProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectTagDetail | null>(null);
  const [draft, setDraft] = useState<TagDraft | null>(null);
  const [equipmentImplementation, setEquipmentImplementation] = useState<TagEquipmentImplementation | null>(null);
  const [projectEquipment, setProjectEquipment] = useState<ProjectEquipment[]>([]);
  const [equipmentDraft, setEquipmentDraft] = useState<EquipmentDraft>(() => emptyEquipmentDraft());
  const [selectedExistingEquipmentId, setSelectedExistingEquipmentId] = useState('');
  const [existingAssignmentDate, setExistingAssignmentDate] = useState(todayIsoDate());
  const [isSavingEquipment, setIsSavingEquipment] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingEquipment, setIsEditingEquipment] = useState(false);
  const [isLoadingAttributeDefinitions, setIsLoadingAttributeDefinitions] = useState(false);
  const [isLoadingEquipmentAttributeDefinitions, setIsLoadingEquipmentAttributeDefinitions] = useState(false);
  const [isLoadingEquipmentOptions, setIsLoadingEquipmentOptions] = useState(false);
  const [attributeDefinitionError, setAttributeDefinitionError] = useState<string | null>(null);
  const [equipmentAttributeDefinitionError, setEquipmentAttributeDefinitionError] = useState<string | null>(null);
  const [equipmentOptionsError, setEquipmentOptionsError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canWrite = Boolean(projectId && can('project.tag.write', projectId));

  const classes = useMemo(() => standard?.classes ?? [], [standard]);
  const equipmentKnownAttributes = useMemo(
    () => [...equipmentCommonAttributes, ...equipmentClassAttributes],
    [equipmentClassAttributes, equipmentCommonAttributes],
  );
  const equipmentFormAttributes = useMemo(
    () => equipmentKnownAttributes.filter((attribute) => !isEquipmentCoreAttribute(attribute)),
    [equipmentKnownAttributes],
  );
  const selectedClassId = draft?.class_id || detail?.class_id || '';
  const selectedClass = useMemo(
    () => classes.find((item) => item.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );
  const knownAttributes = useMemo(
    () => [...commonAttributes, ...classAttributes],
    [classAttributes, commonAttributes],
  );
  const knownAttributeCodes = useMemo(
    () => new Set(knownAttributes.map((attribute) => attribute.code)),
    [knownAttributes],
  );
  const otherAttributes = Object.entries((draft ?? detail)?.attribute_values ?? {}).filter(
    ([code]) => !knownAttributeCodes.has(code),
  );
  const tagMap = useMemo(() => new Map(allTags.map((tag) => [tag.id, tag])), [allTags]);
  const pbsMap = useMemo(() => new Map(pbsNodes.map((node) => [node.id, node])), [pbsNodes]);
  const projectStandardId =
    typeof project?.reference_attributes?.standard_id === 'string' ? project.reference_attributes.standard_id : null;

  const loadDetail = useCallback(async () => {
    if (!projectId || !tagId) return;
    setIsLoading(true);
    setLoadError(null);

    try {
      const [nextDetail, nextProject] = await Promise.all([
        getProjectTagDetail(projectId, tagId),
        initialProject ? Promise.resolve(initialProject) : getProjectDetail(projectId),
      ]);
      const standardId = nextProject.reference_attributes?.standard_id;
      const nextStandard = initialStandard?.id === standardId ? initialStandard : null;
      const nextEquipmentImplementation = nextDetail.equipment_implementation ?? null;
      const firstEquipmentClassId = nextEquipmentImplementation?.compatible_equipment_classes[0]?.id ?? '';

      setDetail(nextDetail);
      setDraft(tagToDraft(nextDetail));
      setProject(nextProject);
      setPbsNodes(initialPbsNodes ?? []);
      setStandard(nextStandard ?? null);
      setCommonAttributes(nextDetail.common_attributes ?? []);
      setClassAttributes(nextDetail.class_attributes ?? []);
      setEquipmentImplementation(nextEquipmentImplementation);
      setEquipmentCommonAttributes(nextEquipmentImplementation?.equipment_common_attributes ?? []);
      setEquipmentClassAttributes(nextEquipmentImplementation?.equipment_class_attributes ?? []);
      setProjectEquipment([]);
      setEquipmentDraft(emptyEquipmentDraft(firstEquipmentClassId));
      setSelectedExistingEquipmentId('');
      setExistingAssignmentDate(todayIsoDate());
      setIsEditing(false);
      setIsEditingEquipment(false);
      setEquipmentOptionsError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        navigate('/403', { replace: true });
        return;
      }
      setLoadError(error instanceof Error ? error.message : '加载 TAG 详情失败');
      setDetail(null);
      setDraft(null);
      setCommonAttributes([]);
      setClassAttributes([]);
      setEquipmentImplementation(null);
      setEquipmentCommonAttributes([]);
      setEquipmentClassAttributes([]);
      setProjectEquipment([]);
    } finally {
      setIsLoading(false);
    }
  }, [initialPbsNodes, initialProject, initialStandard, navigate, projectId, tagId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!projectStandardId || standard?.id === projectStandardId || (!isEditing && !isEditingEquipment)) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const nextStandard = await getStandardDetail(projectStandardId, { includeEquipmentClasses: false });
        if (cancelled) return;
        setStandard(nextStandard);
      } catch (error) {
        if (cancelled) return;
        showError(error instanceof Error ? error.message : '加载标准信息失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditing, isEditingEquipment, projectStandardId, showError, standard?.id]);

  useEffect(() => {
    setCommonAttributes(detail?.common_attributes ?? []);

    if (!selectedClassId) {
      setClassAttributes([]);
      setIsLoadingAttributeDefinitions(false);
      setAttributeDefinitionError(null);
      return;
    }

    if (!isEditing) {
      setClassAttributes(detail?.class_attributes ?? []);
      setIsLoadingAttributeDefinitions(false);
      setAttributeDefinitionError(null);
      return;
    }

    if (selectedClassId === detail?.class_id) {
      setClassAttributes(detail.class_attributes ?? []);
      setIsLoadingAttributeDefinitions(false);
      setAttributeDefinitionError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingAttributeDefinitions(true);
    setAttributeDefinitionError(null);
    setClassAttributes([]);

    (async () => {
      try {
        const nextClassAttributes = await getAllClassAttributes(selectedClassId);
        if (cancelled) return;
        setClassAttributes(nextClassAttributes);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setClassAttributes([]);
        setAttributeDefinitionError('属性定义加载失败，请稍后重试');
      } finally {
        if (!cancelled) {
          setIsLoadingAttributeDefinitions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detail, isEditing, selectedClassId]);

  useEffect(() => {
    if (!isEditingEquipment) {
      setEquipmentCommonAttributes(equipmentImplementation?.equipment_common_attributes ?? []);
      setEquipmentClassAttributes(equipmentImplementation?.equipment_class_attributes ?? []);
      setIsLoadingEquipmentAttributeDefinitions(false);
      setEquipmentAttributeDefinitionError(null);
      return;
    }

    if (!projectStandardId) {
      setEquipmentCommonAttributes([]);
      setEquipmentClassAttributes([]);
      setIsLoadingEquipmentAttributeDefinitions(false);
      setEquipmentAttributeDefinitionError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingEquipmentAttributeDefinitions(true);
    setEquipmentAttributeDefinitionError(null);
    setEquipmentCommonAttributes([]);
    setEquipmentClassAttributes([]);

    (async () => {
      try {
        const [nextCommonAttributes, nextClassAttributes] = await Promise.all([
          getAllStandardCommonAttributes(projectStandardId, 'equipment'),
          equipmentDraft.class_id ? getAllClassAttributes(equipmentDraft.class_id) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setEquipmentCommonAttributes(nextCommonAttributes);
        setEquipmentClassAttributes(nextClassAttributes);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setEquipmentCommonAttributes([]);
        setEquipmentClassAttributes([]);
        setEquipmentAttributeDefinitionError('设备属性定义加载失败，请稍后重试');
      } finally {
        if (!cancelled) {
          setIsLoadingEquipmentAttributeDefinitions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [equipmentDraft.class_id, equipmentImplementation, isEditingEquipment, projectStandardId]);

  const shouldLoadAllTags = isEditing;

  useEffect(() => {
    if (!projectId || !shouldLoadAllTags || allTagsProjectId === projectId) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const nextTags = await getProjectTags(projectId);
        if (cancelled) return;
        setAllTags(nextTags);
        setAllTagsProjectId(projectId);
      } catch (error) {
        if (cancelled) return;
        showError(error instanceof Error ? error.message : '加载项目 TAG 列表失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allTagsProjectId, projectId, shouldLoadAllTags, showError]);

  useEffect(() => {
    if (!projectId || !isEditing) {
      return;
    }
    if (pbsNodes.length > 0) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const nextPbsNodes = await getPbsNodes(projectId);
        if (cancelled) return;
        setPbsNodes(nextPbsNodes);
      } catch (error) {
        if (cancelled) return;
        showError(error instanceof Error ? error.message : '加载 PBS 节点失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditing, pbsNodes.length, projectId, showError]);

  useEffect(() => {
    if (!projectId || !isEditingEquipment || projectEquipment.length > 0) {
      return;
    }

    let cancelled = false;
    setIsLoadingEquipmentOptions(true);
    setEquipmentOptionsError(null);

    (async () => {
      try {
        const nextProjectEquipment = await getProjectEquipment(projectId);
        if (cancelled) return;
        setProjectEquipment(nextProjectEquipment);
      } catch (error) {
        if (cancelled) return;
        setProjectEquipment([]);
        setEquipmentOptionsError(error instanceof Error ? error.message : '加载设备台账失败');
      } finally {
        if (!cancelled) {
          setIsLoadingEquipmentOptions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditingEquipment, projectEquipment.length, projectId]);

  function isDescendantTag(candidateParentId: string) {
    if (!detail) return false;
    let current = tagMap.get(candidateParentId);
    while (current?.parent_tag_id) {
      if (current.parent_tag_id === detail.id) return true;
      current = tagMap.get(current.parent_tag_id);
    }
    return false;
  }

  function updateDraftValue<K extends keyof TagDraft>(key: K, value: TagDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateAttributeValue(code: string, value: unknown) {
    setDraft((current) =>
      current
        ? {
            ...current,
            attribute_values: {
              ...current.attribute_values,
              [code]: value,
            },
          }
        : current,
    );
  }

  async function handleSave() {
    if (!projectId || !detail || !draft) return;
    if (!draft.tag_no.trim() || !draft.name.trim()) {
      showError('Tag 位号和名称不能为空');
      return;
    }
    if (draft.parent_tag_id && (draft.parent_tag_id === detail.id || isDescendantTag(draft.parent_tag_id))) {
      showError('不能把当前 TAG 或其子部件设为父级');
      return;
    }

    const normalizedAttributes: Record<string, unknown> = {};
    for (const attribute of knownAttributes) {
      const normalized = normalizeAttributeValue(attribute, draft.attribute_values[attribute.code]);
      if (normalized !== null && normalized !== '' && normalized !== undefined) {
        normalizedAttributes[attribute.code] = normalized;
      }
    }
    for (const [code, value] of Object.entries(draft.attribute_values)) {
      if (!knownAttributeCodes.has(code) && value !== null && value !== '' && value !== undefined) {
        normalizedAttributes[code] = value;
      }
    }

    setIsSaving(true);
    try {
      await updateProjectTag(detail.id, {
        tag_no: draft.tag_no.trim(),
        name: draft.name.trim(),
        pbs_node_id: draft.pbs_node_id || null,
        class_id: draft.class_id || null,
        parent_tag_id: draft.parent_tag_id || null,
        attribute_values: normalizedAttributes,
        status: draft.status,
      });
      success('TAG 详情已保存');
      setIsEditing(false);
      await loadDetail();
      onSaved?.();
    } catch (error) {
      showError(error instanceof Error ? error.message : '保存 TAG 详情失败');
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancelEdit() {
    if (detail) {
      setDraft(tagToDraft(detail));
    }
    setIsEditing(false);
  }

  function updateEquipmentDraftValue<K extends keyof EquipmentDraft>(key: K, value: EquipmentDraft[K]) {
    setEquipmentDraft((current) => ({ ...current, [key]: value }));
  }

  function updateEquipmentAttributeValue(code: string, value: unknown) {
    setEquipmentDraft((current) => ({
      ...current,
      attribute_values: {
        ...current.attribute_values,
        [code]: value,
      },
    }));
  }

  async function handleCreateAndAssignEquipment() {
    if (!projectId || !tagId) return;
    if (!equipmentDraft.equipment_no.trim() || !equipmentDraft.name.trim()) {
      showError('实物设备编号和名称不能为空');
      return;
    }
    if (!equipmentDraft.installed_from) {
      showError('安装日期不能为空');
      return;
    }

    setIsSavingEquipment(true);
    try {
      const normalizedEquipmentAttributes: Record<string, unknown> = {};
      for (const attribute of equipmentFormAttributes) {
        const normalized = normalizeAttributeValue(attribute, equipmentDraft.attribute_values[attribute.code]);
        if (normalized !== null && normalized !== '' && normalized !== undefined) {
          normalizedEquipmentAttributes[attribute.code] = normalized;
        }
      }
      for (const [code, value] of Object.entries(equipmentDraft.attribute_values)) {
        const isKnownEquipmentAttribute = equipmentFormAttributes.some((attribute) => attribute.code === code);
        if (!isKnownEquipmentAttribute && value !== null && value !== '' && value !== undefined) {
          normalizedEquipmentAttributes[code] = value;
        }
      }
      const legacyFields = equipmentLegacyFields(normalizedEquipmentAttributes);
      const created = await createProjectEquipment(projectId, {
        equipment_no: equipmentDraft.equipment_no.trim(),
        name: equipmentDraft.name.trim(),
        class_id: equipmentDraft.class_id || null,
        ...legacyFields,
        asset_status: equipmentDraft.asset_status,
        attribute_values: normalizedEquipmentAttributes,
        metadata: {},
      });
      await assignEquipmentToTag(projectId, tagId, {
        equipment_id: created.id,
        installed_from: equipmentDraft.installed_from,
        is_current: true,
        status: 'active',
        notes: equipmentDraft.notes.trim() || null,
      });
      success('实物设备已创建并安装到当前 TAG');
      await loadDetail();
      onSaved?.();
    } catch (error) {
      showError(error instanceof Error ? error.message : '保存设备实现失败');
    } finally {
      setIsSavingEquipment(false);
    }
  }

  async function handleAssignExistingEquipment() {
    if (!projectId || !tagId) return;
    if (!selectedExistingEquipmentId) {
      showError('请选择要安装的实物设备');
      return;
    }
    if (!existingAssignmentDate) {
      showError('安装日期不能为空');
      return;
    }

    setIsSavingEquipment(true);
    try {
      await assignEquipmentToTag(projectId, tagId, {
        equipment_id: selectedExistingEquipmentId,
        installed_from: existingAssignmentDate,
        is_current: true,
        status: 'active',
      });
      success('实物设备已安装到当前 TAG');
      await loadDetail();
      onSaved?.();
    } catch (error) {
      showError(error instanceof Error ? error.message : '安装已有设备失败');
    } finally {
      setIsSavingEquipment(false);
    }
  }

  function renderAttributeInput(attribute: AttributeDefinition) {
    const value = draft?.attribute_values[attribute.code] ?? '';
    if (!isEditing) {
      return <span className="text-sm text-slate-700">{displayValue(value)}</span>;
    }

    if (attribute.value_type === 'boolean') {
      return (
        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => updateAttributeValue(attribute.code, event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-adnoc-blue focus:ring-adnoc-blue/30"
          />
          {value ? '是' : '否'}
        </label>
      );
    }

    if (attribute.value_type === 'enum') {
      return (
        <SearchableSelect
          value={String(value)}
          onChange={(nextValue) => updateAttributeValue(attribute.code, nextValue)}
          className={inputClass}
          placeholder="未选择"
          clearable
          options={attribute.enum_options.map((option, index) => {
            const optionValue = String(option);
            return { value: optionValue, label: optionValue, keywords: `${attribute.id} ${index}` };
          })}
          searchPlaceholder={`搜索${attribute.name}`}
        />
      );
    }

    const inputType =
      attribute.value_type === 'number' || attribute.value_type === 'integer'
        ? 'number'
        : attribute.value_type === 'date'
          ? 'date'
          : 'text';

    return (
      <input
        type={inputType}
        value={String(value)}
        onChange={(event) => {
          let nextValue: unknown = event.target.value;
          if (attribute.value_type === 'number') nextValue = event.target.value ? Number(event.target.value) : null;
          if (attribute.value_type === 'integer') {
            nextValue = event.target.value ? Number.parseInt(event.target.value, 10) : null;
          }
          updateAttributeValue(attribute.code, nextValue);
        }}
        placeholder={attribute.description || attribute.name}
        className={inputClass}
      />
    );
  }

  function renderAttributeRows(attributes: AttributeDefinition[], title: string) {
    if (attributes.length === 0) return null;
    return (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          {attributes.map((attribute) => (
            <Field key={attribute.id} label={attribute.is_required ? `${attribute.name} *` : attribute.name}>
              {renderAttributeInput(attribute)}
              <div className="mt-1 truncate font-mono text-[11px] text-slate-400">
                  {attribute.code}
                  {attribute.unit_family ? ` · ${attribute.unit_family}` : ''}
              </div>
            </Field>
          ))}
        </div>
      </section>
    );
  }

  function renderEquipmentAttributeInput(attribute: AttributeDefinition) {
    const value = equipmentDraft.attribute_values[attribute.code] ?? '';

    if (attribute.value_type === 'boolean') {
      return (
        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => updateEquipmentAttributeValue(attribute.code, event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-adnoc-blue focus:ring-adnoc-blue/30"
          />
          {value ? '是' : '否'}
        </label>
      );
    }

    if (attribute.value_type === 'enum') {
      return (
        <SearchableSelect
          value={String(value)}
          onChange={(nextValue) => updateEquipmentAttributeValue(attribute.code, nextValue)}
          className={inputClass}
          placeholder="未选择"
          clearable
          options={attribute.enum_options.map((option, index) => {
            const optionValue = String(option);
            return { value: optionValue, label: optionValue, keywords: `${attribute.id} ${index}` };
          })}
          searchPlaceholder={`搜索${attribute.name}`}
        />
      );
    }

    const inputType =
      attribute.value_type === 'number' || attribute.value_type === 'integer'
        ? 'number'
        : attribute.value_type === 'date'
          ? 'date'
          : 'text';

    return (
      <input
        type={inputType}
        value={String(value)}
        onChange={(event) => {
          let nextValue: unknown = event.target.value;
          if (attribute.value_type === 'number') nextValue = event.target.value ? Number(event.target.value) : null;
          if (attribute.value_type === 'integer') {
            nextValue = event.target.value ? Number.parseInt(event.target.value, 10) : null;
          }
          updateEquipmentAttributeValue(attribute.code, nextValue);
        }}
        placeholder={attribute.description || attribute.name}
        className={inputClass}
      />
    );
  }

  function renderEquipmentDraftAttributeRows(attributes: AttributeDefinition[], title: string) {
    if (attributes.length === 0) return null;
    return (
      <div className="space-y-3 md:col-span-2">
        <p className="text-xs font-semibold text-slate-400">{title}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {attributes.map((attribute) => (
            <Field key={attribute.id} label={attribute.is_required ? `${attribute.name} *` : attribute.name}>
              {renderEquipmentAttributeInput(attribute)}
              <div className="mt-1 truncate font-mono text-[11px] text-slate-400">
                {attribute.code}
                {attribute.unit_family ? ` · ${attribute.unit_family}` : ''}
              </div>
            </Field>
          ))}
        </div>
      </div>
    );
  }

  function renderEquipmentDisplayValue(equipment: ProjectEquipment, attribute: AttributeDefinition) {
    const value = equipment.attribute_values?.[attribute.code];
    return displayValue(value);
  }

  function renderEquipmentImplementationTab() {
    const compatibleClasses = equipmentImplementation?.compatible_equipment_classes ?? [];
    const currentAssignment = equipmentImplementation?.current_assignment ?? null;
    const history = equipmentImplementation?.assignment_history ?? [];
    const availableEquipment = projectEquipment.filter((item) => item.asset_status !== 'archived');
    const equipmentDisplayAttributes = equipmentFormAttributes.filter((attribute) => {
      const value = currentAssignment?.equipment?.attribute_values?.[attribute.code];
      return value !== null && value !== undefined && value !== '';
    });

    return (
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">当前实物设备</h2>
                <p className="mt-1 text-xs text-slate-400">Tag 保持不变，实物设备可随安装和更换产生历史记录</p>
              </div>
              <PackageCheck className="h-5 w-5 text-adnoc-blue" />
            </div>
            <div className="p-5">
              {currentAssignment?.equipment ? (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-lg font-bold text-slate-900">
                        {currentAssignment.equipment.equipment_no}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">{currentAssignment.equipment.name}</div>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700">
                      当前安装
                    </span>
                  </div>
                  <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
                    <Field label="Equipment Class">
                      <span>{currentAssignment.equipment.class_name || '未指定'}</span>
                    </Field>
                    <Field label="状态">
                      <span>{assetStatusLabels[currentAssignment.equipment.asset_status]}</span>
                    </Field>
                    <Field label="安装日期">
                      <span>{currentAssignment.installed_from}</span>
                    </Field>
                    {isLoadingEquipmentAttributeDefinitions ? (
                      <div className="flex min-h-10 items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-400 md:col-span-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在加载设备属性...
                      </div>
                    ) : null}
                    {equipmentAttributeDefinitionError ? (
                      <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600 md:col-span-2">
                        {equipmentAttributeDefinitionError}
                      </div>
                    ) : null}
                    {equipmentDisplayAttributes.map((attribute) => (
                      <Field key={attribute.id} label={attribute.name}>
                        <span>
                          {currentAssignment.equipment
                            ? renderEquipmentDisplayValue(currentAssignment.equipment, attribute)
                            : '-'}
                        </span>
                      </Field>
                    ))}
                    {equipmentDisplayAttributes.length === 0 ? (
                      <>
                        <Field label="制造商">
                          <span>{currentAssignment.equipment.manufacturer || '-'}</span>
                        </Field>
                        <Field label="型号">
                          <span>{currentAssignment.equipment.model || '-'}</span>
                        </Field>
                        <Field label="序列号">
                          <span>{currentAssignment.equipment.serial_no || '-'}</span>
                        </Field>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center">
                  <Factory className="mx-auto h-9 w-9 text-slate-300" />
                  <div className="mt-3 text-sm font-medium text-slate-600">尚未安装实物设备</div>
                  <p className="mt-1 text-xs text-slate-400">可以先维护设计参数，采购或安装后再登记实物设备。</p>
                </div>
              )}
            </div>
          </section>

          {isEditingEquipment ? (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">可实现设备类型</h2>
              <p className="mt-1 text-xs text-slate-400">
                {equipmentImplementation?.tag_class
                  ? `来自 Tag Class: ${equipmentImplementation.tag_class.code || ''} ${equipmentImplementation.tag_class.name || ''}`
                  : '当前 TAG 未关联 Tag Class'}
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto p-3">
              {compatibleClasses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                  当前标准下暂无 Equipment Class
                </div>
              ) : (
                <div className="space-y-2">
                  {compatibleClasses.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => updateEquipmentDraftValue('class_id', item.id)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                        equipmentDraft.class_id === item.id
                          ? 'border-adnoc-blue bg-adnoc-blue/5'
                          : 'border-slate-100 bg-slate-50/70 hover:border-adnoc-blue/30 hover:bg-white'
                      }`}
                    >
                      <div className="font-mono text-sm text-slate-800">{item.code}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{item.name}</div>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                        <span className="rounded-full bg-white px-2 py-0.5">
                          {item.is_mapped ? 'CFIHOS 映射' : '标准内可选'}
                        </span>
                        {item.reason ? <span>{item.reason}</span> : null}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
          ) : null}
        </div>

        {canWrite && !isEditingEquipment ? (
          <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 shadow-sm">
            <button type="button" onClick={() => setIsEditingEquipment(true)} className={softPrimaryButtonClass}>
              <span className={softPrimaryButtonIconClass}>
                <PackageCheck className="h-4 w-4" />
              </span>
              登记或安装实物设备
            </button>
          </section>
        ) : null}

        {canWrite && isEditingEquipment ? (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">登记并安装实物设备</h2>
            </div>
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="实物设备编号">
                  <input
                    value={equipmentDraft.equipment_no}
                    onChange={(event) => updateEquipmentDraftValue('equipment_no', event.target.value)}
                    placeholder="EQ-P-101A-001"
                    className={inputClass}
                  />
                </Field>
                <Field label="实物设备名称">
                  <input
                    value={equipmentDraft.name}
                    onChange={(event) => updateEquipmentDraftValue('name', event.target.value)}
                    placeholder={`${detail?.tag_no ?? 'TAG'} 实际安装设备`}
                    className={inputClass}
                  />
                </Field>
                <Field label="Equipment Class">
                  <SearchableSelect
                    value={equipmentDraft.class_id}
                    onChange={(nextValue) => updateEquipmentDraftValue('class_id', nextValue)}
                    className={inputClass}
                    placeholder="未指定"
                    clearable
                    options={compatibleClasses.map((item) => ({
                      value: item.id,
                      label: equipmentClassLabel(item),
                    }))}
                    searchPlaceholder="搜索设备类型"
                  />
                </Field>
                <Field label="资产状态">
                  <SearchableSelect
                    value={equipmentDraft.asset_status}
                    onChange={(nextValue) => updateEquipmentDraftValue('asset_status', nextValue as EquipmentAssetStatus)}
                    className={inputClass}
                    options={Object.entries(assetStatusLabels).map(([optionValue, label]) => ({
                      value: optionValue,
                      label,
                    }))}
                    searchPlaceholder="搜索资产状态"
                  />
                </Field>
                <Field label="安装日期">
                  <input
                    type="date"
                    value={equipmentDraft.installed_from}
                    onChange={(event) => updateEquipmentDraftValue('installed_from', event.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="备注">
                  <input
                    value={equipmentDraft.notes}
                    onChange={(event) => updateEquipmentDraftValue('notes', event.target.value)}
                    placeholder="初次安装、替换原因等"
                    className={inputClass}
                  />
                </Field>
                {isLoadingEquipmentAttributeDefinitions ? (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-400 md:col-span-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在加载设备属性...
                  </div>
                ) : null}
                {equipmentAttributeDefinitionError ? (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600 md:col-span-2">
                    {equipmentAttributeDefinitionError}
                  </div>
                ) : null}
                {!isLoadingEquipmentAttributeDefinitions && !equipmentAttributeDefinitionError && equipmentFormAttributes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-400 md:col-span-2">
                    当前标准未配置 Equipment 固定属性，系统仅登记核心身份字段。
                  </div>
                ) : null}
                {!isLoadingEquipmentAttributeDefinitions
                  ? renderEquipmentDraftAttributeRows(
                      equipmentCommonAttributes.filter((attribute) => !isEquipmentCoreAttribute(attribute)),
                      'Equipment 固定属性',
                    )
                  : null}
                {!isLoadingEquipmentAttributeDefinitions && equipmentClassAttributes.length > 0
                  ? renderEquipmentDraftAttributeRows(
                      equipmentClassAttributes.filter((attribute) => !isEquipmentCoreAttribute(attribute)),
                      'Equipment Class 属性',
                    )
                  : null}
                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={() => void handleCreateAndAssignEquipment()}
                    disabled={isSavingEquipment}
                    className={primaryButtonClass}
                  >
                    <span className={primaryButtonIconClass}>
                      {isSavingEquipment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </span>
                    创建并安装
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <h3 className="text-sm font-semibold text-slate-800">安装已有实物设备</h3>
                <div className="mt-4 space-y-3">
                  <SearchableSelect
                    value={selectedExistingEquipmentId}
                    onChange={setSelectedExistingEquipmentId}
                    className={inputClass}
                    placeholder="选择项目设备台账"
                    clearable
                    options={availableEquipment.map((item) => ({
                      value: item.id,
                      label: equipmentLabel(item),
                    }))}
                    searchPlaceholder="搜索设备编号、名称或类型"
                  />
                  <input
                    type="date"
                    value={existingAssignmentDate}
                    onChange={(event) => setExistingAssignmentDate(event.target.value)}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => void handleAssignExistingEquipment()}
                    disabled={isSavingEquipment || !selectedExistingEquipmentId}
                    className={secondaryButtonClass}
                  >
                    <span className={secondaryButtonIconClass}>
                      {isSavingEquipment ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                    </span>
                    安装已有设备
                  </button>
                  {availableEquipment.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-400">
                      {isLoadingEquipmentOptions
                        ? '正在加载项目设备台账...'
                        : equipmentOptionsError || '项目设备台账为空，先使用左侧表单创建。'}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">安装历史</h2>
            <History className="h-5 w-5 text-slate-400" />
          </div>
          <div className="p-3">
            {history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                暂无安装历史
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((assignment) => (
                  <div key={assignment.id} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm text-slate-800">
                          {assignment.equipment?.equipment_no || assignment.equipment_id}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">{assignment.equipment?.name || '-'}</div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          assignment.is_current ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {assignment.is_current ? '当前' : '历史'}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {assignment.installed_from} 至 {assignment.installed_to || '至今'}
                      {assignment.notes ? ` · ${assignment.notes}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  function relationEndpointLabel(relation: ProjectRelation, side: 'source' | 'target') {
    const kind = side === 'source' ? relation.source_kind : relation.target_kind;
    const id = side === 'source' ? relation.source_id : relation.target_id;
    if (kind === 'tag') {
      const tag = tagMap.get(id);
      return tag ? `${tag.tag_no} ${tag.name}` : id;
    }
    if (kind === 'pbs_node') {
      const node = pbsMap.get(id);
      return node ? `${node.code} ${node.name}` : id;
    }
    const document = detail?.linked_documents.find((item) => item.id === id);
    return document ? `${document.document_no} ${document.title}` : id;
  }

  const parentOptions = allTags.filter((tag) => tag.id !== detail?.id && !isDescendantTag(tag.id));
  const rootHeightClass = mode === 'overlay' ? 'h-[100dvh]' : 'min-h-[calc(100dvh-6rem)] lg:h-[calc(100vh-theme(spacing.16))]';

  function renderTagNavigation(tagId: string, children: React.ReactNode, className: string) {
    if (onOpenTag) {
      return (
        <button type="button" onClick={() => onOpenTag(tagId)} className={className}>
          {children}
        </button>
      );
    }

    return (
      <Link to={`/projects/${projectId}/tags/${tagId}`} className={className}>
        {children}
      </Link>
    );
  }

  if (isLoading) {
    return (
      <div className={`flex ${rootHeightClass} items-center justify-center bg-gray-50/50`}>
        <Loader2 className="h-8 w-8 animate-spin text-adnoc-blue" />
      </div>
    );
  }

  if (loadError || !detail || !draft) {
    return (
      <div className={`flex ${rootHeightClass} items-center justify-center bg-gray-50/50 p-6`}>
        <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center text-red-600">
          {loadError || '未找到 TAG 详情'}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${rootHeightClass} flex-col overflow-hidden bg-gray-50/50`}>
      <div className="border-b border-gray-200/50 bg-white/80 px-4 py-4 backdrop-blur-xl sm:px-6">
        <div className="mb-4 flex min-w-0 items-center overflow-hidden text-sm text-gray-500">
          <Link to="/projects" className="transition-colors hover:text-adnoc-blue">项目管理</Link>
          <ChevronRight className="mx-1 h-4 w-4" />
          <Link to={`/projects/${projectId}`} className="transition-colors hover:text-adnoc-blue">
            {project?.name ?? '项目'}
          </Link>
          <ChevronRight className="mx-1 h-4 w-4" />
          <span className="font-medium text-gray-900">TAG 详情</span>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-adnoc-blue/10 text-adnoc-blue">
                {detail.parent_tag_id ? <Puzzle className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <h1 className="truncate font-mono text-2xl font-bold text-slate-900">{detail.tag_no}</h1>
                <p className="mt-1 truncate text-sm text-slate-500">{detail.name}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  detail.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {detail.status === 'active' ? '启用' : '归档'}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                PBS: {detail.pbs_node_code || '-'} {detail.pbs_node_name || ''}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Class: {detail.class_name || '未关联'}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                父级: {detail.parent_tag_no ? `${detail.parent_tag_no} ${detail.parent_tag_name || ''}` : '-'}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:gap-3">
            {onClose ? (
              <button type="button" onClick={onClose} className={secondaryButtonClass}>
                <span className={secondaryButtonIconClass}>
                  <X className="h-4 w-4" />
                </span>
                关闭
              </button>
            ) : (
              <Link to={`/projects/${projectId}`} className={secondaryButtonClass}>
                <span className={secondaryButtonIconClass}>
                  <ArrowLeft className="h-4 w-4" />
                </span>
                返回项目
              </Link>
            )}
            {canWrite && !isEditing ? (
              <button type="button" onClick={() => setIsEditing(true)} className={softPrimaryButtonClass}>
                <span className={softPrimaryButtonIconClass}>
                  <Pencil className="h-4 w-4" />
                </span>
                编辑
              </button>
            ) : null}
            {isEditing ? (
              <>
                <button type="button" onClick={handleCancelEdit} disabled={isSaving} className={secondaryButtonClass}>
                  <span className={secondaryButtonIconClass}>
                    <X className="h-4 w-4" />
                  </span>
                  取消
                </button>
                <button type="button" onClick={() => void handleSave()} disabled={isSaving} className={primaryButtonClass}>
                  <span className={primaryButtonIconClass}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </span>
                  保存
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex gap-1 overflow-x-auto">
          {([
            { key: 'overview', label: '概览', icon: Boxes },
            { key: 'attributes', label: '属性', icon: TagIcon },
            { key: 'equipment', label: '设备实现', icon: Factory },
            { key: 'relations', label: '关联', icon: GitBranch },
          ] satisfies Array<{ key: DetailTab; label: string; icon: typeof Boxes }>).map(({ key, label, icon: TabIcon }) => {
            const tabKey = key;
            return (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveTab(tabKey)}
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${
                  activeTab === tabKey
                    ? 'border-adnoc-blue text-adnoc-blue'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <TabIcon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6">
        {activeTab === 'overview' ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">基础信息</h2>
              </div>
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <Field label="Tag 位号">
                  {isEditing ? (
                    <input value={draft.tag_no} onChange={(event) => updateDraftValue('tag_no', event.target.value)} className={inputClass} />
                  ) : (
                    <span className="font-mono text-slate-800">{detail.tag_no}</span>
                  )}
                </Field>
                <Field label="名称">
                  {isEditing ? (
                    <input value={draft.name} onChange={(event) => updateDraftValue('name', event.target.value)} className={inputClass} />
                  ) : (
                    <span>{detail.name}</span>
                  )}
                </Field>
                <Field label="状态">
                  {isEditing ? (
                    <SearchableSelect
                      value={draft.status}
                      onChange={(nextValue) => updateDraftValue('status', nextValue as TagDraft['status'])}
                      className={inputClass}
                      options={[
                        { value: 'active', label: '启用' },
                        { value: 'archived', label: '归档' },
                      ]}
                      searchPlaceholder="搜索状态"
                    />
                  ) : (
                    <span>{detail.status === 'active' ? '启用' : '归档'}</span>
                  )}
                </Field>
                <Field label="Class">
                  {isEditing ? (
                    <SearchableSelect
                      value={draft.class_id}
                      onChange={(nextValue) => updateDraftValue('class_id', nextValue)}
                      className={inputClass}
                      placeholder="未关联"
                      clearable
                      options={classes.map((item: ClassDefinition) => ({
                        value: item.id,
                        label: `${item.code} · ${item.name}`,
                      }))}
                      searchPlaceholder="搜索 Class 编码或名称"
                    />
                  ) : (
                    <span>{detail.class_name || '未关联'}</span>
                  )}
                </Field>
                <Field label="PBS 节点">
                  {isEditing ? (
                    <SearchableSelect
                      value={draft.pbs_node_id}
                      onChange={(nextValue) => updateDraftValue('pbs_node_id', nextValue)}
                      className={inputClass}
                      placeholder="未关联"
                      clearable
                      options={pbsNodes.map((node) => ({
                        value: node.id,
                        label: `${node.code} · ${node.name}`,
                      }))}
                      searchPlaceholder="搜索 PBS 编码或名称"
                    />
                  ) : (
                    <span>{detail.pbs_node_code ? `${detail.pbs_node_code} ${detail.pbs_node_name || ''}` : '未关联'}</span>
                  )}
                </Field>
                <Field label="父级 TAG">
                  {isEditing ? (
                    <SearchableSelect
                      value={draft.parent_tag_id}
                      onChange={(nextValue) => updateDraftValue('parent_tag_id', nextValue)}
                      className={inputClass}
                      placeholder="无父级"
                      clearable
                      options={parentOptions.map((tag) => ({
                        value: tag.id,
                        label: `${tag.tag_no} · ${tag.name}`,
                      }))}
                      searchPlaceholder="搜索父级 TAG"
                    />
                  ) : detail.parent_tag_id ? (
                    renderTagNavigation(
                      detail.parent_tag_id,
                      `${detail.parent_tag_no} ${detail.parent_tag_name || ''}`,
                      'text-left text-adnoc-blue hover:underline',
                    )
                  ) : (
                    <span>无父级</span>
                  )}
                </Field>
                <Field label="创建时间"><span>{formatDateTime(detail.created_at)}</span></Field>
                <Field label="更新时间"><span>{formatDateTime(detail.updated_at)}</span></Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">子部件</h2>
                <span className="text-xs text-slate-400">{detail.children.length} 个</span>
              </div>
              <div className="max-h-[520px] overflow-auto p-3">
                {detail.children.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                    当前 TAG 暂无子部件
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detail.children.map((child) => (
                      <React.Fragment key={child.id}>
                        {renderTagNavigation(child.id, (
                          <>
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                          <Puzzle className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-slate-800">{child.tag_no}</div>
                          <div className="truncate text-xs text-slate-500">{child.name}</div>
                        </div>
                          </>
                        ), 'flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 text-left transition hover:border-adnoc-blue/30 hover:bg-white')}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'attributes' ? (
          <div className="space-y-6">
            {isLoadingAttributeDefinitions ? (
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-400 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载属性定义...
              </div>
            ) : null}
            {attributeDefinitionError ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
                {attributeDefinitionError}
              </div>
            ) : null}
            {renderAttributeRows(commonAttributes, '公共属性')}
            {renderAttributeRows(classAttributes, selectedClass ? `${selectedClass.name} 专属属性` : 'Class 专属属性')}
            {otherAttributes.length > 0 ? (
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="font-semibold text-slate-900">未匹配属性定义的属性值</h3>
                </div>
                <div className="grid gap-4 p-5 md:grid-cols-2">
                  {otherAttributes.map(([code, value]) => (
                    <Field key={code} label={code}>
                      {isEditing ? (
                        <input value={String(value ?? '')} onChange={(event) => updateAttributeValue(code, event.target.value)} className={inputClass} />
                      ) : (
                        <span>{displayValue(value)}</span>
                      )}
                    </Field>
                  ))}
                </div>
              </section>
            ) : null}
            {knownAttributes.length === 0 && otherAttributes.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
                当前 TAG 暂无属性数据
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'equipment' ? renderEquipmentImplementationTab() : null}

        {activeTab === 'relations' ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">关联图纸</h2>
                <span className="text-xs text-slate-400">{detail.linked_documents.length} 张</span>
              </div>
              <div className="p-3">
                {detail.linked_documents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                    暂无关联图纸
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detail.linked_documents.map((document) => (
                      <button
                        key={document.id}
                        type="button"
                        onClick={() => {
                          if (onOpenDocuments) {
                            onOpenDocuments();
                            return;
                          }
                          navigate(`/projects/${projectId}?view=documents`);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 text-left transition hover:border-adnoc-blue/30 hover:bg-white"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-adnoc-blue/10 text-adnoc-blue">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-sm text-slate-800">{document.document_no}</div>
                          <div className="truncate text-xs text-slate-500">{document.title}</div>
                        </div>
                        <span className="text-xs text-slate-400">{document.current_revision_no || '-'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">项目关系</h2>
                <span className="text-xs text-slate-400">{detail.relations.length} 条</span>
              </div>
              <div className="p-3">
                {detail.relations.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                    暂无项目关系
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detail.relations.map((relation) => {
                      const direction = relation.source_kind === 'tag' && relation.source_id === detail.id ? 'outbound' : 'inbound';
                      return (
                        <div key={relation.id} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-800">{relation.relation_type_name}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                              {direction === 'outbound' ? '向外' : '向内'}
                            </span>
                          </div>
                          <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                            <div>
                              <span className="text-slate-400">Source</span>
                              <div className="mt-0.5 truncate text-slate-700">
                                {relation.source_kind}: {relationEndpointLabel(relation, 'source')}
                              </div>
                            </div>
                            <div>
                              <span className="text-slate-400">Target</span>
                              <div className="mt-0.5 truncate text-slate-700">
                                {relation.target_kind}: {relationEndpointLabel(relation, 'target')}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-500">{label}</span>
      <div className="min-h-10 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-sm text-slate-700">
        {children}
      </div>
    </label>
  );
}
