import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  BellRing,
  CalendarCheck,
  CalendarDays,
  Loader2,
  Package,
  PackagePlus,
  Plug,
  RefreshCw,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useToast } from '../../components/ui/Toast';
import {
  disablePlugin,
  enablePlugin,
  installPlugin,
  listPlugins,
  purgePlugin,
  uninstallPlugin,
  uploadPluginPackage,
  type PluginSummary,
} from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { primaryButtonClass, secondaryButtonClass, softPrimaryButtonClass } from '../../components/ui/buttonStyles';
import { usePlugins } from '../../plugins/PluginProvider';

const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  BellRing,
  CalendarCheck,
  CalendarDays,
  Package,
  PackagePlus,
  Plug,
};

export function PluginCenterPage() {
  const { success, error: showError } = useToast();
  const { refresh: refreshPlugins } = usePlugins();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const loadPlugins = useCallback(async () => {
    setIsLoading(true);
    try {
      setPlugins(await listPlugins());
    } catch (error) {
      showError(error instanceof Error ? error.message : '插件列表加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const uploadFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      showError('请选择 ZIP 插件包');
      return;
    }
    setIsUploading(true);
    try {
      await uploadPluginPackage(file);
      success('插件包已上传');
      await loadPlugins();
    } catch (error) {
      showError(error instanceof Error ? error.message : '插件包上传失败');
    } finally {
      setIsUploading(false);
    }
  }, [loadPlugins, showError, success]);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      await uploadFile(file);
    }
  };

  const runAction = async (pluginId: string, label: string, action: () => Promise<unknown>) => {
    setBusyPluginId(pluginId);
    try {
      await action();
      success(label);
      await loadPlugins();
      await refreshPlugins();
    } catch (error) {
      showError(error instanceof Error ? error.message : label);
    } finally {
      setBusyPluginId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-adnoc-blue">系统设置</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">插件中心</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <UploadButton isUploading={isUploading} onChange={handleUpload} />
          <button type="button" className={secondaryButtonClass} onClick={() => void loadPlugins()} disabled={isLoading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </div>

      <UploadDropzone isUploading={isUploading} onFile={uploadFile} onChange={handleUpload} />

      {isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm font-semibold text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载插件
        </Card>
      ) : plugins.length === 0 ? (
        <Card className="p-8 text-center text-sm font-semibold text-slate-400">暂无插件包。</Card>
      ) : (
        <div className="grid gap-4">
          {plugins.map((plugin) => (
            <PluginCard
              key={`${plugin.plugin_id}:${plugin.checksum}`}
              plugin={plugin}
              busyPluginId={busyPluginId}
              runAction={runAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadDropzone({
  isUploading,
  onFile,
  onChange,
}: {
  isUploading: boolean;
  onFile: (file: File) => Promise<void>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!isUploading) {
      setIsDragging(true);
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !isUploading) {
      void onFile(file);
    }
  };

  return (
    <label
      className={clsx(
        'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-white/80 px-6 py-8 text-center transition',
        isDragging ? 'border-adnoc-blue bg-blue-50/80 shadow-md' : 'border-slate-300 hover:border-adnoc-blue/70 hover:bg-blue-50/40',
        isUploading && 'cursor-wait opacity-70',
      )}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-50 text-adnoc-blue">
        {isUploading ? <Loader2 className="h-7 w-7 animate-spin" /> : <PackagePlus className="h-7 w-7" />}
      </div>
      <h2 className="mt-4 text-lg font-black text-slate-900">{isDragging ? '松开以上传插件包' : '上传 ZIP 插件包'}</h2>
      <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-slate-500">
        拖拽已签名的 ZIP 插件包到这里，或点击选择文件。上传后可继续安装、启用、停用和清除数据。
      </p>
      <input type="file" accept=".zip" className="hidden" disabled={isUploading} onChange={onChange} />
    </label>
  );
}

function UploadButton({
  isUploading,
  onChange,
}: {
  isUploading: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className={primaryButtonClass}>
      {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
      {isUploading ? '正在上传' : '上传 ZIP'}
      <input type="file" accept=".zip" className="hidden" disabled={isUploading} onChange={onChange} />
    </label>
  );
}

function PluginCard({
  plugin,
  busyPluginId,
  runAction,
}: {
  plugin: PluginSummary;
  busyPluginId: string | null;
  runAction: (pluginId: string, label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const Icon = PLUGIN_ICON_MAP[plugin.manifest.icon ?? ''] ?? Plug;
  const name = plugin.manifest.name || plugin.plugin_id;
  const description = plugin.manifest.description || '该插件暂未提供功能说明。';
  const routes = plugin.manifest.frontend?.routes ?? [];
  const permissions = plugin.manifest.permissions ?? [];
  const schemas = plugin.manifest.database?.schemas ?? [];
  const moduleType = plugin.manifest.module?.type === 'trusted' ? '可信模块' : '模块插件';

  return (
    <Card className="border-slate-200/70 bg-white/80">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-adnoc-blue">
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 className="font-black text-slate-900">{name}</h2>
            <p className="mt-1 font-mono text-xs text-slate-400">{plugin.plugin_id} / {plugin.package_version}</p>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">{description}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{moduleType}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{routes.length} 个页面</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{permissions.length} 个权限</span>
              {schemas.length > 0 ? <span className="rounded-full bg-slate-100 px-2.5 py-1">{schemas.join(', ')}</span> : null}
            </div>
            {plugin.error_message ? <p className="mt-2 text-sm font-semibold text-red-600">{plugin.error_message}</p> : null}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-500">{plugin.status}</span>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionButton label="安装" plugin={plugin} busyPluginId={busyPluginId} onClick={() => runAction(plugin.plugin_id, '插件已安装', () => installPlugin(plugin.plugin_id))} />
        <ActionButton label="启用" plugin={plugin} busyPluginId={busyPluginId} onClick={() => runAction(plugin.plugin_id, '插件已启用', () => enablePlugin(plugin.plugin_id))} />
        <ActionButton label="停用" plugin={plugin} busyPluginId={busyPluginId} onClick={() => runAction(plugin.plugin_id, '插件已停用', () => disablePlugin(plugin.plugin_id))} />
        <ActionButton label="卸载" plugin={plugin} busyPluginId={busyPluginId} onClick={() => runAction(plugin.plugin_id, '插件已卸载', () => uninstallPlugin(plugin.plugin_id))} />
        <ActionButton label="清除数据" plugin={plugin} busyPluginId={busyPluginId} onClick={() => runAction(plugin.plugin_id, '插件数据已清除', () => purgePlugin(plugin.plugin_id))} />
      </div>
    </Card>
  );
}

function ActionButton({
  label,
  plugin,
  busyPluginId,
  onClick,
}: {
  label: string;
  plugin: PluginSummary;
  busyPluginId: string | null;
  onClick: () => void;
}) {
  const disabled = busyPluginId === plugin.plugin_id || !canRunAction(label, plugin.status);
  return (
    <button type="button" className={label === '启用' ? softPrimaryButtonClass : secondaryButtonClass} disabled={disabled} onClick={onClick}>
      {busyPluginId === plugin.plugin_id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {label}
    </button>
  );
}

function canRunAction(label: string, status: PluginSummary['status']) {
  if (label === '安装') {
    return ['uploaded', 'disabled', 'failed', 'uninstalled', 'purged'].includes(status);
  }
  if (label === '启用') {
    return ['uploaded', 'disabled', 'failed', 'uninstalled', 'purged'].includes(status);
  }
  if (label === '停用') {
    return status === 'enabled';
  }
  if (label === '卸载') {
    return ['enabled', 'disabled', 'failed'].includes(status);
  }
  if (label === '清除数据') {
    return ['disabled', 'failed', 'uninstalled', 'purged'].includes(status);
  }
  return true;
}
