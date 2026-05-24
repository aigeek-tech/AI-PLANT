import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  EyeOff,
  ImagePlus,
  Loader2,
  LogIn,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { useBranding } from '../../branding/BrandingProvider';
import { Card } from '../../components/ui/Card';
import {
  secondaryButtonClass,
  secondaryButtonIconClass,
} from '../../components/ui/buttonStyles';
import {
  LOGIN_BACKGROUND_MAX_FILE_BYTES,
  LOGIN_BACKGROUND_MAX_OUTPUT_BYTES,
  createLoginBackgroundImage,
} from '../../settings/loginBackgroundImage';
import {
  buildApiAssetUrl,
  deleteLoginBackgroundImage,
  uploadLoginBackgroundImage,
} from '../../lib/api';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '../../i18n/locales';
import { useUiDisplaySettings } from '../../settings/uiDisplaySettings';

type NoticeState = { type: 'success' | 'error'; text: string } | null;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    const megabytes = bytes / 1024 / 1024;
    return `${Number.isInteger(megabytes) ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function NoticeBanner({ notice }: { notice: NoticeState }) {
  if (!notice) {
    return null;
  }

  const isSuccess = notice.type === 'success';
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm font-medium ${
        isSuccess ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
      }`}
    >
      <div className="flex items-start gap-3">
        {isSuccess ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>{notice.text}</span>
      </div>
    </div>
  );
}

