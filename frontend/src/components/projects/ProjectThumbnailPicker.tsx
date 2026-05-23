import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { ProjectThumbnailCropper } from './ProjectThumbnailCropper';
import {
  createDefaultProjectThumbnailCrop,
  createProjectThumbnailDataUrl,
  loadProjectThumbnailSource,
  shouldRequireProjectThumbnailCrop,
  type ProjectThumbnailSource,
} from '../../lib/projectThumbnail';

interface ProjectThumbnailPickerProps {
  value: string | null;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}

export function ProjectThumbnailPicker({ value, disabled = false, onChange }: ProjectThumbnailPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingSource, setPendingSource] = useState<ProjectThumbnailSource | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      pendingSource?.revoke();
    };
  }, [pendingSource]);

  const clearPendingSource = () => {
    setPendingSource((current) => {
      current?.revoke();
      return null;
    });
  };

  const handleFileChange = async (files: FileList | null) => {
    const [file] = Array.from(files ?? []);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    if (!file) {
      return;
    }

    setIsProcessing(true);
    setError(null);
    clearPendingSource();

    try {
      const source = await loadProjectThumbnailSource(file);
      if (shouldRequireProjectThumbnailCrop(source.width, source.height)) {
        setPendingSource(source);
        return;
      }

      const dataUrl = createProjectThumbnailDataUrl(source.image, createDefaultProjectThumbnailCrop());
      source.revoke();
      onChange(dataUrl);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '图片处理失败。');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCropConfirm = (dataUrl: string) => {
    clearPendingSource();
    onChange(dataUrl);
  };

  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (event) => {
    if (disabled || isProcessing) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragLeave: React.DragEventHandler<HTMLDivElement> = (event) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragging(false);
  };

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    if (disabled || isProcessing) {
      return;
    }
    event.preventDefault();
    setIsDragging(false);
    void handleFileChange(event.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <label className="block text-sm font-medium text-gray-700">项目缩略图</label>
        <span className="text-xs text-gray-400">可选，建议 16:9</span>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-2xl border bg-white p-3 shadow-sm transition ${
          isDragging
            ? 'border-adnoc-blue bg-blue-50/50 ring-2 ring-adnoc-blue/15'
            : 'border-slate-200'
        }`}
      >
        <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div className="aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            {value ? (
              <img src={value} alt="项目缩略图预览" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-slate-50 text-slate-300">
                <ImagePlus className="h-8 w-8" />
              </div>
            )}
          </div>

          <div className="flex flex-col justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-800">
                {value ? '已生成项目缩略图' : '上传项目封面图'}
              </p>
              <p className="text-xs leading-5 text-slate-500">
                支持 JPG、PNG、WebP，源文件最大 10 MB。比例不是 16:9 时会先进入裁切，保存前自动压缩为 WebP。
              </p>
              <p className={`text-xs font-medium ${isDragging ? 'text-adnoc-blue' : 'text-slate-400'}`}>
                {isDragging ? '松开鼠标即可上传这张图片。' : '也可以直接把图片拖到这个区域。'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled || isProcessing}
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-adnoc-blue px-3 py-2 text-xs font-bold text-white shadow-sm shadow-adnoc-blue/20 transition hover:bg-blue-700 disabled:opacity-50"
              >
                {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {value ? '更换图片' : '上传图片'}
              </button>
              {value ? (
                <button
                  type="button"
                  disabled={disabled || isProcessing}
                  onClick={() => onChange(null)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  移除
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => void handleFileChange(event.target.files)}
      />

      {pendingSource ? (
        <ProjectThumbnailCropper
          source={pendingSource}
          onCancel={clearPendingSource}
          onConfirm={handleCropConfirm}
        />
      ) : null}
    </div>
  );
}
