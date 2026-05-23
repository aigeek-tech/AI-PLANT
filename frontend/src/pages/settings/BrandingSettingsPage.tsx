import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Image, Loader2, RotateCcw, Save, Type } from 'lucide-react';
import aigeekLogo from '../../assets/aigeek-logo.png';
import { useBranding } from '../../branding/BrandingProvider';
import { Card } from '../../components/ui/Card';
import {
  primaryButtonClass,
  primaryButtonIconClass,
  secondaryButtonClass,
  secondaryButtonIconClass,
} from '../../components/ui/buttonStyles';
import {
  getBrandingSettings,
  updateBrandingSettings,
  type BrandingSettings,
  type BrandingSettingsPayload,
} from '../../lib/api';

interface BrandingForm {
  system_name: string;
  sidebar_title: string;
  logo_data_url: string | null;
}

type NoticeState = { type: 'success' | 'error'; text: string } | null;

const EMPTY_FORM: BrandingForm = {
  system_name: 'AI PLANT',
  sidebar_title: '智能工厂',
  logo_data_url: null,
};

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ICON_SIZE_BYTES = 256 * 1024;

function toForm(settings: BrandingSettings): BrandingForm {
  return {
    system_name: settings.system_name,
    sidebar_title: settings.sidebar_title,
    logo_data_url: settings.logo_data_url,
  };
}

function toPayload(form: BrandingForm): BrandingSettingsPayload {
  const systemName = form.system_name.trim();
  const sidebarTitle = form.sidebar_title.trim();

  if (!systemName || !sidebarTitle) {
    throw new Error('系统名称和左上角文字不能为空。');
  }

  return {
    system_name: systemName,
    sidebar_title: sidebarTitle,
    logo_data_url: form.logo_data_url,
  };
}

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return '尚未保存';
  }

  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('图标读取失败，请重试。'));
    };
    reader.onerror = () => reject(new Error('图标读取失败，请重试。'));
    reader.readAsDataURL(file);
  });
}

function Notice({ notice }: { notice: NoticeState }) {
  if (!notice) {
    return null;
  }

  const isSuccess = notice.type === 'success';
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
        isSuccess ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
      }`}
    >
      {isSuccess ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{notice.text}</span>
    </div>
  );
}

export function BrandingSettingsPage() {
  const { setBranding } = useBranding();
  const [settings, setSettings] = useState<BrandingSettings | null>(null);
  const [form, setForm] = useState<BrandingForm>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const data = await getBrandingSettings();
        if (!cancelled) {
          setSettings(data);
          setForm(toForm(data));
        }
      } catch {
        if (!cancelled) {
          setLoadError('加载项目基础信息失败，请确认后端服务与数据库迁移已完成。');
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
  }, []);

  const updateForm = <TField extends keyof BrandingForm>(field: TField, value: BrandingForm[TField]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setNotice(null);
  };

  const resetForm = () => {
    setForm(settings ? toForm(settings) : EMPTY_FORM);
    setNotice(null);
  };

  const handleIconUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setNotice({ type: 'error', text: '图标必须是 JPEG、PNG 或 WebP 图片。' });
      event.target.value = '';
      return;
    }

    if (file.size > MAX_ICON_SIZE_BYTES) {
      setNotice({ type: 'error', text: '图标必须小于等于 256 KB。' });
      event.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      updateForm('logo_data_url', dataUrl);
      setNotice({ type: 'success', text: `已载入图标文件：${file.name}` });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '图标读取失败，请重试。' });
    } finally {
      event.target.value = '';
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);

    let payload: BrandingSettingsPayload;
    try {
      payload = toPayload(form);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存失败，请检查输入内容。' });
      return;
    }

    setIsSaving(true);
    try {
      const saved = await updateBrandingSettings(payload);
      setSettings(saved);
      setForm(toForm(saved));
      setBranding(saved);
      setNotice({ type: 'success', text: '项目基础信息已保存。' });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? `保存失败: ${error.message}` : '保存失败，请稍后重试。',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-adnoc-blue" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-rose-200 bg-rose-50/60 text-center">
        <AlertCircle className="mb-4 h-8 w-8 text-rose-600" />
        <h3 className="font-semibold text-rose-950">加载失败</h3>
        <p className="mt-2 text-sm text-rose-700">{loadError}</p>
      </div>
    );
  }

  const previewLogo = form.logo_data_url ?? aigeekLogo;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="rounded-2xl border border-slate-200 p-0 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">系统名称</span>
                <input
                  value={form.system_name}
                  onChange={(event) => updateForm('system_name', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                  placeholder="例如：AI PLANT"
                />
              </label>

              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">左上角文字</span>
                <input
                  value={form.sidebar_title}
                  onChange={(event) => updateForm('sidebar_title', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                  placeholder="例如：智能工厂"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">左上角图标</h2>
                  <p className="mt-1 text-xs text-slate-500">支持 JPEG、PNG、WebP，大小不超过 256 KB。留空时继续使用默认图标。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => void handleIconUpload(event)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={secondaryButtonClass}
                    disabled={isSaving}
                  >
                    <span className={secondaryButtonIconClass}>
                      <Image className="h-4 w-4" />
                    </span>
                    上传图标
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm('logo_data_url', null)}
                    className={secondaryButtonClass}
                    disabled={isSaving || form.logo_data_url === null}
                  >
                    <span className={secondaryButtonIconClass}>
                      <RotateCcw className="h-4 w-4" />
                    </span>
                    恢复默认
                  </button>
                </div>
              </div>
            </div>

            <Notice notice={notice} />

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
              <button type="button" onClick={resetForm} disabled={isSaving} className={secondaryButtonClass}>
                <span className={secondaryButtonIconClass}>
                  <RotateCcw className="h-4 w-4" />
                </span>
                重置
              </button>
              <button type="submit" disabled={isSaving} className={primaryButtonClass}>
                <span className={primaryButtonIconClass}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </span>
                保存设置
              </button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-2xl border border-slate-200">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <Type className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-slate-900">当前配置摘要</h2>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4">
                    <span>系统名称</span>
                    <span className="truncate font-medium text-slate-900">{form.system_name || '-'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>左上角文字</span>
                    <span className="truncate font-medium text-slate-900">{form.sidebar_title || '-'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>自定义图标</span>
                    <span className="font-medium text-slate-900">{form.logo_data_url ? '已配置' : '使用默认'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>最后保存</span>
                    <span className="font-medium text-slate-900">{formatUpdatedAt(settings?.updated_at ?? null)}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">左上角预览</h2>
            <div className="mt-4 rounded-2xl bg-adnoc-blue p-4 text-white shadow-lg shadow-blue-900/20">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white p-1.5">
                  <img src={previewLogo} alt={`${form.system_name} 图标`} className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-base font-bold tracking-wide">{form.sidebar_title || '智能工厂'}</div>
                  <div className="truncate text-xs text-blue-100/80">{form.system_name || 'AI PLANT'}</div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
