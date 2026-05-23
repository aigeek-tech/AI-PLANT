import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ServerCog,
  TestTubeDiagonal,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import {
  primaryButtonClass,
  primaryButtonIconClass,
  secondaryButtonClass,
  secondaryButtonIconClass,
  softPrimaryButtonClass,
  softPrimaryButtonIconClass,
} from '../../components/ui/buttonStyles';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import {
  discoverAiModels,
  getAiSettings,
  testAiSettings,
  updateAiSettings,
  type AiEndpointSettings,
  type AiEndpointSettingsPayload,
  type AiEndpointTestResult,
  type AiModelOption,
} from '../../lib/api';

interface AiSettingsForm {
  provider: string;
  base_url: string;
  endpoint_path: string;
  model: string;
  api_key: string;
  clear_api_key: boolean;
  temperature: string;
  max_tokens: string;
  timeout_seconds: string;
  is_enabled: boolean;
}

type NoticeState = { type: 'success' | 'error'; text: string } | null;

const EMPTY_FORM: AiSettingsForm = {
  provider: 'openai-compatible',
  base_url: '',
  endpoint_path: '/v1/chat/completions',
  model: '',
  api_key: '',
  clear_api_key: false,
  temperature: '0.2',
  max_tokens: '',
  timeout_seconds: '60',
  is_enabled: true,
};

function toForm(settings: AiEndpointSettings): AiSettingsForm {
  return {
    provider: settings.provider,
    base_url: settings.base_url,
    endpoint_path: settings.endpoint_path,
    model: settings.model,
    api_key: '',
    clear_api_key: false,
    temperature: String(settings.temperature),
    max_tokens: settings.max_tokens?.toString() ?? '',
    timeout_seconds: String(settings.timeout_seconds),
    is_enabled: settings.is_enabled,
  };
}

