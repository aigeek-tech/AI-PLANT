import { useDeferredValue, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { BookOpen, Search, Sparkles, Loader2, Plus, ArrowRight, Upload, Trash2, Download } from 'lucide-react';
import { PermissionGate } from '../../auth/PermissionGate';
import { getStandards, createStandard, deleteStandard, downloadStandardExport, type Standard } from '../../lib/api';
import { createStandardIconPreview } from '../../lib/standardAssets';
import { getStandardKindLabel, localizeStandardSummary } from '../../lib/standardLocalization';
import { useToast } from '../../components/ui/Toast';
import { useDialog } from '../../components/ui/Dialog';
import { StandardImportDialog } from '../../components/standards/StandardImportDialog';

function downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
}

function safeFilename(value: string) {
    return value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'standard';
}

export function StandardsPage() {
    const navigate = useNavigate();
    const { success, error: showError } = useToast();
    const { confirm } = useDialog();
    const [standards, setStandards] = useState<Standard[]>([]);
    const [search, setSearch] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [deletingStandardId, setDeletingStandardId] = useState<string | null>(null);
    const [exportingStandardId, setExportingStandardId] = useState<string | null>(null);

    const deferredSearch = useDeferredValue(search);

    async function refreshStandards() {
        const data = await getStandards();
        setStandards(data.map(localizeStandardSummary));
    }

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setIsLoading(true);
            setError(null);

            try {
                const data = await getStandards();
                if (!cancelled) setStandards(data.map(localizeStandardSummary));
            } catch {
                if (!cancelled) setError('加载标准数据失败，请稍后重试。');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, []);

    const filteredStandards = useMemo(() => {
        const keyword = deferredSearch.trim().toLowerCase();
        if (!keyword) return standards;

        return standards.filter((item) =>
            item.code.toLowerCase().includes(keyword) ||
            item.name.toLowerCase().includes(keyword)
        );
    }, [standards, deferredSearch]);

    const handleCreateStandard = async (payload: { code: string; name: string; version_label: string; thumbnail_url?: string }) => {
        try {
            const newStandard = await createStandard({
                code: payload.code,
                name: payload.name,
                version_label: payload.version_label,
                thumbnail_url: payload.thumbnail_url
            });
            setStandards(prev => [...prev, localizeStandardSummary(newStandard)]);
            setIsCreating(false);
        } catch {
            showError('创建标准失败，请稍后重试。');
        }
    };

    const handleDeleteStandard = async (standard: Standard) => {
        const accepted = await confirm({
            title: '删除标准',
            description: `确认删除标准“${standard.name}”吗？如果标准已被项目、TAG、图纸或 PBS 节点引用，系统会阻止删除；可删除时会同时移除该标准下的类别、属性、文档类型和 PBS 层级模板。`,
            confirmText: '删除标准',
            danger: true,
        });
        if (!accepted) {
            return;
        }

        setDeletingStandardId(standard.id);
        try {
            await deleteStandard(standard.id);
            setStandards((prev) => prev.filter((item) => item.id !== standard.id));
            success(`标准“${standard.name}”已删除`);
        } catch (deleteError) {
            const message =
                deleteError instanceof Error && deleteError.message === 'Forbidden'
                    ? '当前账号没有删除标准权限'
                    : deleteError instanceof Error
                        ? deleteError.message
                        : '删除标准失败';
            showError(message);
        } finally {
            setDeletingStandardId((current) => current === standard.id ? null : current);
        }
    };

    const handleExportStandard = async (standard: Standard) => {
        setExportingStandardId(standard.id);
        try {
            const blob = await downloadStandardExport(standard.id);
            downloadBlob(blob, `${safeFilename(standard.code)}-standard-export.xlsx`);
            success(`标准“${standard.name}”已开始导出`);
        } catch (exportError) {
            showError(exportError instanceof Error ? exportError.message : '标准导出失败');
        } finally {
            setExportingStandardId((current) => current === standard.id ? null : current);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-adnoc-blue" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-64 flex-col items-center justify-center text-center">
                <Sparkles className="mx-auto h-8 w-8 text-red-600 mb-4" />
                <h3 className="font-semibold text-gray-900">加载失败</h3>
                <p className="mt-2 text-sm text-gray-600">{error}</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">
            <div className="flex items-end justify-between gap-6">
                <div>
                    <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight">标准管理</h2>
                </div>
                <PermissionGate permission="standard.write">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsImporting(true)}
                            className="group flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-5 py-2.5 text-sm font-semibold text-primary-700 shadow-sm shadow-primary-100/80 transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:bg-primary-100 hover:shadow-md hover:shadow-primary-200/80 active:scale-95"
                        >
                            <div className="rounded-md bg-white/80 p-1 transition-colors group-hover:bg-white">
                                <Upload className="h-4 w-4" />
                            </div>
                            AI 录入标准
                        </button>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="group flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary-600/20 transition-all hover:-translate-y-0.5 hover:bg-primary-700 hover:shadow-md hover:shadow-primary-600/30 active:scale-95"
                        >
                            <div className="rounded-md bg-white/20 p-1 transition-colors group-hover:bg-white/30">
                                <Plus className="h-4 w-4" />
                            </div>
                            创建标准
                        </button>
                    </div>
                </PermissionGate>
            </div>

            {isCreating && (
                <CreateStandardModal
                    onClose={() => setIsCreating(false)}
                    onSubmit={handleCreateStandard}
                />
            )}

            <StandardImportDialog
                open={isImporting}
                targetMode="new"
                onClose={() => setIsImporting(false)}
                onImported={() => {
                    void refreshStandards();
                }}
            />

            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-xl group">
                    <Search className="absolute left-4 top-1/2 w-5 h-5 -translate-y-1/2 text-slate-400 group-focus-within:text-adnoc-blue transition-colors" />
                    <input
                        type="text"
                        placeholder="搜索标准名称..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white/50 backdrop-blur-sm rounded-2xl border border-slate-200 focus:outline-none focus:ring-4 focus:ring-adnoc-blue/5 focus:border-adnoc-blue transition-all"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {filteredStandards.map((std, idx) => (
                    <div
                        key={std.id}
                        style={{ animationDelay: `${idx * 100}ms` }}
                        className="animate-fade-in"
                    >
                        <Card
                            className="glass-card premium-hover h-full cursor-pointer p-0 overflow-hidden group"
                        >
                            <div
                                className="relative p-8 h-full flex flex-col"
                                onClick={() => navigate(`/standards/${std.id}`)}
                            >
                                <PermissionGate permission="standard.write" scopeId={std.id}>
                                    <button
                                        type="button"
                                        title="删除标准"
                                        disabled={deletingStandardId === std.id}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void handleDeleteStandard(std);
                                        }}
                                        className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-100 bg-white/80 text-red-500 opacity-0 shadow-sm backdrop-blur transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {deletingStandardId === std.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                    </button>
                                </PermissionGate>
                                <button
                                    type="button"
                                    title="导出标准"
                                    disabled={exportingStandardId === std.id}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void handleExportStandard(std);
                                    }}
                                    className="absolute right-16 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-blue-100 bg-white/80 text-adnoc-blue opacity-0 shadow-sm backdrop-blur transition-all hover:border-blue-200 hover:bg-blue-50 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {exportingStandardId === std.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Download className="h-4 w-4" />
                                    )}
                                </button>
                                <div className="flex items-start gap-5">
                                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 text-adnoc-blue flex items-center justify-center shrink-0 border border-blue-100/50 group-hover:scale-110 transition-transform duration-300 shadow-inner">
                                        {std.thumbnail_url ? (
                                            <img src={std.thumbnail_url} alt="标准图标" className="w-full h-full object-cover rounded-2xl" />
                                        ) : (
                                            <BookOpen className="w-7 h-7" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center bg-blue-50/50 w-fit px-2.5 py-0.5 rounded-lg border border-blue-100/50">
                                            <span className="text-xs font-bold text-adnoc-blue tracking-wide">
                                                {getStandardKindLabel(std.code)}
                                            </span>
                                        </div>
                                        <h3 className="mt-2 font-bold text-slate-900 text-lg leading-snug group-hover:text-adnoc-blue transition-colors truncate">
                                            {std.name}
                                        </h3>
                                        {std.version_label && (
                                            <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold tracking-tight text-slate-600">
                                                版本 {std.version_label}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-auto pt-6 grid grid-cols-2 gap-4 border-t border-slate-100/50 mt-8">
                                    <div className="space-y-1">
                                        <div className="text-xs font-bold tracking-wide text-slate-500">类别数</div>
                                        <div className="text-xl font-extrabold text-slate-700">{std.class_count}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-xs font-bold tracking-wide text-slate-500">属性数</div>
                                        <div className="text-xl font-extrabold text-slate-700">{std.attribute_count}</div>
                                    </div>
                                </div>
                                <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ArrowRight className="w-5 h-5 text-adnoc-blue translate-x-[-10px] group-hover:translate-x-0 transition-transform" />
                                </div>
                            </div>
                        </Card>
                    </div>
                ))}

                {filteredStandards.length === 0 && (
                    <div className="col-span-full py-20 text-center glass-card rounded-3xl border-dashed border-slate-300">
                        <Sparkles className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                        <p className="text-slate-400 font-medium">暂无匹配的标准数据</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function CreateStandardModal({ onClose, onSubmit }: {
    onClose: () => void,
    onSubmit: (payload: { code: string, name: string, version_label: string, thumbnail_url?: string }) => void
}) {
    const { error: showError } = useToast();
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [versionLabel, setVersionLabel] = useState('');
    const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleIconFiles = async (fileList: FileList | File[]) => {
        const [file] = Array.from(fileList);
        if (!file || !file.type.startsWith('image/')) {
            showError('只能上传图片文件');
            return;
        }

        setIsUploading(true);
        try {
            const preview = await createStandardIconPreview(file);
            setThumbnailUrl(preview);
        } catch {
            showError('处理图片失败');
        } finally {
            setIsUploading(false);
        }
    };

    const modalContent = (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white/95 backdrop-blur-xl border border-white shadow-[0_24px_48px_-12px_rgba(0,115,230,0.15)] rounded-[2rem] w-full max-w-md p-8 transform transition-all duration-300">
                <div className="flex items-center gap-6 mb-8">
                    <div 
                        className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 text-adnoc-blue flex items-center justify-center shrink-0 cursor-pointer overflow-hidden border border-blue-100/50 shadow-inner group relative"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {isUploading ? (
                            <Loader2 className="w-8 h-8 animate-spin" />
                        ) : thumbnailUrl ? (
                            <img src={thumbnailUrl} alt="icon" className="w-full h-full object-cover" />
                        ) : (
                            <Upload className="w-8 h-8 text-slate-300 group-hover:text-adnoc-blue transition-colors" />
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-adnoc-blue/80 text-white text-[10px] font-bold text-center py-1 opacity-0 group-hover:opacity-100 transition-opacity">上传图标</div>
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            className="hidden" 
                            accept="image/*" 
                            onChange={(e) => {
                                if (e.target.files) void handleIconFiles(e.target.files);
                            }} 
                        />
                    </div>
                    <div>
                        <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">新增标准</h3>
                        <p className="text-sm font-medium text-slate-500 mt-1">创建新的企业工程标准或规范</p>
                    </div>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="block text-[13px] font-bold text-slate-600 mb-2 tracking-wide">标准编码 <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={code}
                            onChange={e => setCode(e.target.value)}
                            placeholder="例如：Q/SY 1234.1-202X"
                            className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-adnoc-blue/15 focus:border-adnoc-blue focus:bg-white transition-all text-slate-800 placeholder:text-slate-400 font-medium"
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-bold text-slate-600 mb-2 tracking-wide">标准名称 <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="例如：智能制造企业工程建设标准"
                            className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-adnoc-blue/15 focus:border-adnoc-blue focus:bg-white transition-all text-slate-800 placeholder:text-slate-400 font-medium"
                        />
                    </div>
                    <div>
                        <label className="block text-[13px] font-bold text-slate-600 mb-2 tracking-wide">版本标识</label>
                        <input
                            type="text"
                            value={versionLabel}
                            onChange={e => setVersionLabel(e.target.value)}
                            placeholder="例如：2024版"
                            className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-adnoc-blue/15 focus:border-adnoc-blue focus:bg-white transition-all text-slate-800 placeholder:text-slate-400 font-medium"
                        />
                    </div>
                </div>

                <div className="mt-10 flex justify-end gap-3 pt-6 border-t border-slate-100/50">
                    <button 
                        onClick={onClose} 
                        className="px-6 py-3 text-sm font-extrabold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={() => onSubmit({ code, name, version_label: versionLabel, thumbnail_url: thumbnailUrl })}
                        disabled={!code || !name || isUploading}
                        className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-adnoc-blue px-8 py-3 text-sm font-extrabold text-white transition-all duration-300 hover:bg-blue-700 hover:shadow-[0_12px_24px_rgba(0,115,230,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none focus:outline-none focus:ring-4 focus:ring-adnoc-blue/30"
                    >
                        <span className="relative">确认创建</span>
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
