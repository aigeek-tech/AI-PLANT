import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileWarning,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import {
  getProjectDataQualityDocumentMatrix,
  getProjectDataQualityIssues,
  getProjectDataQualitySummary,
  type DataQualityDimension,
  type DataQualityDocumentMatrixCell,
  type DataQualityDocumentMatrixRow,
  type DataQualityIssue,
  type DataQualityMatrixCellStatus,
  type DataQualitySeverity,
  type DataQualitySummary,
  type PbsNode,
} from '../../lib/api';
import { GLOBAL_AGENT_ASSISTANT_OPEN_EVENT } from '../agents/ProjectAgentWorkspace';
import { SearchableSelect, type SearchableSelectOption } from '../ui/SearchableSelect';
import { useToast } from '../ui/Toast';
import {
  secondaryButtonClass,
  secondaryButtonIconClass,
  softPrimaryButtonClass,
  softPrimaryButtonIconClass,
} from '../ui/buttonStyles';

interface ProjectDataQualityDashboardProps {
  projectId: string;
  pbsNodes: PbsNode[];
}

type SeverityFilter = '' | DataQualitySeverity;
type DimensionFilter = '' | DataQualityDimension;

const severityMeta: Record<DataQualitySeverity, { label: string; className: string }> = {
  critical: { label: '严重', className: 'bg-red-100 text-red-700 ring-red-200' },
  high: { label: '高', className: 'bg-orange-100 text-orange-700 ring-orange-200' },
  medium: { label: '中', className: 'bg-amber-100 text-amber-700 ring-amber-200' },
  low: { label: '低', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const dimensionMeta: Record<DataQualityDimension, { label: string; className: string }> = {
  completeness: { label: '完整性', className: 'bg-blue-50 text-blue-700 ring-blue-100' },
  accuracy: { label: '准确性', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  consistency: { label: '一致性', className: 'bg-indigo-50 text-indigo-700 ring-indigo-100' },
  document_readiness: { label: '文档齐套性', className: 'bg-cyan-50 text-cyan-700 ring-cyan-100' },
};

const cellStatusMeta: Record<DataQualityMatrixCellStatus, { label: string; className: string }> = {
  ok: { label: '已齐套', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  missing: { label: '缺失', className: 'bg-red-50 text-red-700 ring-red-100' },
  draft: { label: '草稿', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  no_file: { label: '无文件', className: 'bg-orange-50 text-orange-700 ring-orange-100' },
  linked_error: { label: '关联错误', className: 'bg-rose-50 text-rose-700 ring-rose-100' },
};

const aiQuestions = [
  '哪些设备缺少数据表？',
  '哪些 TAG 缺少必填属性？',
  '按专业统计缺失文档数量',
];

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10';
const compactSecondaryButtonClass = `${secondaryButtonClass} px-3 py-2 text-xs`;
const compactSoftPrimaryButtonClass = `${softPrimaryButtonClass} px-3 py-2 text-xs`;
const matrixPageSizeOptions: SearchableSelectOption[] = [
  { value: '15', label: '每页 15 行' },
  { value: '30', label: '每页 30 行' },
  { value: '50', label: '每页 50 行' },
];
const issuePageSizeOptions: SearchableSelectOption[] = [
  { value: '10', label: '每页 10 条' },
  { value: '20', label: '每页 20 条' },
  { value: '50', label: '每页 50 条' },
];

export function ProjectDataQualityDashboard({ projectId, pbsNodes }: ProjectDataQualityDashboardProps) {
  const { success, error: showError } = useToast();
  const [summary, setSummary] = useState<DataQualitySummary | null>(null);
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [matrix, setMatrix] = useState<DataQualityDocumentMatrixRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [selectedPbsId, setSelectedPbsId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [severity, setSeverity] = useState<SeverityFilter>('');
  const [dimension, setDimension] = useState<DimensionFilter>('');
  const [keyword, setKeyword] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [matrixPage, setMatrixPage] = useState(1);
  const [matrixPageSize, setMatrixPageSize] = useState(15);
  const [issuePage, setIssuePage] = useState(1);
  const [issuePageSize, setIssuePageSize] = useState(20);

  useEffect(() => {
    setOnlyCritical(false);
    setSelectedPbsId('');
    setSelectedClassId('');
    setSeverity('');
    setDimension('');
    setKeyword('');
    setSelectedRowId(null);
    setMatrixPage(1);
    setIssuePage(1);
  }, [projectId]);

  const loadQuality = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextSummary, nextIssues, nextMatrix] = await Promise.all([
        getProjectDataQualitySummary(projectId),
        getProjectDataQualityIssues(projectId),
        getProjectDataQualityDocumentMatrix(projectId),
      ]);
      setSummary(nextSummary);
      setIssues(nextIssues);
      setMatrix(nextMatrix);
      setSelectedRowId((current) => (current && nextMatrix.some((row) => row.row_id === current) ? current : nextMatrix[0]?.row_id ?? null));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : '数据质量检查加载失败';
      setError(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, showError]);

  useEffect(() => {
    void loadQuality();
  }, [loadQuality]);

  const classOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    matrix.forEach((row) => {
      if (row.class_id) {
        map.set(row.class_id, { id: row.class_id, label: [row.class_code, row.class_name].filter(Boolean).join(' · ') || row.class_id });
      }
    });
    return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [matrix]);

  const documentTypeColumns = useMemo(() => {
    const map = new Map<string, DataQualityDocumentMatrixCell>();
    matrix.forEach((row) => {
      row.cells.forEach((cell) => {
        if (!map.has(cell.document_type_id)) {
          map.set(cell.document_type_id, cell);
        }
      });
    });
    return Array.from(map.values());
  }, [matrix]);

  const issueObjectIds = useMemo(() => new Set(issues.map((issue) => issue.object_id)), [issues]);
  const criticalObjectIds = useMemo(
    () => new Set(issues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high').map((issue) => issue.object_id)),
    [issues],
  );

  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredMatrix = useMemo(() => {
    return matrix.filter((row) => {
      if (selectedPbsId && row.pbs_node_id !== selectedPbsId) return false;
      if (selectedClassId && row.class_id !== selectedClassId) return false;
      if (onlyCritical && !criticalObjectIds.has(row.asset_id)) return false;
      if (!normalizedKeyword) return true;
      return [row.asset_no, row.asset_name, row.class_code, row.class_name, row.pbs_node_code, row.pbs_node_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedKeyword));
    });
  }, [criticalObjectIds, matrix, normalizedKeyword, onlyCritical, selectedClassId, selectedPbsId]);

  const filteredMatrixObjectIds = useMemo(() => new Set(filteredMatrix.map((row) => row.asset_id)), [filteredMatrix]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (onlyCritical && issue.severity !== 'critical' && issue.severity !== 'high') return false;
      if (severity && issue.severity !== severity) return false;
      if (dimension && issue.dimension !== dimension) return false;
      if ((selectedPbsId || selectedClassId) && issue.object_kind !== 'document' && !filteredMatrixObjectIds.has(issue.object_id)) return false;
      if (!normalizedKeyword) return true;
      return [issue.object_code, issue.object_name, issue.field, issue.rule, issue.current_value, issue.expected_value, issue.suggestion, issue.linked_document_no]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedKeyword));
    });
  }, [dimension, filteredMatrixObjectIds, issues, normalizedKeyword, onlyCritical, selectedClassId, selectedPbsId, severity]);

  useEffect(() => {
    setMatrixPage(1);
  }, [normalizedKeyword, onlyCritical, selectedClassId, selectedPbsId]);

  useEffect(() => {
    setIssuePage(1);
  }, [dimension, normalizedKeyword, onlyCritical, selectedClassId, selectedPbsId, severity]);

  const matrixTotalPages = Math.max(1, Math.ceil(filteredMatrix.length / matrixPageSize));
  const issueTotalPages = Math.max(1, Math.ceil(filteredIssues.length / issuePageSize));

  useEffect(() => {
    setMatrixPage((current) => Math.min(current, matrixTotalPages));
  }, [matrixTotalPages]);

  useEffect(() => {
    setIssuePage((current) => Math.min(current, issueTotalPages));
  }, [issueTotalPages]);

  const paginatedMatrix = useMemo(
    () => paginate(filteredMatrix, matrixPage, matrixPageSize),
    [filteredMatrix, matrixPage, matrixPageSize],
  );
  const paginatedIssues = useMemo(
    () => paginate(filteredIssues, issuePage, issuePageSize),
    [filteredIssues, issuePage, issuePageSize],
  );

  const selectedRow = useMemo(
    () => paginatedMatrix.find((row) => row.row_id === selectedRowId) ?? paginatedMatrix[0] ?? null,
    [paginatedMatrix, selectedRowId],
  );

  useEffect(() => {
    if (selectedRow && selectedRow.row_id !== selectedRowId) {
      setSelectedRowId(selectedRow.row_id);
    }
  }, [selectedRow, selectedRowId]);

  const selectedRowIssues = useMemo(
    () => (selectedRow ? issues.filter((issue) => issue.object_id === selectedRow.asset_id) : []),
    [issues, selectedRow],
  );

  const handleOpenAiQuestion = (question: string) => {
    window.dispatchEvent(
      new CustomEvent(GLOBAL_AGENT_ASSISTANT_OPEN_EVENT, {
        detail: { prompt: question, projectId },
      }),
    );
    success('已打开智能问数');
  };

  const handleExportIssues = () => {
    const rows = filteredIssues.map((issue) => [
      severityMeta[issue.severity].label,
      dimensionMeta[issue.dimension].label,
      issue.object_kind,
      issue.object_code,
      issue.object_name,
      issue.field,
      issue.rule,
      issue.current_value,
      issue.expected_value,
      issue.linked_document_no ?? '',
      issue.suggestion,
    ]);
    const csv = [
      ['等级', '维度', '对象类型', '对象编号', '对象名称', '字段/规则', '规则编码', '当前值', '期望值', '关联文档', '处理建议'],
      ...rows,
    ]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `data-quality-issues-${projectId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading && !summary) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-3xl border border-slate-200 bg-white/70 text-slate-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin text-adnoc-blue" />
        正在检查交付数据质量
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-3xl border border-red-100 bg-red-50 text-red-600">
        <AlertTriangle className="mr-2 h-6 w-6" />
        {error}
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="flex min-h-full flex-col gap-4 overflow-visible xl:h-full xl:min-h-0 xl:overflow-hidden">
      <section className="shrink-0 rounded-3xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur-xl">
        <div className="grid gap-4 lg:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.5fr)] lg:items-start">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-4">
              <ScoreDial score={summary.overall_score} />
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-slate-900">项目交付数据质量</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">检查时间 {formatDateTime(summary.generated_at)}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">
                    TAG {summary.scope.tag_count} · 设备 {summary.scope.equipment_count} · 文档 {summary.scope.document_count}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">
                    规则基线 {summary.scope.requirement_count}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summary.dimension_cards.map((card) => (
              <DimensionCard key={card.dimension} card={card} />
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => setOnlyCritical((current) => !current)} className={onlyCritical ? compactSoftPrimaryButtonClass : compactSecondaryButtonClass}>
            <span className={onlyCritical ? softPrimaryButtonIconClass : secondaryButtonIconClass}>
              <ShieldCheck className="h-4 w-4" />
            </span>
            仅看严重问题
          </button>
          <button type="button" onClick={handleExportIssues} disabled={filteredIssues.length === 0} className={compactSecondaryButtonClass}>
            <span className={secondaryButtonIconClass}>
              <Download className="h-4 w-4" />
            </span>
            导出问题清单
          </button>
          <button type="button" onClick={() => void loadQuality()} disabled={isLoading} className={compactSoftPrimaryButtonClass}>
            <span className={softPrimaryButtonIconClass}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </span>
            重新检查
          </button>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 gap-4 overflow-visible xl:grid-cols-[280px_minmax(0,1fr)_330px] xl:overflow-hidden xl:pr-0">
        <FilterPanel
          pbsNodes={pbsNodes}
          classOptions={classOptions}
          selectedPbsId={selectedPbsId}
          selectedClassId={selectedClassId}
          severity={severity}
          dimension={dimension}
          keyword={keyword}
          issueCount={filteredIssues.length}
          matrixCount={filteredMatrix.length}
          onPbsChange={setSelectedPbsId}
          onClassChange={setSelectedClassId}
          onSeverityChange={setSeverity}
          onDimensionChange={setDimension}
          onKeywordChange={setKeyword}
          onReset={() => {
            setSelectedPbsId('');
            setSelectedClassId('');
            setSeverity('');
            setDimension('');
            setKeyword('');
            setOnlyCritical(false);
          }}
        />

        <div className="flex min-w-0 flex-col gap-4 xl:grid xl:min-h-0 xl:grid-rows-[minmax(120px,1fr)_minmax(160px,0.85fr)] xl:overflow-hidden">
          <DocumentMatrixTable
            rows={paginatedMatrix}
            columns={documentTypeColumns}
            issueObjectIds={issueObjectIds}
            selectedRowId={selectedRow?.row_id ?? null}
            onSelectRow={setSelectedRowId}
            pagination={
              <PaginationControls
                label="矩阵分页"
                page={matrixPage}
                pageSize={matrixPageSize}
                total={filteredMatrix.length}
                totalPages={matrixTotalPages}
                pageSizeOptions={matrixPageSizeOptions}
                onPageChange={setMatrixPage}
                onPageSizeChange={(value) => {
                  setMatrixPageSize(Number(value));
                  setMatrixPage(1);
                }}
              />
            }
          />
          <IssuesTable
            issues={paginatedIssues}
            pagination={
              <PaginationControls
                label="问题分页"
                page={issuePage}
                pageSize={issuePageSize}
                total={filteredIssues.length}
                totalPages={issueTotalPages}
                pageSizeOptions={issuePageSizeOptions}
                onPageChange={setIssuePage}
                onPageSizeChange={(value) => {
                  setIssuePageSize(Number(value));
                  setIssuePage(1);
                }}
              />
            }
          />
        </div>

        <DetailPanel
          selectedRow={selectedRow}
          selectedRowIssues={selectedRowIssues}
          summary={summary}
          onAskQuestion={handleOpenAiQuestion}
        />
      </section>
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  const color = score >= 90 ? 'text-emerald-600' : score >= 75 ? 'text-adnoc-blue' : score >= 60 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
      <div className="text-center">
        <div className={clsx('text-2xl font-black tabular-nums', color)}>{score}</div>
        <div className="text-xs font-semibold text-slate-400">/ 100</div>
      </div>
    </div>
  );
}

function DimensionCard({ card }: { card: DataQualitySummary['dimension_cards'][number] }) {
  const meta = dimensionMeta[card.dimension];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/75 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className={clsx('rounded-full px-2.5 py-1 text-xs font-bold ring-1', meta.className)}>{meta.label}</span>
        <span className={clsx('text-xl font-black tabular-nums', card.score >= 80 ? 'text-slate-900' : 'text-amber-600')}>{card.score}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-adnoc-blue" style={{ width: `${Math.max(4, card.score)}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs font-medium text-slate-500">
        <span>{card.checks_passed}/{card.checks_total} 通过</span>
        <span>{card.issue_count} 问题</span>
      </div>
    </div>
  );
}

