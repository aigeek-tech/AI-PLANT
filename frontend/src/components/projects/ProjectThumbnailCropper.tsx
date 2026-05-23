import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crop, Loader2, X } from 'lucide-react';
import {
  createDefaultProjectThumbnailCrop,
  createProjectThumbnailDataUrl,
  formatProjectThumbnailRatio,
  renderProjectThumbnailPreview,
  type ProjectThumbnailCrop,
  type ProjectThumbnailSource,
} from '../../lib/projectThumbnail';

interface ProjectThumbnailCropperProps {
  source: ProjectThumbnailSource;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

export function ProjectThumbnailCropper({ source, onCancel, onConfirm }: ProjectThumbnailCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cropState, setCropState] = useState<ProjectThumbnailCrop>(() => createDefaultProjectThumbnailCrop());
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    try {
      renderProjectThumbnailPreview(canvas, source.image, cropState);
    } catch (drawError) {
      console.error('Project thumbnail preview failed', drawError);
    }
  }, [cropState, source.image]);

  const updateCropState = <TKey extends keyof ProjectThumbnailCrop>(key: TKey, value: ProjectThumbnailCrop[TKey]) => {
    setCropState((current) => ({ ...current, [key]: value }));
  };

  const handleConfirm = () => {
    setIsConfirming(true);
    setError(null);
    try {
      const dataUrl = createProjectThumbnailDataUrl(source.image, cropState);
      onConfirm(dataUrl);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : '图片压缩失败。');
      setIsConfirming(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={isConfirming ? undefined : onCancel} />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[1.75rem] border border-white bg-white/95 p-6 shadow-2xl shadow-slate-900/20 backdrop-blur-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-adnoc-blue">
              <Crop className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-slate-900">裁切项目缩略图</h2>
              <p className="mt-1 text-sm text-slate-500">
                项目卡片使用 16:9 图片。当前图片比例不匹配，请调整取景后保存。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <span className="sr-only">关闭</span>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <div className="relative aspect-video overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-inner">
              <canvas ref={canvasRef} className="h-full w-full" />
              <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/25" />
              <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/25" />
              <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/25" />
              <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/25" />
            </div>
            {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-[11px] font-bold tracking-[0.2em] text-slate-400">源图片</div>
              <div className="mt-1 truncate text-sm font-bold text-slate-800">{source.fileName}</div>
              <div className="mt-1 text-xs text-slate-500">{formatProjectThumbnailRatio(source.width, source.height)}</div>
            </div>

            <div className="mt-5 space-y-4">
              <CropSlider
                label="缩放"
                value={cropState.zoom}
                min={1}
                max={3}
                step={0.05}
                formatter={(value) => `${value.toFixed(2)}x`}
                onChange={(value) => updateCropState('zoom', value)}
              />
              <CropSlider
                label="水平取景"
                value={cropState.focusX * 100}
                min={0}
                max={100}
                step={1}
                formatter={(value) => `${Math.round(value)}%`}
                onChange={(value) => updateCropState('focusX', value / 100)}
              />
              <CropSlider
                label="垂直取景"
                value={cropState.focusY * 100}
                min={0}
                max={100}
                step={1}
                formatter={(value) => `${Math.round(value)}%`}
                onChange={(value) => updateCropState('focusY', value / 100)}
              />
            </div>

            <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-slate-600">
              保存后会压缩为 WebP 缩略图，目标尺寸为 640 × 360，最大 256 KB。
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirming || Boolean(error)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-adnoc-blue px-6 py-2.5 text-sm font-bold text-white shadow-sm shadow-adnoc-blue/20 transition hover:bg-blue-700 disabled:opacity-50"
          >
            {isConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存缩略图
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CropSlider({
  label,
  value,
  min,
  max,
  step,
  formatter,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-bold text-slate-600">
        <span>{label}</span>
        <span className="font-mono text-slate-400">{formatter(value)}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-adnoc-blue"
      />
    </label>
  );
}