export function UiDisplaySettingsPage() {
  const { t } = useTranslation();
  const { settings, updateSettings, resetSettings } = useUiDisplaySettings();
  const { can } = useAuth();
  const { branding, setBranding } = useBranding();
  const loginBackgroundInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingLoginBackground, setIsDraggingLoginBackground] = useState(false);
  const [isProcessingLoginBackground, setIsProcessingLoginBackground] = useState(false);
  const [loginBackgroundNotice, setLoginBackgroundNotice] = useState<NoticeState>(null);
  const canWriteLoginBackground = can('system.settings.branding.write');
  const loginBackgroundImageUrl = buildApiAssetUrl(branding.login_background_image_url);
  const loginBackgroundMeta = branding.login_background_image_meta;
  const loginBackgroundByteSize = loginBackgroundMeta?.size_bytes ?? null;

  const handleLoginBackgroundFiles = async (files: FileList | null) => {
    const [file] = Array.from(files ?? []);
    if (loginBackgroundInputRef.current) {
      loginBackgroundInputRef.current.value = '';
    }
    if (!file) {
      return;
    }

    if (!canWriteLoginBackground) {
      setLoginBackgroundNotice({ type: 'error', text: t('settings.noBackgroundPermission') });
      return;
    }

    setIsProcessingLoginBackground(true);
    setLoginBackgroundNotice(null);

    try {
      const result = await createLoginBackgroundImage(file);
      const saved = await uploadLoginBackgroundImage(result.blob, {
        source_file_name: file.name,
        width: result.outputWidth,
        height: result.outputHeight,
      });
      setBranding(saved);
      setLoginBackgroundNotice({
        type: 'success',
        text: t('settings.backgroundUpdated', {
          width: result.outputWidth,
          height: result.outputHeight,
          size: formatBytes(result.byteSize),
        }),
      });
    } catch (error) {
      setLoginBackgroundNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('settings.backgroundFailed'),
      });
    } finally {
      setIsProcessingLoginBackground(false);
    }
  };

  const handleLoginBackgroundInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    void handleLoginBackgroundFiles(event.target.files);
  };

  const handleLoginBackgroundDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (isProcessingLoginBackground || !canWriteLoginBackground) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDraggingLoginBackground(true);
  };

  const handleLoginBackgroundDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setIsDraggingLoginBackground(false);
  };

  const handleLoginBackgroundDrop = (event: DragEvent<HTMLDivElement>) => {
    if (isProcessingLoginBackground || !canWriteLoginBackground) {
      return;
    }
    event.preventDefault();
    setIsDraggingLoginBackground(false);
    void handleLoginBackgroundFiles(event.dataTransfer.files);
  };

  const handleLoginBackgroundKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isProcessingLoginBackground || !canWriteLoginBackground || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }
    event.preventDefault();
    loginBackgroundInputRef.current?.click();
  };

  const clearLoginBackground = async () => {
    if (!canWriteLoginBackground) {
      setLoginBackgroundNotice({ type: 'error', text: t('settings.noBackgroundPermission') });
      return;
    }

    setIsProcessingLoginBackground(true);
    setLoginBackgroundNotice(null);
    try {
      const saved = await deleteLoginBackgroundImage();
      setBranding(saved);
      setLoginBackgroundNotice({ type: 'success', text: t('settings.backgroundReset') });
    } catch (error) {
      setLoginBackgroundNotice({
        type: 'error',
        text: error instanceof Error ? t('settings.backgroundRemoveFailed', { message: error.message }) : t('settings.backgroundRemoveFailedFallback'),
      });
    } finally {
      setIsProcessingLoginBackground(false);
    }
  };

  const handleResetSettings = () => {
    resetSettings();
    setLoginBackgroundNotice({ type: 'success', text: t('settings.preferencesReset') });
  };

  return (
    <div className="space-y-5">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 rounded-2xl border border-slate-200 p-0 shadow-sm">
          <div className="space-y-5 p-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Code2 className="h-4 w-4 text-adnoc-blue" />
                    {t('settings.classCodeSetting')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {t('settings.classCodeDescription')}
                  </p>
                </div>
                <label className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-adnoc-blue/30">
                  <input
                    type="checkbox"
                    checked={settings.showStandardClassCodes}
                    onChange={(event) => updateSettings({ showStandardClassCodes: event.target.checked })}
                    className="h-4 w-4 accent-adnoc-blue"
                  />
                  {t('settings.showClassCodes')}
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <SlidersHorizontal className="h-4 w-4 text-adnoc-blue" />
                    {t('common.language')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{t('settings.languageDescription')}</p>
                </div>
                <select
                  value={settings.locale}
                  onChange={(event) => updateSettings({ locale: event.target.value as SupportedLocale })}
                  className="h-10 max-w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                >
                  {SUPPORTED_LOCALES.map((locale) => (
                    <option key={locale} value={locale}>
                      {LOCALE_LABELS[locale]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <LogIn className="h-4 w-4 text-adnoc-blue" />
                    {t('settings.loginPage')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {t('settings.loginBackgroundDescription', {
                      sourceMax: formatBytes(LOGIN_BACKGROUND_MAX_FILE_BYTES),
                      outputMax: formatBytes(LOGIN_BACKGROUND_MAX_OUTPUT_BYTES),
                    })}
                  </p>
                  {!canWriteLoginBackground ? (
                    <p className="mt-1 text-xs font-medium text-amber-600">{t('settings.loginBackgroundReadonly')}</p>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <input
                    ref={loginBackgroundInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleLoginBackgroundInputChange}
                  />
                  <button
                    type="button"
                    onClick={() => loginBackgroundInputRef.current?.click()}
                    className={secondaryButtonClass}
                    disabled={isProcessingLoginBackground || !canWriteLoginBackground}
                  >
                    <span className={secondaryButtonIconClass}>
                      {isProcessingLoginBackground ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    </span>
                    {t('settings.uploadBackground')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearLoginBackground()}
                    className={secondaryButtonClass}
                    disabled={isProcessingLoginBackground || !canWriteLoginBackground || !loginBackgroundImageUrl}
                  >
                    <span className={secondaryButtonIconClass}>
                      <Trash2 className="h-4 w-4" />
                    </span>
                    {t('settings.removeBackground')}
                  </button>
                </div>
              </div>

              <div
                tabIndex={0}
                onKeyDown={handleLoginBackgroundKeyDown}
                onDragOver={handleLoginBackgroundDragOver}
                onDragLeave={handleLoginBackgroundDragLeave}
                onDrop={handleLoginBackgroundDrop}
                className={`mt-4 rounded-2xl border p-3 outline-none transition ${
                  isDraggingLoginBackground
                    ? 'border-adnoc-blue bg-blue-50/70 ring-2 ring-adnoc-blue/15'
                    : 'border-dashed border-slate-300 bg-white/80 focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10'
                }`}
              >
                <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <div className="aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                    {loginBackgroundImageUrl ? (
                      <img
                        src={loginBackgroundImageUrl}
                        alt={t('settings.backgroundPreviewAlt')}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-slate-100 text-slate-300">
                        <ImagePlus className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col justify-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {loginBackgroundImageUrl ? t('settings.backgroundConfigured') : t('settings.backgroundDropTitle')}
                    </p>
                    <p className="text-xs leading-5 text-slate-500">
                      {t('settings.backgroundHint')}
                    </p>
                    <p className={`text-xs font-medium ${isDraggingLoginBackground ? 'text-adnoc-blue' : 'text-slate-400'}`}>
                      {isDraggingLoginBackground ? t('settings.backgroundDropActive') : t('settings.backgroundDropIdle')}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <NoticeBanner notice={loginBackgroundNotice} />

            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('settings.displayPreferenceNote')}</span>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
              <button type="button" onClick={handleResetSettings} className={secondaryButtonClass}>
                <span className={secondaryButtonIconClass}>
                  <RotateCcw className="h-4 w-4" />
                </span>
                {t('common.reset')}
              </button>
            </div>
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="min-w-0 rounded-2xl border border-slate-200">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-slate-900">{t('settings.displayTitle')}</h2>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <div className="flex min-w-0 justify-between gap-4">
                    <span>{t('settings.classCode')}</span>
                    <span className="font-medium text-slate-900">
                      {settings.showStandardClassCodes ? t('settings.show') : t('settings.hide')}
                    </span>
                  </div>
                  <div className="flex min-w-0 justify-between gap-4">
                    <span>{t('settings.loginBackground')}</span>
                    <span className="font-medium text-slate-900">
                      {loginBackgroundImageUrl ? t('settings.custom') : t('settings.default')}
                    </span>
                  </div>
                  <div className="flex min-w-0 justify-between gap-4">
                    <span>{t('common.language')}</span>
                    <span className="font-medium text-slate-900">{LOCALE_LABELS[settings.locale]}</span>
                  </div>
                  {loginBackgroundByteSize ? (
                    <div className="flex min-w-0 justify-between gap-4">
                      <span>{t('settings.backgroundSize')}</span>
                      <span className="font-medium text-slate-900">{formatBytes(loginBackgroundByteSize)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>

          <Card className="min-w-0 rounded-2xl border border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">{t('settings.treePreview')}</h2>
            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex min-w-0 items-center gap-2 rounded-lg bg-blue-50/70 px-3 py-2 text-adnoc-blue">
                <EyeOff className="h-4 w-4 shrink-0" />
                <span className="truncate text-sm font-bold">infrastructure facility and long class name</span>
                {settings.showStandardClassCodes && (
                  <span className="shrink-0 rounded-md bg-blue-100/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-blue-700">
                    CFIHOS-3000097
                  </span>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