function FilterPanel({
  pbsNodes,
  classOptions,
  selectedPbsId,
  selectedClassId,
  severity,
  dimension,
  keyword,
  issueCount,
  matrixCount,
  onPbsChange,
  onClassChange,
  onSeverityChange,
  onDimensionChange,
  onKeywordChange,
  onReset,
}: {
  pbsNodes: PbsNode[];
  classOptions: Array<{ id: string; label: string }>;
  selectedPbsId: string;
  selectedClassId: string;
  severity: SeverityFilter;
  dimension: DimensionFilter;
  keyword: string;
  issueCount: number;
  matrixCount: number;
  onPbsChange: (value: string) => void;
  onClassChange: (value: string) => void;
  onSeverityChange: (value: SeverityFilter) => void;
  onDimensionChange: (value: DimensionFilter) => void;
  onKeywordChange: (value: string) => void;
  onReset: () => void;
}) {
  const pbsOptions = useMemo(
    () =>
      pbsNodes.map((node) => ({
        value: node.id,
        label: `${node.code} · ${node.name}`,
        keywords: `${node.code} ${node.name} ${node.node_type ?? ''}`,
      })),
    [pbsNodes],
  );
  const objectClassOptions = useMemo(
    () => classOptions.map((option) => ({ value: option.id, label: option.label })),
    [classOptions],
  );
  const severityOptions = useMemo(
    () => Object.entries(severityMeta).map(([value, meta]) => ({ value, label: meta.label })),
    [],
  );
  const dimensionOptions = useMemo(
    () => Object.entries(dimensionMeta).map(([value, meta]) => ({ value, label: meta.label })),
    [],
  );

  return (
    <aside className="rounded-3xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur-xl xl:min-h-0 xl:overflow-auto">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Filter className="h-4 w-4 text-adnoc-blue" />
          筛选范围
        </h3>
        <button type="button" onClick={onReset} className="text-xs font-semibold text-slate-400 transition hover:text-adnoc-blue">
          清空
        </button>
      </div>

      <div className="space-y-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="搜索对象、规则或文档" className={`${inputClass} pl-10`} />
        </label>
        <FilterSelect
          label="PBS 节点"
          value={selectedPbsId}
          options={pbsOptions}
          onChange={onPbsChange}
          placeholder="全部 PBS"
          searchPlaceholder="搜索 PBS 编码或名称"
        />
        <FilterSelect
          label="对象类别"
          value={selectedClassId}
          options={objectClassOptions}
          onChange={onClassChange}
          placeholder="全部类别"
          searchPlaceholder="搜索对象类别"
        />
        <FilterSelect
          label="问题等级"
          value={severity}
          options={severityOptions}
          onChange={(value) => onSeverityChange(value as SeverityFilter)}
          placeholder="全部等级"
          searchPlaceholder="搜索问题等级"
        />
        <FilterSelect
          label="质量维度"
          value={dimension}
          options={dimensionOptions}
          onChange={(value) => onDimensionChange(value as DimensionFilter)}
          placeholder="全部维度"
          searchPlaceholder="搜索质量维度"
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-2xl bg-slate-50 px-3 py-3">
          <div className="text-xl font-black text-slate-900">{matrixCount}</div>
          <div className="text-xs font-medium text-slate-400">矩阵对象</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-3">
          <div className="text-xl font-black text-slate-900">{issueCount}</div>
          <div className="text-xs font-medium text-slate-400">问题</div>
        </div>
      </div>
    </aside>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
}: {
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-500">{label}</span>
      <SearchableSelect
        value={value}
        options={options}
        onChange={onChange}
        clearable
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyMessage="没有匹配的选项"
        className={inputClass}
      />
    </label>
  );
}

