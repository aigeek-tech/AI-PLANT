import { useEffect, useMemo, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, FileText, FolderTree, ListChecks, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { PermissionGate } from '../../auth/PermissionGate';
import { Card } from '../../components/ui/Card';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { DefinitionField, DefinitionModal, definitionInputClass } from '../../components/standards/DefinitionModal';
import { DefinitionTree, type DefinitionTreeNode } from '../../components/standards/DefinitionTree';
import { useDialog } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';
import {
  archiveStandardClassDocumentRequirement,
  archiveStandardDiscipline,
  archiveStandardDisciplineDocumentType,
  createStandardClassDocumentRequirement,
  createStandardDiscipline,
  createStandardDisciplineDocumentType,
  getDocumentTypes,
  getStandardClassDocumentRequirements,
  getStandardDisciplineDocumentTypes,
  getStandardDisciplines,
  updateStandardClassDocumentRequirement,
  updateStandardDiscipline,
  updateStandardDisciplineDocumentType,
  type ClassDocumentRequirement,
  type ClassDocumentRequirementPayload,
  type Discipline,
  type DisciplineDocumentType,
  type DisciplineDocumentTypePayload,
  type DisciplinePayload,
  type DocumentType,
  type PaginatedDeliveryRules,
  type StandardDetail,
} from '../../lib/api';

const PAGE_SIZE = 25;

type RuleStatus = 'active' | 'deprecated' | 'archived';
type DeliverySection = 'disciplines' | 'disciplineRules' | 'classRequirements';
type ClassScope = 'tag' | 'equipment';
type StandardClass = StandardDetail['classes'][number];

interface DisciplineDraft {
  cfihos_unique_code: string;
  code: string;
  name: string;
  description: string;
  status: RuleStatus;
}

interface DisciplineRuleDraft {
  discipline_id: string;
  document_type_id: string;
  cfihos_unique_code: string;
  short_code: string;
  asset_scope: string;
  representation_type: string;
  native_file_delivery_timing: string;
  perspective: string;
  lifecycle_phase: string;
  status: RuleStatus;
}

interface ClassRequirementDraft {
  class_id: string;
  document_type_id: string;
  cfihos_unique_code: string;
  asset_scope: string;
  source_standard_cfihos_code: string;
  source_standard_code: string;
  perspective: string;
  lifecycle_phase: string;
  status: RuleStatus;
}

type DeliveryEditor =
  | { kind: 'discipline'; item?: Discipline; draft: DisciplineDraft }
  | { kind: 'disciplineRule'; item?: DisciplineDocumentType; draft: DisciplineRuleDraft }
  | { kind: 'classRequirement'; item?: ClassDocumentRequirement; draft: ClassRequirementDraft };

interface ClassOption {
  value: string;
  label: string;
  code: string;
  name: string;
  description: string;
  level_no: number;
  domain: ClassScope;
  keywords: string;
}

interface DeliveryRulesManagerProps {
  standardId: string;
  standard: StandardDetail;
  showClassCodes: boolean;
  onOpenDocumentTypes: () => void;
}

function emptyPage<TItem>(): PaginatedDeliveryRules<TItem> {
  return { items: [], page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 };
}

function blankToNull(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function formatRuleValue(value: string | null | undefined) {
  if (!value) return '-';
  return value.replace(/_/g, ' ');
}

function codeLabel(code: string | null | undefined, name: string | null | undefined) {
  if (code && name) return `${code} · ${name}`;
  return code || name || '-';
}

function matchesQuery(value: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return !normalizedQuery || value.toLowerCase().includes(normalizedQuery);
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

function disciplineDraft(item?: Discipline): DisciplineDraft {
  return {
    cfihos_unique_code: item?.cfihos_unique_code ?? '',
    code: item?.code ?? '',
    name: item?.name ?? '',
    description: item?.description ?? '',
    status: (item?.status as RuleStatus) ?? 'active',
  };
}

function disciplineRuleDraft(
  disciplines: Discipline[],
  documentTypes: DocumentType[],
  selectedDisciplineId: string,
  selectedAssetScope: string,
  item?: DisciplineDocumentType,
): DisciplineRuleDraft {
  return {
    discipline_id: item?.discipline_id ?? selectedDisciplineId ?? disciplines[0]?.id ?? '',
    document_type_id: item?.document_type_id ?? documentTypes[0]?.id ?? '',
    cfihos_unique_code: item?.cfihos_unique_code ?? '',
    short_code: item?.short_code ?? '',
    asset_scope: item?.asset_scope ?? selectedAssetScope ?? '',
    representation_type: item?.representation_type ?? '',
    native_file_delivery_timing: item?.native_file_delivery_timing ?? '',
    perspective: item?.perspective ?? 'standard',
    lifecycle_phase: item?.lifecycle_phase ?? 'unspecified',
    status: (item?.status as RuleStatus) ?? 'active',
  };
}

function classRequirementDraft(
  classOptions: Array<{ value: string }>,
  documentTypes: DocumentType[],
  selectedClassId: string,
  selectedAssetScope: string,
  item?: ClassDocumentRequirement,
): ClassRequirementDraft {
  return {
    class_id: item?.class_id ?? selectedClassId ?? classOptions[0]?.value ?? '',
    document_type_id: item?.document_type_id ?? documentTypes[0]?.id ?? '',
    cfihos_unique_code: item?.cfihos_unique_code ?? '',
    asset_scope: item?.asset_scope ?? selectedAssetScope ?? '',
    source_standard_cfihos_code: item?.source_standard_cfihos_code ?? '',
    source_standard_code: item?.source_standard_code ?? '',
    perspective: item?.perspective ?? 'standard',
    lifecycle_phase: item?.lifecycle_phase ?? 'unspecified',
    status: (item?.status as RuleStatus) ?? 'active',
  };
}

function toDisciplinePayload(draft: DisciplineDraft): DisciplinePayload {
  return {
    cfihos_unique_code: blankToNull(draft.cfihos_unique_code),
    code: draft.code.trim(),
    name: draft.name.trim(),
    description: blankToNull(draft.description),
    status: draft.status,
    metadata: {},
  };
}

function toDisciplineRulePayload(draft: DisciplineRuleDraft): DisciplineDocumentTypePayload {
  return {
    discipline_id: draft.discipline_id,
    document_type_id: draft.document_type_id,
    cfihos_unique_code: blankToNull(draft.cfihos_unique_code),
    short_code: blankToNull(draft.short_code),
    asset_scope: blankToNull(draft.asset_scope),
    representation_type: blankToNull(draft.representation_type),
    native_file_delivery_timing: blankToNull(draft.native_file_delivery_timing),
    perspective: draft.perspective.trim() || 'standard',
    lifecycle_phase: draft.lifecycle_phase.trim() || 'unspecified',
    status: draft.status,
    metadata: {},
  };
}

function toClassRequirementPayload(draft: ClassRequirementDraft): ClassDocumentRequirementPayload {
  return {
    class_id: draft.class_id,
    document_type_id: draft.document_type_id,
    cfihos_unique_code: blankToNull(draft.cfihos_unique_code),
    asset_scope: blankToNull(draft.asset_scope),
    source_standard_cfihos_code: blankToNull(draft.source_standard_cfihos_code),
    source_standard_code: blankToNull(draft.source_standard_code),
    perspective: draft.perspective.trim() || 'standard',
    lifecycle_phase: draft.lifecycle_phase.trim() || 'unspecified',
    status: draft.status,
    metadata: {},
  };
}

export function DeliveryRulesManager({ standardId, standard, showClassCodes, onOpenDocumentTypes }: DeliveryRulesManagerProps) {
  const { confirm } = useDialog();
  const { error: showError } = useToast();
  const [activeSection, setActiveSection] = useState<DeliverySection>('disciplines');
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [disciplineRules, setDisciplineRules] = useState<PaginatedDeliveryRules<DisciplineDocumentType>>(emptyPage());
  const [classRequirements, setClassRequirements] = useState<PaginatedDeliveryRules<ClassDocumentRequirement>>(emptyPage());
  const [selectedDisciplineId, setSelectedDisciplineId] = useState('');
  const [selectedClassScope, setSelectedClassScope] = useState<ClassScope>('tag');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedAssetScope, setSelectedAssetScope] = useState('');
  const [disciplineSearch, setDisciplineSearch] = useState('');
  const [disciplineRulePage, setDisciplineRulePage] = useState(1);
  const [classRequirementPage, setClassRequirementPage] = useState(1);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editor, setEditor] = useState<DeliveryEditor | null>(null);
  const [isSavingEditor, setIsSavingEditor] = useState(false);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(true);
  const [isDisciplineRulesLoading, setIsDisciplineRulesLoading] = useState(false);
  const [isClassRequirementsLoading, setIsClassRequirementsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tagClassOptions = useMemo<ClassOption[]>(
    () => standard.classes.map((item) => ({
      value: item.id,
      label: codeLabel(item.code, item.name),
      code: item.code,
      name: item.name,
      description: item.description ?? '',
      level_no: item.level_no,
      domain: 'tag',
      keywords: `${item.code} ${item.name} ${item.description ?? ''}`,
    })),
    [standard.classes],
  );
  const equipmentClassOptions = useMemo<ClassOption[]>(
    () => (standard.equipment_classes ?? []).map((item) => ({
      value: item.id,
      label: codeLabel(item.code, item.name),
      code: item.code,
      name: item.name,
      description: item.description ?? '',
      level_no: item.level_no,
      domain: 'equipment',
      keywords: `${item.code} ${item.name} ${item.description ?? ''}`,
    })),
    [standard.equipment_classes],
  );
  const activeClassOptions = selectedClassScope === 'tag' ? tagClassOptions : equipmentClassOptions;
  const activeClassTree = useMemo(
    () => buildClassTree(selectedClassScope === 'tag' ? standard.classes : (standard.equipment_classes ?? [])),
    [selectedClassScope, standard.classes, standard.equipment_classes],
  );
  const allClassOptions = useMemo(() => [...tagClassOptions, ...equipmentClassOptions], [equipmentClassOptions, tagClassOptions]);
  const selectedDiscipline = disciplines.find((discipline) => discipline.id === selectedDisciplineId) ?? null;
  const selectedClass = activeClassOptions.find((item) => item.value === selectedClassId) ?? null;

  const disciplineOptions = disciplines.map((discipline) => ({
    value: discipline.id,
    label: codeLabel(discipline.code, discipline.name),
    keywords: `${discipline.cfihos_unique_code ?? ''} ${discipline.description ?? ''}`,
  }));
  const documentTypeOptions = documentTypes.map((type) => ({
    value: type.id,
    label: codeLabel(type.code, type.name),
    keywords: type.description ?? '',
  }));
  const assetScopeOptions = Array.from(new Set(['tag', 'equipment', 'model_part', 'plant', 'process_unit', 'site', selectedAssetScope].filter(Boolean) as string[]))
    .map((value) => ({ value, label: formatRuleValue(value) }));

  useEffect(() => {
    let cancelled = false;

    async function loadDictionaries() {
      setIsDirectoryLoading(true);
      setError(null);
      try {
        const [nextDisciplines, nextDocumentTypes] = await Promise.all([
          getStandardDisciplines(standardId),
          getDocumentTypes(standardId),
        ]);
        if (cancelled) return;
        setDisciplines(nextDisciplines);
        setDocumentTypes(nextDocumentTypes);
      } catch {
        if (!cancelled) setError('加载交付规则基础数据失败，请稍后重试。');
      } finally {
        if (!cancelled) setIsDirectoryLoading(false);
      }
    }

    void loadDictionaries();
    return () => {
      cancelled = true;
    };
  }, [standardId, reloadVersion]);

  useEffect(() => {
    setDisciplineRulePage(1);
    setClassRequirementPage(1);
  }, [activeSection, selectedDisciplineId, selectedClassId, selectedClassScope, selectedAssetScope]);

  useEffect(() => {
    if (activeSection !== 'disciplineRules') return;
    if (disciplines.length === 0) {
      if (selectedDisciplineId) setSelectedDisciplineId('');
      return;
    }
    if (!selectedDisciplineId || !disciplines.some((discipline) => discipline.id === selectedDisciplineId)) {
      setSelectedDisciplineId(disciplines[0].id);
    }
  }, [activeSection, disciplines, selectedDisciplineId]);

  useEffect(() => {
    if (activeSection !== 'classRequirements') return;
    if (activeClassOptions.length === 0) {
      if (selectedClassId) setSelectedClassId('');
      return;
    }
    if (!selectedClassId || !activeClassOptions.some((item) => item.value === selectedClassId)) {
      setSelectedClassId(activeClassOptions[0].value);
    }
  }, [activeClassOptions, activeSection, selectedClassId]);

  useEffect(() => {
    let cancelled = false;

    async function loadDisciplineRules() {
      if (activeSection !== 'disciplineRules' || !selectedDisciplineId) {
        setDisciplineRules(emptyPage());
        setIsDisciplineRulesLoading(false);
        return;
      }
      setIsDisciplineRulesLoading(true);
      setError(null);
      try {
        const nextRules = await getStandardDisciplineDocumentTypes(standardId, {
          discipline_id: selectedDisciplineId,
          asset_scope: selectedAssetScope || undefined,
          page: disciplineRulePage,
          page_size: PAGE_SIZE,
        });
        if (!cancelled) setDisciplineRules(nextRules);
      } catch {
        if (!cancelled) setError('加载专业文档规则失败，请稍后重试。');
      } finally {
        if (!cancelled) setIsDisciplineRulesLoading(false);
      }
    }

    void loadDisciplineRules();
    return () => {
      cancelled = true;
    };
  }, [activeSection, disciplineRulePage, selectedAssetScope, selectedDisciplineId, standardId, reloadVersion]);

  useEffect(() => {
    let cancelled = false;

    async function loadClassRequirements() {
      if (activeSection !== 'classRequirements' || !selectedClassId) {
        setClassRequirements(emptyPage());
        setIsClassRequirementsLoading(false);
        return;
      }
      setIsClassRequirementsLoading(true);
      setError(null);
      try {
        const nextRequirements = await getStandardClassDocumentRequirements(standardId, {
          class_id: selectedClassId,
          asset_scope: selectedAssetScope || undefined,
          page: classRequirementPage,
          page_size: PAGE_SIZE,
        });
        if (!cancelled) setClassRequirements(nextRequirements);
      } catch {
        if (!cancelled) setError('加载对象类别文档要求失败，请稍后重试。');
      } finally {
        if (!cancelled) setIsClassRequirementsLoading(false);
      }
    }

    void loadClassRequirements();
    return () => {
      cancelled = true;
    };
  }, [activeSection, classRequirementPage, selectedAssetScope, selectedClassId, standardId, reloadVersion]);

  const updateEditorDraft = (field: string, value: string) => {
    setEditor((current) => (current ? ({ ...current, draft: { ...current.draft, [field]: value } } as DeliveryEditor) : current));
  };

  const refreshRules = () => setReloadVersion((current) => current + 1);

  const openDocumentTypesFromRules = () => {
    setEditor(null);
    onOpenDocumentTypes();
  };

  const startCreateDisciplineRule = () => {
    const disciplineId = selectedDisciplineId || disciplines[0]?.id || '';
    if (!disciplineId) {
      showError('请先维护专业目录。');
      return;
    }
    if (documentTypes.length === 0) {
      showError('请先维护文档类型。');
      return;
    }
    setEditor({
      kind: 'disciplineRule',
      draft: disciplineRuleDraft(disciplines, documentTypes, disciplineId, selectedAssetScope),
    });
  };

  const startCreateClassRequirement = () => {
    const classId = selectedClassId || activeClassOptions[0]?.value || allClassOptions[0]?.value || '';
    if (!classId) {
      showError('请先维护 Tag Class 或 Equipment Class。');
      return;
    }
    if (documentTypes.length === 0) {
      showError('请先维护文档类型。');
      return;
    }
    setEditor({
      kind: 'classRequirement',
      draft: classRequirementDraft(allClassOptions, documentTypes, classId, selectedAssetScope),
    });
  };

  const saveEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setIsSavingEditor(true);
    try {
      if (editor.kind === 'discipline') {
        if (!editor.draft.code.trim() || !editor.draft.name.trim()) {
          showError('专业编码和名称不能为空。');
          return;
        }
        if (editor.item) {
          await updateStandardDiscipline(standardId, editor.item.id, toDisciplinePayload(editor.draft));
        } else {
          await createStandardDiscipline(standardId, toDisciplinePayload(editor.draft));
        }
      } else if (editor.kind === 'disciplineRule') {
        if (!editor.draft.discipline_id || !editor.draft.document_type_id) {
          showError('专业和文档类型不能为空。');
          return;
        }
        if (editor.item) {
          await updateStandardDisciplineDocumentType(standardId, editor.item.id, toDisciplineRulePayload(editor.draft));
        } else {
          await createStandardDisciplineDocumentType(standardId, toDisciplineRulePayload(editor.draft));
        }
      } else {
        if (!editor.draft.class_id || !editor.draft.document_type_id) {
          showError('对象类别和文档类型不能为空。');
          return;
        }
        if (editor.item) {
          await updateStandardClassDocumentRequirement(standardId, editor.item.id, toClassRequirementPayload(editor.draft));
        } else {
          await createStandardClassDocumentRequirement(standardId, toClassRequirementPayload(editor.draft));
        }
      }
      setEditor(null);
      refreshRules();
    } catch (saveError) {
      showError('保存交付规则失败: ' + (saveError instanceof Error ? saveError.message : String(saveError)));
    } finally {
      setIsSavingEditor(false);
    }
  };

  const archiveItem = async (kind: DeliveryEditor['kind'], id: string) => {
    const accepted = await confirm({
      title: '归档配置',
      description: '确认归档这条配置吗？归档后不会继续作为有效规则使用。',
      confirmText: '归档',
      danger: true,
    });
    if (!accepted) return;
    try {
      if (kind === 'discipline') {
        await archiveStandardDiscipline(standardId, id);
        if (selectedDisciplineId === id) setSelectedDisciplineId('');
      } else if (kind === 'disciplineRule') {
        await archiveStandardDisciplineDocumentType(standardId, id);
      } else {
        await archiveStandardClassDocumentRequirement(standardId, id);
      }
      refreshRules();
    } catch (archiveError) {
      showError('归档失败: ' + (archiveError instanceof Error ? archiveError.message : String(archiveError)));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 animate-fade-in">
      <DeliveryRuleHeader
        activeSection={activeSection}
        disciplineCount={disciplines.length}
        selectedAssetScope={selectedAssetScope}
        assetScopeOptions={assetScopeOptions}
        onSectionChange={setActiveSection}
        onAssetScopeChange={setSelectedAssetScope}
      />

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}

      {activeSection === 'disciplines' && (
        <DisciplineCatalog
          disciplines={disciplines}
          disciplineSearch={disciplineSearch}
          isLoading={isDirectoryLoading}
          standardId={standardId}
          onSearchChange={setDisciplineSearch}
          onCreate={() => setEditor({ kind: 'discipline', draft: disciplineDraft() })}
          onEdit={(discipline) => setEditor({ kind: 'discipline', item: discipline, draft: disciplineDraft(discipline) })}
          onArchive={(disciplineId) => void archiveItem('discipline', disciplineId)}
        />
      )}

      {activeSection === 'disciplineRules' && (
        <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <DisciplinePickerPanel
            disciplines={disciplines}
            selectedDisciplineId={selectedDisciplineId}
            disciplineSearch={disciplineSearch}
            isLoading={isDirectoryLoading}
            onSelect={setSelectedDisciplineId}
            onSearchChange={setDisciplineSearch}
          />
          <div className="min-w-0 space-y-4">
            <RuleWorkspaceHeader
              title="专业-文档类型"
              selectedLabel={selectedDiscipline ? codeLabel(selectedDiscipline.code, selectedDiscipline.name) : '未选择专业'}
              total={disciplineRules.total}
              addLabel="新增关联"
              standardId={standardId}
              onAdd={startCreateDisciplineRule}
              onOpenDocumentTypes={openDocumentTypesFromRules}
            />
            <DisciplineRulesTable
              page={disciplineRules}
              standardId={standardId}
              isLoading={isDisciplineRulesLoading}
              onPageChange={setDisciplineRulePage}
              onEdit={(rule) => setEditor({ kind: 'disciplineRule', item: rule, draft: disciplineRuleDraft(disciplines, documentTypes, selectedDisciplineId, selectedAssetScope, rule) })}
              onArchive={(ruleId) => void archiveItem('disciplineRule', ruleId)}
            />
          </div>
        </div>
      )}

      {activeSection === 'classRequirements' && (
        <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <ClassPickerPanel
            classTree={activeClassTree}
            classOptions={activeClassOptions}
            selectedClassId={selectedClassId}
            selectedClassScope={selectedClassScope}
            showClassCodes={showClassCodes}
            onScopeChange={setSelectedClassScope}
            onSelect={setSelectedClassId}
          />
          <div className="min-w-0 space-y-4">
            <RuleWorkspaceHeader
              title="对象类别-文档要求"
              selectedLabel={selectedClass?.label ?? '未选择对象类别'}
              total={classRequirements.total}
              addLabel="新增要求"
              standardId={standardId}
              onAdd={startCreateClassRequirement}
              onOpenDocumentTypes={openDocumentTypesFromRules}
            />
            <ClassRequirementsTable
              page={classRequirements}
              standardId={standardId}
              isLoading={isClassRequirementsLoading}
              onPageChange={setClassRequirementPage}
              onEdit={(rule) => setEditor({ kind: 'classRequirement', item: rule, draft: classRequirementDraft(allClassOptions, documentTypes, selectedClassId, selectedAssetScope, rule) })}
              onArchive={(ruleId) => void archiveItem('classRequirement', ruleId)}
            />
          </div>
        </div>
      )}

      {editor && (
        <DeliveryRuleEditorModal
          editor={editor}
          disciplineOptions={disciplineOptions}
          documentTypeOptions={documentTypeOptions}
          classOptions={allClassOptions}
          assetScopeOptions={assetScopeOptions}
          isSaving={isSavingEditor}
          onChange={updateEditorDraft}
          onSubmit={saveEditor}
          onClose={() => setEditor(null)}
          onOpenDocumentTypes={openDocumentTypesFromRules}
        />
      )}
    </div>
  );
}

function DeliveryRuleHeader({
  activeSection,
  disciplineCount,
  selectedAssetScope,
  assetScopeOptions,
  onSectionChange,
  onAssetScopeChange,
}: {
  activeSection: DeliverySection;
  disciplineCount: number;
  selectedAssetScope: string;
  assetScopeOptions: Array<{ value: string; label: string }>;
  onSectionChange: (section: DeliverySection) => void;
  onAssetScopeChange: (scope: string) => void;
}) {
  const sections: Array<{ value: DeliverySection; label: string; icon: typeof FolderTree; count?: number }> = [
    { value: 'disciplines', label: '专业目录', icon: FolderTree, count: disciplineCount },
    { value: 'disciplineRules', label: '专业文档规则', icon: FileText },
    { value: 'classRequirements', label: '对象类别文档要求', icon: ListChecks },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/75 p-2 shadow-sm">
      <div className="flex flex-wrap gap-1">
        {sections.map((section) => {
          const Icon = section.icon;
          const active = activeSection === section.value;
          return (
            <button
              key={section.value}
              type="button"
              onClick={() => onSectionChange(section.value)}
              className={clsx(
                'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition',
                active ? 'bg-adnoc-blue text-white shadow-sm shadow-adnoc-blue/20' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
              )}
            >
              <Icon className="h-4 w-4" />
              {section.label}
              {section.count !== undefined && <span className={clsx('rounded-full px-2 py-0.5 text-xs', active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>{section.count}</span>}
            </button>
          );
        })}
      </div>
      {activeSection !== 'disciplines' && (
        <div className="ml-auto flex min-w-[220px] flex-wrap items-center gap-2">
          <div className="w-56">
            <SearchableSelect
              value={selectedAssetScope}
              options={assetScopeOptions}
              onChange={onAssetScopeChange}
              placeholder="全部资产范围"
              searchPlaceholder="搜索资产范围"
              emptyMessage="没有匹配的资产范围"
              clearable
            />
          </div>
          {selectedAssetScope && (
            <button
              type="button"
              onClick={() => onAssetScopeChange('')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 transition hover:border-adnoc-blue/40 hover:text-adnoc-blue"
            >
              <X className="h-3.5 w-3.5" />
              清除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SearchBox({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-9 py-2 text-sm text-slate-700 outline-none transition focus:border-adnoc-blue focus:bg-white focus:ring-2 focus:ring-adnoc-blue/10"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  );
}

function DisciplineCatalog({
  disciplines,
  disciplineSearch,
  isLoading,
  standardId,
  onSearchChange,
  onCreate,
  onEdit,
  onArchive,
}: {
  disciplines: Discipline[];
  disciplineSearch: string;
  isLoading: boolean;
  standardId: string;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onEdit: (discipline: Discipline) => void;
  onArchive: (id: string) => void;
}) {
  const visibleDisciplines = disciplines.filter((discipline) => matchesQuery(`${discipline.code} ${discipline.name} ${discipline.cfihos_unique_code ?? ''} ${discipline.description ?? ''}`, disciplineSearch));

  return (
    <Card className="flex min-h-[520px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-base font-black text-slate-900">专业目录</h3>
          <div className="mt-1 text-xs font-bold text-slate-400">{visibleDisciplines.length} / {disciplines.length}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-64">
            <SearchBox value={disciplineSearch} placeholder="搜索专业" onChange={onSearchChange} />
          </div>
          <PermissionGate permission="standard.write" scopeId={standardId}>
            <button type="button" onClick={onCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-adnoc-blue px-3 py-2 text-xs font-bold text-white shadow-sm shadow-adnoc-blue/20">
              <Plus className="h-3.5 w-3.5" />
              新增专业
            </button>
          </PermissionGate>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="w-[180px] px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="w-[140px] px-4 py-3 text-right">维护</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {isLoading && (
              <tr>
                <td colSpan={4} className="py-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-adnoc-blue" />
                </td>
              </tr>
            )}
            {!isLoading && visibleDisciplines.map((discipline) => (
              <tr key={discipline.id} className="align-top hover:bg-blue-50/40">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs font-bold text-adnoc-blue">{discipline.code}</div>
                  {discipline.cfihos_unique_code && <div className="mt-1 font-mono text-[10px] text-slate-400">{discipline.cfihos_unique_code}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{discipline.name}</div>
                  <div className="mt-1 text-xs font-bold text-slate-400">{formatRuleValue(discipline.status)}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{discipline.description || '-'}</td>
                <td className="px-4 py-3 text-right">
                  <PermissionGate permission="standard.write" scopeId={standardId}>
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => onEdit(discipline)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-adnoc-blue">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => onArchive(discipline.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </PermissionGate>
                </td>
              </tr>
            ))}
            {!isLoading && visibleDisciplines.length === 0 && (
              <tr>
                <td colSpan={4} className="py-24 text-center text-sm font-semibold text-slate-400">暂无专业目录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DisciplinePickerPanel({
  disciplines,
  selectedDisciplineId,
  disciplineSearch,
  isLoading,
  onSelect,
  onSearchChange,
}: {
  disciplines: Discipline[];
  selectedDisciplineId: string;
  disciplineSearch: string;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onSearchChange: (value: string) => void;
}) {
  const visibleDisciplines = disciplines.filter((discipline) => matchesQuery(`${discipline.code} ${discipline.name} ${discipline.cfihos_unique_code ?? ''} ${discipline.description ?? ''}`, disciplineSearch));

  return (
    <Card className="flex min-h-[420px] flex-col overflow-hidden">
      <div className="space-y-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">专业</h3>
          <span className="text-xs font-bold text-slate-400">{visibleDisciplines.length} / {disciplines.length}</span>
        </div>
        <SearchBox value={disciplineSearch} placeholder="搜索专业" onChange={onSearchChange} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {isLoading ? (
          <div className="flex h-56 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-adnoc-blue" />
          </div>
        ) : visibleDisciplines.length > 0 ? (
          <div className="space-y-1">
            {visibleDisciplines.map((discipline) => (
              <button
                key={discipline.id}
                type="button"
                onClick={() => onSelect(discipline.id)}
                className={clsx(
                  'w-full rounded-xl px-3 py-2.5 text-left transition',
                  selectedDisciplineId === discipline.id ? 'bg-adnoc-blue text-white shadow-sm shadow-adnoc-blue/20' : 'hover:bg-slate-50',
                )}
              >
                <div className={clsx('font-mono text-xs font-bold', selectedDisciplineId === discipline.id ? 'text-white' : 'text-adnoc-blue')}>{discipline.code}</div>
                <div className={clsx('mt-1 line-clamp-2 text-sm font-semibold', selectedDisciplineId === discipline.id ? 'text-white' : 'text-slate-800')}>{discipline.name}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-sm font-semibold text-slate-400">暂无专业</div>
        )}
      </div>
    </Card>
  );
}

function ClassPickerPanel({
  classTree,
  classOptions,
  selectedClassId,
  selectedClassScope,
  showClassCodes,
  onScopeChange,
  onSelect,
}: {
  classTree: DefinitionTreeNode[];
  classOptions: ClassOption[];
  selectedClassId: string;
  selectedClassScope: ClassScope;
  showClassCodes: boolean;
  onScopeChange: (scope: ClassScope) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-h-[420px] flex-col gap-3 xl:min-h-0">
      <div className="rounded-2xl border border-slate-200 bg-white/75 p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">对象类别</h3>
          <span className="text-xs font-bold text-slate-400">{classOptions.length} 项</span>
        </div>
        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-xs font-bold">
          {(['tag', 'equipment'] as ClassScope[]).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => onScopeChange(scope)}
              className={clsx(
                'rounded-lg px-2 py-1.5 transition',
                selectedClassScope === scope ? 'bg-white text-adnoc-blue shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {scope === 'tag' ? 'Tag Class' : 'Equipment Class'}
            </button>
          ))}
        </div>
      </div>
      <DefinitionTree
        title="对象类别"
        titleIcon={<FolderTree className="h-5 w-5 text-slate-300" />}
        commonLabel=""
        commonSelected={false}
        selectedId={selectedClassId || null}
        nodes={classTree}
        rootActionLabel=""
        childActionLabel=""
        searchPlaceholder="搜索 Class 编码或名称"
        showTitle={false}
        showCommon={false}
        showRootAction={false}
        showSelectedActions={false}
        showNodeCodes={showClassCodes}
        allowDragDrop={false}
        onSelectCommon={() => undefined}
        onSelectNode={onSelect}
        onMove={() => undefined}
        onAddRoot={() => undefined}
        onAddChild={() => undefined}
        onEditNode={onSelect}
      />
    </div>
  );
}

function RuleWorkspaceHeader({
  title,
  selectedLabel,
  total,
  addLabel,
  standardId,
  onAdd,
  onOpenDocumentTypes,
}: {
  title: string;
  selectedLabel: string;
  total: number;
  addLabel: string;
  standardId: string;
  onAdd: () => void;
  onOpenDocumentTypes: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-400">
          <span className="max-w-[520px] truncate text-slate-600">{selectedLabel}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5">{total} 条</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenDocumentTypes}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-adnoc-blue/40 hover:text-adnoc-blue"
        >
          <FileText className="h-3.5 w-3.5" />
          文档类型维护
        </button>
        <PermissionGate permission="standard.write" scopeId={standardId}>
          <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-adnoc-blue px-3 py-2 text-xs font-bold text-white shadow-sm shadow-adnoc-blue/20">
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </button>
        </PermissionGate>
      </div>
    </div>
  );
}

function RulePager({
  page,
  onPageChange,
}: {
  page: PaginatedDeliveryRules<DisciplineDocumentType> | PaginatedDeliveryRules<ClassDocumentRequirement>;
  onPageChange: (page: number) => void;
}) {
  if (page.total === 0) return null;
  const start = (page.page - 1) * page.page_size + 1;
  const end = Math.min(page.total, page.page * page.page_size);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs font-bold text-slate-500">
      <span>{start}-{end} / {page.total}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page.page - 1))}
          disabled={page.page <= 1}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          上一页
        </button>
        <span>{page.page} / {page.total_pages}</span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(page.total_pages, page.page + 1))}
          disabled={page.page >= page.total_pages}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function DisciplineRulesTable({
  page,
  standardId,
  isLoading,
  onPageChange,
  onEdit,
  onArchive,
}: {
  page: PaginatedDeliveryRules<DisciplineDocumentType>;
  standardId: string;
  isLoading: boolean;
  onPageChange: (page: number) => void;
  onEdit: (rule: DisciplineDocumentType) => void;
  onArchive: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-auto">
        <table className="min-w-[1040px] divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">Document Type</th>
              <th className="px-4 py-3 text-left">Scope</th>
              <th className="px-4 py-3 text-left">Representation</th>
              <th className="px-4 py-3 text-left">Lifecycle</th>
              <th className="px-4 py-3 text-right">维护</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {isLoading && (
              <tr>
                <td colSpan={5} className="py-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-adnoc-blue" />
                </td>
              </tr>
            )}
            {!isLoading && page.items.map((rule) => (
              <tr key={rule.id} className="hover:bg-blue-50/40">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{codeLabel(rule.document_type_code, rule.document_type_name)}</div>
                  {rule.short_code && <div className="mt-1 font-mono text-xs text-slate-400">{rule.short_code}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatRuleValue(rule.asset_scope)}</td>
                <td className="px-4 py-3 text-slate-600">{formatRuleValue(rule.representation_type)}</td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{formatRuleValue(rule.lifecycle_phase)}</div>
                  {rule.native_file_delivery_timing && <div className="mt-1 text-xs text-slate-400">{rule.native_file_delivery_timing}</div>}
                </td>
                <td className="px-4 py-3 text-right">
                  <PermissionGate permission="standard.write" scopeId={standardId}>
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => onEdit(rule)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-adnoc-blue">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => onArchive(rule.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </PermissionGate>
                </td>
              </tr>
            ))}
            {!isLoading && page.items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-24 text-center text-sm font-semibold text-slate-400">暂无专业文档类型规则</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RulePager page={page} onPageChange={onPageChange} />
    </Card>
  );
}

function ClassRequirementsTable({
  page,
  standardId,
  isLoading,
  onPageChange,
  onEdit,
  onArchive,
}: {
  page: PaginatedDeliveryRules<ClassDocumentRequirement>;
  standardId: string;
  isLoading: boolean;
  onPageChange: (page: number) => void;
  onEdit: (rule: ClassDocumentRequirement) => void;
  onArchive: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-auto">
        <table className="min-w-[1040px] divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">Document Type</th>
              <th className="px-4 py-3 text-left">Scope</th>
              <th className="px-4 py-3 text-left">Source</th>
              <th className="px-4 py-3 text-left">Lifecycle</th>
              <th className="px-4 py-3 text-right">维护</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {isLoading && (
              <tr>
                <td colSpan={5} className="py-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-adnoc-blue" />
                </td>
              </tr>
            )}
            {!isLoading && page.items.map((rule) => (
              <tr key={rule.id} className="hover:bg-blue-50/40">
                <td className="px-4 py-3 font-semibold text-slate-800">{codeLabel(rule.document_type_code, rule.document_type_name)}</td>
                <td className="px-4 py-3 text-slate-600">{formatRuleValue(rule.asset_scope)}</td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{rule.source_standard_code || '-'}</div>
                  {rule.source_standard_cfihos_code && <div className="mt-1 font-mono text-xs text-slate-400">{rule.source_standard_cfihos_code}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatRuleValue(rule.lifecycle_phase)}</td>
                <td className="px-4 py-3 text-right">
                  <PermissionGate permission="standard.write" scopeId={standardId}>
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => onEdit(rule)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-adnoc-blue">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => onArchive(rule.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </PermissionGate>
                </td>
              </tr>
            ))}
            {!isLoading && page.items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-24 text-center text-sm font-semibold text-slate-400">暂无对象类别文档要求</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RulePager page={page} onPageChange={onPageChange} />
    </Card>
  );
}

function DocumentTypeField({
  value,
  options,
  onChange,
  onOpenDocumentTypes,
}: {
  value: string;
  options: Array<{ value: string; label: string; keywords?: string }>;
  onChange: (value: string) => void;
  onOpenDocumentTypes: () => void;
}) {
  return (
    <DefinitionField label="文档类型" required>
      <div className="space-y-2">
        <SearchableSelect value={value} options={options} onChange={onChange} searchPlaceholder="搜索文档类型" emptyMessage="暂无文档类型" />
        <button type="button" onClick={onOpenDocumentTypes} className="inline-flex items-center gap-1 text-xs font-bold text-adnoc-blue hover:text-blue-700">
          <FileText className="h-3.5 w-3.5" />
          文档类型维护
        </button>
      </div>
    </DefinitionField>
  );
}

function DeliveryRuleEditorModal({
  editor,
  disciplineOptions,
  documentTypeOptions,
  classOptions,
  assetScopeOptions,
  isSaving,
  onChange,
  onSubmit,
  onClose,
  onOpenDocumentTypes,
}: {
  editor: DeliveryEditor;
  disciplineOptions: Array<{ value: string; label: string; keywords?: string }>;
  documentTypeOptions: Array<{ value: string; label: string; keywords?: string }>;
  classOptions: Array<{ value: string; label: string; keywords?: string }>;
  assetScopeOptions: Array<{ value: string; label: string }>;
  isSaving: boolean;
  onChange: (field: string, value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  onOpenDocumentTypes: () => void;
}) {
  const title = editor.kind === 'discipline'
    ? (editor.item ? '编辑专业' : '新增专业')
    : editor.kind === 'disciplineRule'
      ? (editor.item ? '编辑专业文档规则' : '新增专业文档规则')
      : (editor.item ? '编辑对象类别文档要求' : '新增对象类别文档要求');
  return (
    <DefinitionModal
      title={title}
      onSubmit={onSubmit}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={isSaving} className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50">取消</button>
          <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-adnoc-blue px-6 py-2.5 text-sm font-bold text-white shadow-sm shadow-adnoc-blue/20 transition hover:bg-blue-700 disabled:opacity-50">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存
          </button>
        </>
      )}
    >
      {editor.kind === 'discipline' ? (
        <>
          <DefinitionField label="编码" required><input value={editor.draft.code} onChange={(event) => onChange('code', event.target.value)} className={definitionInputClass} /></DefinitionField>
          <DefinitionField label="名称" required><input value={editor.draft.name} onChange={(event) => onChange('name', event.target.value)} className={definitionInputClass} /></DefinitionField>
          <DefinitionField label="CFIHOS unique code"><input value={editor.draft.cfihos_unique_code} onChange={(event) => onChange('cfihos_unique_code', event.target.value)} className={definitionInputClass} /></DefinitionField>
          <DefinitionField label="说明"><textarea value={editor.draft.description} onChange={(event) => onChange('description', event.target.value)} className={clsx(definitionInputClass, 'min-h-24 resize-none')} /></DefinitionField>
        </>
      ) : editor.kind === 'disciplineRule' ? (
        <>
          <DefinitionField label="专业" required><SearchableSelect value={editor.draft.discipline_id} options={disciplineOptions} onChange={(value) => onChange('discipline_id', value)} searchPlaceholder="搜索专业" /></DefinitionField>
          <DocumentTypeField value={editor.draft.document_type_id} options={documentTypeOptions} onChange={(value) => onChange('document_type_id', value)} onOpenDocumentTypes={onOpenDocumentTypes} />
          <RuleContextFields draft={editor.draft} assetScopeOptions={assetScopeOptions} onChange={onChange} />
          <DefinitionField label="专业规则短码"><input value={editor.draft.short_code} onChange={(event) => onChange('short_code', event.target.value)} className={definitionInputClass} /></DefinitionField>
          <DefinitionField label="Representation"><input value={editor.draft.representation_type} onChange={(event) => onChange('representation_type', event.target.value)} className={definitionInputClass} /></DefinitionField>
          <DefinitionField label="Native delivery timing"><input value={editor.draft.native_file_delivery_timing} onChange={(event) => onChange('native_file_delivery_timing', event.target.value)} className={definitionInputClass} /></DefinitionField>
        </>
      ) : (
        <>
          <DefinitionField label="对象类别" required><SearchableSelect value={editor.draft.class_id} options={classOptions} onChange={(value) => onChange('class_id', value)} searchPlaceholder="搜索对象类别" /></DefinitionField>
          <DocumentTypeField value={editor.draft.document_type_id} options={documentTypeOptions} onChange={(value) => onChange('document_type_id', value)} onOpenDocumentTypes={onOpenDocumentTypes} />
          <RuleContextFields draft={editor.draft} assetScopeOptions={assetScopeOptions} onChange={onChange} />
          <DefinitionField label="Source standard code"><input value={editor.draft.source_standard_code} onChange={(event) => onChange('source_standard_code', event.target.value)} className={definitionInputClass} /></DefinitionField>
          <DefinitionField label="Source standard CFIHOS code"><input value={editor.draft.source_standard_cfihos_code} onChange={(event) => onChange('source_standard_cfihos_code', event.target.value)} className={definitionInputClass} /></DefinitionField>
        </>
      )}
      {editor.kind !== 'discipline' && (
        <DefinitionField label="CFIHOS unique code"><input value={editor.draft.cfihos_unique_code} onChange={(event) => onChange('cfihos_unique_code', event.target.value)} className={definitionInputClass} /></DefinitionField>
      )}
    </DefinitionModal>
  );
}

function RuleContextFields({
  draft,
  assetScopeOptions,
  onChange,
}: {
  draft: DisciplineRuleDraft | ClassRequirementDraft;
  assetScopeOptions: Array<{ value: string; label: string }>;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <DefinitionField label="Asset scope"><SearchableSelect value={draft.asset_scope} options={assetScopeOptions} onChange={(value) => onChange('asset_scope', value)} clearable /></DefinitionField>
      <DefinitionField label="Perspective"><input value={draft.perspective} onChange={(event) => onChange('perspective', event.target.value)} className={definitionInputClass} /></DefinitionField>
      <DefinitionField label="Lifecycle"><input value={draft.lifecycle_phase} onChange={(event) => onChange('lifecycle_phase', event.target.value)} className={definitionInputClass} /></DefinitionField>
    </div>
  );
}
