import React, { useState, useEffect } from 'react';
import { X, Tag, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import {
  primaryButtonClass,
  secondaryButtonClass,
} from '../ui/buttonStyles';
import { SearchableSelect } from '../ui/SearchableSelect';
import {
  getAllClassAttributes,
  getAllStandardCommonAttributes,
  getProjectDetail,
  getStandardDetail,
  type ClassDefinition,
  type AttributeDefinition,
  type ProjectTag,
} from '../../lib/api';

interface TagCreateFormProps {
  projectId: string;
  pbsNodeName: string;
  /** If creating a component under an equipment tag */
  parentTag?: ProjectTag | null;
  onSubmit: (data: {
    tag_no: string;
    name: string;
    class_id?: string;
    parent_tag_id?: string;
    attribute_values: Record<string, unknown>;
  }) => void;
  onCancel: () => void;
}

function emptyAttributeValue(attribute: AttributeDefinition) {
  if (attribute.value_type === 'boolean') return false;
  if (attribute.value_type === 'number' || attribute.value_type === 'integer') return null;
  return '';
}

function buildInitialAttributeValues(
  attributes: AttributeDefinition[],
  currentValues: Record<string, unknown> = {},
) {
  return Object.fromEntries(
    attributes.map((attribute) => [
      attribute.code,
      currentValues[attribute.code] ?? emptyAttributeValue(attribute),
    ]),
  );
}

export function TagCreateForm({
  projectId,
  pbsNodeName,
  parentTag,
  onSubmit,
  onCancel,
}: TagCreateFormProps) {
  const [tagNo, setTagNo] = useState('');
  const [name, setName] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [attributeValues, setAttributeValues] = useState<Record<string, unknown>>({});

  const [standardId, setStandardId] = useState('');
  const [classes, setClasses] = useState<ClassDefinition[]>([]);
  const [commonAttributes, setCommonAttributes] = useState<AttributeDefinition[]>([]);
  const [classAttributes, setClassAttributes] = useState<AttributeDefinition[]>([]);
  const [isLoadingStandard, setIsLoadingStandard] = useState(true);
  const [isLoadingAttributes, setIsLoadingAttributes] = useState(false);
  const [attributeLoadError, setAttributeLoadError] = useState<string | null>(null);
  const [noStandard, setNoStandard] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const project = await getProjectDetail(projectId);
        const standardId = (project.reference_attributes as Record<string, string>)?.standard_id;
        if (!standardId) {
          setNoStandard(true);
          setIsLoadingStandard(false);
          return;
        }
        setStandardId(standardId);
        const standard = await getStandardDetail(standardId);
        setClasses(standard.classes ?? []);
      } catch (e) {
        console.error('Failed to load standard', e);
        setNoStandard(true);
      } finally {
        setIsLoadingStandard(false);
      }
    })();
  }, [projectId]);

  const selectedClass = classes.find((c) => c.id === selectedClassId);
  const allAttributes = [...commonAttributes, ...(selectedClassId ? classAttributes : [])];

  const handleClassChange = (classId: string) => {
    setSelectedClassId(classId);
    setClassAttributes([]);
    setAttributeLoadError(null);
  };

  useEffect(() => {
    if (!standardId) {
      setCommonAttributes([]);
      setClassAttributes([]);
      setAttributeValues({});
      setIsLoadingAttributes(false);
      setAttributeLoadError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingAttributes(true);
    setAttributeLoadError(null);

    (async () => {
      try {
        const [nextCommonAttributes, nextClassAttributes] = await Promise.all([
          getAllStandardCommonAttributes(standardId, 'tag'),
          selectedClassId ? getAllClassAttributes(selectedClassId) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const nextAttributes = [...nextCommonAttributes, ...nextClassAttributes];
        setCommonAttributes(nextCommonAttributes);
        setClassAttributes(nextClassAttributes);
        setAttributeValues((current) => buildInitialAttributeValues(nextAttributes, current));
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load class attributes', error);
        setCommonAttributes([]);
        setClassAttributes([]);
        setAttributeValues({});
        setAttributeLoadError('类别属性加载失败，请重新选择 Class 或稍后重试');
      } finally {
        if (!cancelled) {
          setIsLoadingAttributes(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedClassId, standardId]);

  const canSubmit = Boolean(tagNo.trim() && name.trim()) && !isLoadingAttributes && !(selectedClassId && attributeLoadError);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attributeValues)) {
      if (v !== '' && v !== null && v !== undefined) cleaned[k] = v;
    }
    onSubmit({
      tag_no: tagNo.trim(),
      name: name.trim(),
      class_id: selectedClassId || undefined,
      parent_tag_id: parentTag?.id,
      attribute_values: cleaned,
    });
  };

  const renderAttributeInput = (attr: AttributeDefinition) => {
    const value = attributeValues[attr.code] ?? '';

    if (attr.value_type === 'boolean') {
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) =>
              setAttributeValues((prev) => ({ ...prev, [attr.code]: e.target.checked }))
            }
            className="h-4 w-4 rounded border-slate-300 text-adnoc-blue focus:ring-adnoc-blue/30"
          />
          <span className="text-sm text-slate-600">{attr.name}</span>
        </label>
      );
    }

    if (attr.value_type === 'enum' && attr.enum_options?.length) {
      return (
        <SearchableSelect
          value={String(value)}
          onChange={(nextValue) =>
            setAttributeValues((prev) => ({ ...prev, [attr.code]: nextValue }))
          }
          className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-all focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
          placeholder="-- 选择 --"
          clearable
          options={attr.enum_options.map((opt, index) => {
            const optionValue = String(opt);
            return { value: optionValue, label: optionValue, keywords: `${attr.id} ${index}` };
          })}
          searchPlaceholder={`搜索${attr.name}`}
        />
      );
    }

    const inputType =
      attr.value_type === 'number' || attr.value_type === 'integer' ? 'number' : 'text';

    return (
      <input
        type={inputType}
        value={String(value)}
        onChange={(e) => {
          let v: unknown = e.target.value;
          if (attr.value_type === 'number') v = e.target.value ? parseFloat(e.target.value) : null;
          if (attr.value_type === 'integer') v = e.target.value ? parseInt(e.target.value, 10) : null;
          setAttributeValues((prev) => ({ ...prev, [attr.code]: v }));
        }}
        placeholder={attr.description || attr.name}
        className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
      />
    );
  };

  const renderAttributeRows = (attributes: AttributeDefinition[]) => (
    <div className={isMaximized ? 'grid gap-3 xl:grid-cols-2' : 'space-y-3'}>
      {attributes.map((attr) => (
        <div key={attr.id} className="rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm">
          <label className="mb-2 flex min-w-0 flex-wrap items-center gap-1 text-sm font-medium text-slate-700">
            <span className="min-w-0 break-words">{attr.name}</span>
            {attr.is_required && <span className="text-red-400">*</span>}
            {attr.unit_family && <span className="text-xs text-slate-400">({attr.unit_family})</span>}
          </label>
          <div>{renderAttributeInput(attr)}</div>
          {attr.code && <div className="mt-1 truncate font-mono text-[11px] text-slate-400">{attr.code}</div>}
        </div>
      ))}
    </div>
  );

  const modalSizeClass = isMaximized
    ? 'h-[calc(100vh-2rem)] w-[calc(100vw-2rem)]'
    : 'h-[min(88vh,820px)] w-[min(960px,calc(100vw-2rem))]';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-create-title"
        className={`${modalSizeClass} flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-900/20`}
      >
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-adnoc-blue/10 flex items-center justify-center">
            <Tag className="h-4 w-4 text-adnoc-blue" />
          </div>
          <div>
            <h3 id="tag-create-title" className="font-bold text-slate-800">
              {parentTag ? '新增部件 (Component)' : '新增工程对象 (Tag)'}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {parentTag ? (
                <>
                  父级设备: <span className="font-medium text-slate-600">{parentTag.tag_no} {parentTag.name}</span>
                </>
              ) : (
                <>
                  所属节点: <span className="font-medium text-slate-600">{pbsNodeName}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsMaximized((current) => !current)}
            title={isMaximized ? '还原窗口' : '最大化窗口'}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onCancel}
            title="关闭"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-6">
          <div className={`${isMaximized ? 'max-w-none' : 'max-w-4xl'} mx-auto space-y-5`}>
            <section className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="text-sm font-bold text-slate-800">基础信息</h4>
                {selectedClass ? (
                  <span className="min-w-0 max-w-full truncate rounded-full bg-adnoc-blue/10 px-2.5 py-1 text-xs font-medium text-adnoc-blue">
                    {selectedClass.code} · {selectedClass.name}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-600">
                    Tag 位号 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={tagNo}
                    onChange={(e) => setTagNo(e.target.value)}
                    placeholder={parentTag ? 'P-1001-BRG01' : 'P-1001'}
                    className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-600">
                    名称 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={parentTag ? '驱动端轴承' : '进料泵'}
                    className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-semibold text-slate-600">
                  所属类别 (Class)
                </label>
                {isLoadingStandard ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载标准库...
                  </div>
                ) : noStandard ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
                    当前项目未关联标准库，无法选择类别
                  </div>
                ) : (
                  <SearchableSelect
                    value={selectedClassId}
                    onChange={handleClassChange}
                    className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-all focus:border-adnoc-blue focus:outline-none focus:ring-2 focus:ring-adnoc-blue/10"
                    placeholder="-- 未选择类型 --"
                    clearable
                    options={classes.map((cls) => ({
                      value: cls.id,
                      label: `${cls.code} - ${cls.name}`,
                    }))}
                    searchPlaceholder="搜索类别编码或名称"
                  />
                )}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-800">属性填写</h4>
                  {allAttributes.length > 0 && (
                    <span className="rounded-full bg-adnoc-blue/10 px-2 py-0.5 text-xs text-adnoc-blue">
                      {allAttributes.length} 项
                    </span>
                  )}
                </div>
                {isLoadingAttributes && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在加载当前属性...
                  </div>
                )}
              </div>

              {attributeLoadError && (
                <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {attributeLoadError}
                </div>
              )}

              {!selectedClassId && !isLoadingAttributes && allAttributes.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  选择 Class 后加载可填写属性
                </div>
              )}

              {selectedClassId && !isLoadingAttributes && !attributeLoadError && allAttributes.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  当前 Class 没有关联属性
                </div>
              )}

              {commonAttributes.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-400">公共属性</p>
                  {renderAttributeRows(commonAttributes)}
                </div>
              )}

              {classAttributes.length > 0 && (
                <div className={commonAttributes.length > 0 ? 'mt-5 space-y-3' : 'space-y-3'}>
                  <p className="text-xs font-semibold text-slate-400">
                    {selectedClass?.name} 专属属性
                  </p>
                  {renderAttributeRows(classAttributes)}
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-gray-100 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs text-slate-400">
            {selectedClass
              ? `当前 Class: ${selectedClass.code} · ${selectedClass.name}`
              : '请填写必填基础信息，可选 Class 后补充属性'}
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:justify-end">
            <button type="button" onClick={onCancel} className={`${secondaryButtonClass} flex-1 sm:flex-none`}>
              取消
            </button>
            <button type="submit" disabled={!canSubmit} className={`${primaryButtonClass} flex-1 sm:flex-none`}>
              {parentTag ? '创建部件' : '创建 Tag'}
            </button>
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}