function DocumentMatrixTable({
  rows,
  columns,
  issueObjectIds,
  selectedRowId,
  onSelectRow,
  pagination,
}: {
  rows: DataQualityDocumentMatrixRow[];
  columns: DataQualityDocumentMatrixCell[];
  issueObjectIds: Set<string>;
  selectedRowId: string | null;
  onSelectRow: (rowId: string) => void;
  pagination: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/80 shadow-sm backdrop-blur-xl xl:h-full xl:min-h-0">
      <div className="shrink-0 flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Table2 className="h-4 w-4 text-adnoc-blue" />
          设备 / TAG 文档齐套矩阵
        </h3>
        <span className="text-xs font-medium text-slate-400">{rows.length} 行</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-9 w-9" />} title="暂无齐套矩阵" text="当前筛选范围没有匹配的对象类别文档要求。" />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-[920px] w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-bold uppercase text-slate-500">
              <tr>
                <th className="min-w-56 px-4 py-3 text-left">对象</th>
                <th className="min-w-36 px-4 py-3 text-left">类别</th>
                <th className="min-w-28 px-4 py-3 text-left">齐套率</th>
                {columns.map((column) => (
                  <th key={column.document_type_id} className="min-w-32 px-4 py-3 text-left">
                    {column.document_type_code || column.document_type_name || column.document_type_id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr
                  key={row.row_id}
                  onClick={() => onSelectRow(row.row_id)}
                  className={clsx('cursor-pointer transition hover:bg-blue-50/40', selectedRowId === row.row_id && 'bg-adnoc-blue/5')}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {issueObjectIds.has(row.asset_id) ? <FileWarning className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs font-bold text-slate-800">{row.asset_no}</div>
                        <div className="truncate text-xs text-slate-500">{row.asset_name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{[row.class_code, row.class_name].filter(Boolean).join(' · ') || '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-adnoc-blue" style={{ width: `${row.completeness_percent}%` }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums text-slate-600">{row.completeness_percent}%</span>
                    </div>
                  </td>
                  {columns.map((column) => {
                    const cell = row.cells.find((item) => item.document_type_id === column.document_type_id);
                    return (
                      <td key={`${row.row_id}-${column.document_type_id}`} className="px-4 py-3">
                        {cell ? <CellBadge cell={cell} /> : <span className="text-xs text-slate-300">-</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="shrink-0 border-t border-slate-100 px-4 py-3">{pagination}</div>
    </div>
  );
}

function CellBadge({ cell }: { cell: DataQualityDocumentMatrixCell }) {
  const meta = cellStatusMeta[cell.status];
  return (
    <span title={cell.document_no ? `${cell.document_no} · ${cell.revision_no ?? '-'}` : undefined} className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1', meta.className)}>
      {meta.label}
    </span>
  );
}

function IssuesTable({ issues, pagination }: { issues: DataQualityIssue[]; pagination: React.ReactNode }) {
  return (
    <div className="flex min-h-[260px] flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/80 shadow-sm backdrop-blur-xl xl:h-full xl:min-h-0">
      <div className="shrink-0 flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          问题清单
        </h3>
        <span className="text-xs font-medium text-slate-400">{issues.length} 条</span>
      </div>
      {issues.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-9 w-9" />} title="当前筛选下没有问题" text="可调整筛选范围继续检查。" />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-[960px] w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs font-bold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">等级</th>
                <th className="px-4 py-3 text-left">维度</th>
                <th className="px-4 py-3 text-left">对象</th>
                <th className="px-4 py-3 text-left">字段/规则</th>
                <th className="px-4 py-3 text-left">当前值</th>
                <th className="px-4 py-3 text-left">期望值</th>
                <th className="px-4 py-3 text-left">处理建议</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {issues.map((issue) => (
                <tr key={issue.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><SeverityBadge severity={issue.severity} /></td>
                  <td className="px-4 py-3"><DimensionBadge dimension={issue.dimension} /></td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs font-bold text-slate-800">{issue.object_code}</div>
                    <div className="text-xs text-slate-500">{issue.object_name}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{issue.field}</td>
                  <td className="max-w-36 px-4 py-3 text-xs text-slate-500"><span className="block truncate">{issue.current_value}</span></td>
                  <td className="max-w-44 px-4 py-3 text-xs text-slate-500"><span className="block truncate">{issue.expected_value}</span></td>
                  <td className="min-w-64 px-4 py-3 text-xs leading-5 text-slate-600">{issue.suggestion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="shrink-0 border-t border-slate-100 px-4 py-3">{pagination}</div>
    </div>
  );
}

function PaginationControls({
  label,
  page,
  pageSize,
  total,
  totalPages,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  label: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  pageSizeOptions: SearchableSelectOption[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: string) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500" aria-label={label}>
      <span className="font-medium">
        {from}-{to} / {total}
      </span>
      <div className="flex items-center gap-2">
        <div className="w-32">
          <SearchableSelect
            value={String(pageSize)}
            options={pageSizeOptions}
            onChange={onPageSizeChange}
            searchPlaceholder="搜索分页大小"
            className="min-h-8 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600"
          />
        </div>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-600 transition hover:border-adnoc-blue/30 hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一页
        </button>
        <span className="min-w-12 text-center font-semibold text-slate-600">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-600 transition hover:border-adnoc-blue/30 hover:text-adnoc-blue disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

function DetailPanel({
  selectedRow,
  selectedRowIssues,
  summary,
  onAskQuestion,
}: {
  selectedRow: DataQualityDocumentMatrixRow | null;
  selectedRowIssues: DataQualityIssue[];
  summary: DataQualitySummary;
  onAskQuestion: (question: string) => void;
}) {
  return (
    <aside className="rounded-3xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur-xl xl:min-h-0 xl:overflow-auto">
      <div className="mb-4 flex items-center gap-2">
        <Database className="h-4 w-4 text-adnoc-blue" />
        <h3 className="text-sm font-bold text-slate-900">对象详情</h3>
      </div>
      {selectedRow ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="font-mono text-sm font-black text-slate-900">{selectedRow.asset_no}</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">{selectedRow.asset_name}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <InfoPill label="类别" value={[selectedRow.class_code, selectedRow.class_name].filter(Boolean).join(' · ') || '-'} />
              <InfoPill label="PBS" value={[selectedRow.pbs_node_code, selectedRow.pbs_node_name].filter(Boolean).join(' · ') || '-'} />
              <InfoPill label="文档齐套率" value={`${selectedRow.completeness_percent}%`} />
              <InfoPill label="问题数" value={String(selectedRowIssues.length)} />
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold text-slate-500">要求文档</h4>
            <div className="space-y-2">
              {selectedRow.cells.map((cell) => (
                <div key={cell.requirement_id} className="rounded-2xl border border-slate-100 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-bold text-slate-700">
                      {cell.document_type_code || cell.document_type_name}
                    </span>
                    <CellBadge cell={cell} />
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">{cell.document_no || cell.lifecycle_phase || '-'}</div>
                </div>
              ))}
            </div>
          </div>
          {selectedRowIssues.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-bold text-slate-500">关联问题</h4>
              <div className="space-y-2">
                {selectedRowIssues.slice(0, 6).map((issue) => (
                  <div key={issue.id} className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                    <div className="font-bold">{issue.field}</div>
                    <div>{issue.suggestion}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
          当前项目共 {summary.scope.tag_count} 个 TAG、{summary.scope.document_count} 份文档。
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500">
          <Bot className="h-3.5 w-3.5 text-adnoc-blue" />
          智能问数
        </div>
        <div className="space-y-2">
          {aiQuestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onAskQuestion(question)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition hover:border-adnoc-blue/30 hover:bg-adnoc-blue/5 hover:text-adnoc-blue"
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white px-3 py-2">
      <div className="text-[11px] font-bold text-slate-400">{label}</div>
      <div className="mt-1 truncate font-semibold text-slate-700" title={value}>{value}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: DataQualitySeverity }) {
  const meta = severityMeta[severity];
  return <span className={clsx('inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1', meta.className)}>{meta.label}</span>;
}

function DimensionBadge({ dimension }: { dimension: DataQualityDimension }) {
  const meta = dimensionMeta[dimension];
  return <span className={clsx('inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1', meta.className)}>{meta.label}</span>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center p-8 text-center text-slate-400">
      <div>
        <div className="mb-3 flex justify-center text-slate-300">{icon}</div>
        <div className="text-sm font-bold text-slate-500">{title}</div>
        <div className="mt-1 text-xs">{text}</div>
      </div>
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function escapeCsv(value: string) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