function toPayload(form: AiSettingsForm): AiEndpointSettingsPayload {
  const provider = form.provider.trim();
  const baseUrl = form.base_url.trim().replace(/\/$/, '');
  const endpointPath = form.endpoint_path.trim();
  const model = form.model.trim();
  const apiKey = form.api_key.trim();

  if (!provider || !baseUrl || !endpointPath) {
    throw new Error('Provider、Base URL、Endpoint Path 不能为空。');
  }

  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    throw new Error('Base URL 必须以 http:// 或 https:// 开头。');
  }

  if (!endpointPath.startsWith('/')) {
    throw new Error('Endpoint Path 必须以 / 开头。');
  }

  const temperature = Number(form.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('Temperature 必须在 0 到 2 之间。');
  }

  const maxTokens = form.max_tokens.trim() ? Number(form.max_tokens) : null;
  if (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens <= 0)) {
    throw new Error('Max tokens 必须是正整数，或留空。');
  }

  const timeoutSeconds = Number(form.timeout_seconds);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 600) {
    throw new Error('Timeout 必须是 1 到 600 秒之间的整数。');
  }

  return {
    provider,
    base_url: baseUrl,
    endpoint_path: endpointPath,
    model,
    api_key: apiKey || null,
    clear_api_key: apiKey ? false : form.clear_api_key,
    temperature,
    max_tokens: maxTokens,
    timeout_seconds: timeoutSeconds,
    is_enabled: form.is_enabled,
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

function Notice({ notice }: { notice: NoticeState }) {
  if (!notice) {
    return null;
  }

  const isSuccess = notice.type === 'success';
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${isSuccess
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-rose-200 bg-rose-50 text-rose-800'
        }`}
    >
      {isSuccess ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{notice.text}</span>
    </div>
  );
}

export function AiSettingsPage() {
  const [settings, setSettings] = useState<AiEndpointSettings | null>(null);
  const [form, setForm] = useState<AiSettingsForm>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDiscoveringModels, setIsDiscoveringModels] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [modelNotice, setModelNotice] = useState<NoticeState>(null);
  const [testResult, setTestResult] = useState<AiEndpointTestResult | null>(null);

  const supportsModelDiscovery = true;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const data = await getAiSettings();
        if (!cancelled) {
          setSettings(data);
          setForm(toForm(data));
        }
      } catch {
        if (!cancelled) {
          setLoadError('加载 AI 设置失败，请确认后端服务与数据库迁移已完成。');
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

  const updateForm = <TField extends keyof AiSettingsForm>(field: TField, value: AiSettingsForm[TField]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setNotice(null);
    setTestResult(null);
    if (field === 'provider') {
      setModels([]);
      setModelNotice(null);
    }
  };

  const resetForm = () => {
    setForm(settings ? toForm(settings) : EMPTY_FORM);
    setNotice(null);
    setModelNotice(null);
    setTestResult(null);
  };

  const buildPayload = () => {
    const payload = toPayload(form);
    return payload;
  };

  const handleFetchModels = async () => {
    setModelNotice(null);
    setTestResult(null);

    let payload: AiEndpointSettingsPayload;
    try {
      payload = buildPayload();
    } catch (error) {
      setModelNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) });
      return;
    }

    setIsDiscoveringModels(true);
    try {
      const result = await discoverAiModels(payload);
      setModels(result.models);
      setModelNotice({
        type: 'success',
        text: result.count > 0 ? `已获取 ${result.count} 个模型，可直接选择，也可继续手动输入。` : '接口连通，但没有返回模型列表。',
      });
    } catch (error) {
      setModels([]);
      setModelNotice({
        type: 'error',
        text: error instanceof Error ? `获取模型失败: ${error.message}` : '获取模型失败，请稍后重试。',
      });
    } finally {
      setIsDiscoveringModels(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);

    let payload: AiEndpointSettingsPayload;
    try {
      payload = buildPayload();
      if (!payload.model) {
        throw new Error('保存前请填写模型名称。');
      }
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) });
      return;
    }

    setIsSaving(true);
    try {
      const saved = await updateAiSettings(payload);
      setSettings(saved);
      setForm(toForm(saved));
      setNotice({ type: 'success', text: 'AI 设置已保存。' });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? `保存失败: ${error.message}` : '保存失败，请稍后重试。',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setNotice(null);

    let payload: AiEndpointSettingsPayload;
    try {
      payload = buildPayload();
      if (!payload.model) {
        throw new Error('测试前请先选择或填写模型。');
      }
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) });
      return;
    }

    setIsTesting(true);
    try {
      const result = await testAiSettings(payload);
      setTestResult(result);
      setNotice({ type: 'success', text: '测试完成，右侧已展示返回结果。' });
    } catch (error) {
      setTestResult(null);
      setNotice({
        type: 'error',
        text: error instanceof Error ? `测试失败: ${error.message}` : '测试失败，请稍后重试。',
      });
    } finally {
      setIsTesting(false);
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

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="rounded-2xl border border-slate-200 p-0 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provider Name</span>
                <input
                  value={form.provider}
                  onChange={(event) => updateForm('provider', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                  placeholder="例如 ai-geek / deepseek / openai"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">状态</span>
                <span className="flex h-[42px] items-center rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_enabled}
                    onChange={(event) => updateForm('is_enabled', event.target.checked)}
                    className="mr-3 h-4 w-4 accent-adnoc-blue"
                  />
                  启用这个默认端点
                </span>
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Base URL</span>
                <input
                  value={form.base_url}
                  onChange={(event) => updateForm('base_url', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                  placeholder="https://api.example.com"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Endpoint Path</span>
                <input
                  value={form.endpoint_path}
                  onChange={(event) => updateForm('endpoint_path', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                  placeholder="/v1/chat/completions"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">模型</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    当前按 OpenAI-compatible 协议请求模型列表和测试连接。`Provider Name` 只是标识名，可自定义成 `ai-geek`。
                  </p>
                </div>
                {supportsModelDiscovery && (
                  <button
                    type="button"
                    onClick={() => void handleFetchModels()}
                    disabled={isDiscoveringModels}
                    className={`${secondaryButtonClass} px-3 py-2 text-xs`}
                  >
                    <span className={secondaryButtonIconClass}>
                      {isDiscoveringModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </span>
                    获取模型列表
                  </button>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Discovered Models</span>
                  <SearchableSelect
                    value={models.some((item) => item.id === form.model) ? form.model : ''}
                    onChange={(nextValue) => updateForm('model', nextValue)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                    placeholder="未选择，或当前模型为手动输入"
                    clearable
                    options={models.map((item) => ({
                      value: item.id,
                      label: `${item.id}${item.owned_by ? ` (${item.owned_by})` : ''}`,
                      keywords: item.owned_by ?? '',
                    }))}
                    searchPlaceholder="搜索模型 ID 或提供方"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual Model</span>
                  <input
                    value={form.model}
                    onChange={(event) => updateForm('model', event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                    placeholder="可直接输入列表外模型"
                  />
                </label>
              </div>

              {models.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {models.slice(0, 12).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => updateForm('model', item.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${form.model === item.id
                        ? 'border-adnoc-blue bg-blue-50 text-adnoc-blue'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                        }`}
                    >
                      {item.id}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3">
                <Notice notice={modelNotice} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Temperature</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={form.temperature}
                  onChange={(event) => updateForm('temperature', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Max Tokens</span>
                <input
                  type="number"
                  min="1"
                  value={form.max_tokens}
                  onChange={(event) => updateForm('max_tokens', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                  placeholder="留空"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeout</span>
                <input
                  type="number"
                  min="1"
                  max="600"
                  value={form.timeout_seconds}
                  onChange={(event) => updateForm('timeout_seconds', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                />
              </label>
            </div>

            <div className="grid gap-4">
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <KeyRound className="h-4 w-4" />
                  API Key
                </span>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(event) => updateForm('api_key', event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition focus:border-adnoc-blue focus:ring-2 focus:ring-adnoc-blue/10"
                  placeholder={settings?.has_api_key ? '已保存，留空表示不修改' : '可选，留空表示不配置'}
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.clear_api_key}
                  onChange={(event) => updateForm('clear_api_key', event.target.checked)}
                  disabled={!settings?.has_api_key || Boolean(form.api_key)}
                  className="h-4 w-4 accent-adnoc-blue"
                />
                清除已保存的 API key
              </label>
            </div>

            <Notice notice={notice} />

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={resetForm}
                disabled={isSaving || isTesting || isDiscoveringModels}
                className={secondaryButtonClass}
              >
                <span className={secondaryButtonIconClass}>
                  <RotateCcw className="h-4 w-4" />
                </span>
                重置
              </button>
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={isSaving || isTesting || isDiscoveringModels}
                className={softPrimaryButtonClass}
              >
                <span className={softPrimaryButtonIconClass}>
                  {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTubeDiagonal className="h-4 w-4" />}
                </span>
                测试连接
              </button>
              <button
                type="submit"
                disabled={isSaving || isTesting || isDiscoveringModels}
                className={primaryButtonClass}
              >
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
                <ServerCog className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-slate-900">当前配置摘要</h2>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4">
                    <span>Provider</span>
                    <span className="font-medium text-slate-900">{form.provider || '-'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>模型</span>
                    <span className="truncate font-medium text-slate-900">{form.model || '-'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>密钥</span>
                    <span className="font-medium text-slate-900">{settings?.has_api_key ? '已配置' : '未配置'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>状态</span>
                    <span className={`font-medium ${form.is_enabled ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {form.is_enabled ? '启用' : '停用'}
                    </span>
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
            <h2 className="text-sm font-semibold text-slate-900">测试结果</h2>
            {!testResult ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                点击“测试连接”后，这里会展示实际返回结果、使用的模型和 token 统计。
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  连接成功
                </div>
                <div className="space-y-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-4">
                    <span>请求模型</span>
                    <span className="font-medium text-slate-900">{testResult.requested_model}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>响应模型</span>
                    <span className="font-medium text-slate-900">{testResult.response_model ?? '-'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>模型列表中</span>
                    <span className="font-medium text-slate-900">
                      {testResult.model_found === null ? '未校验' : testResult.model_found ? '是' : '否'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>可用模型数</span>
                    <span className="font-medium text-slate-900">{testResult.available_model_count ?? '-'}</span>
                  </div>
                </div>

                {testResult.discovery_error && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    模型列表获取失败，但连通性测试已完成：{testResult.discovery_error}
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">返回内容</div>
                  <pre className="whitespace-pre-wrap break-words text-sm text-slate-900">
                    {testResult.sample_text || '接口已返回成功，但没有解析到文本内容。'}
                  </pre>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  <div className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
                    <ChevronRight className="h-4 w-4" />
                    用量信息
                  </div>
                  <div className="grid gap-2">
                    <div className="flex justify-between gap-4">
                      <span>Prompt tokens</span>
                      <span className="font-medium text-slate-900">{testResult.usage?.prompt_tokens ?? '-'}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>Completion tokens</span>
                      <span className="font-medium text-slate-900">{testResult.usage?.completion_tokens ?? '-'}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>Total tokens</span>
                      <span className="font-medium text-slate-900">{testResult.usage?.total_tokens ?? '-'}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>Response ID</span>
                      <span className="truncate font-medium text-slate-900">{testResult.raw_id ?? '-'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
