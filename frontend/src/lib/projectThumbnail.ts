export const PROJECT_THUMBNAIL_ASPECT_RATIO = 16 / 9;
export const PROJECT_THUMBNAIL_OUTPUT_WIDTH = 640;
export const PROJECT_THUMBNAIL_OUTPUT_HEIGHT = 360;
export const PROJECT_THUMBNAIL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PROJECT_THUMBNAIL_MAX_OUTPUT_BYTES = 256 * 1024;
export const PROJECT_THUMBNAIL_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface ProjectThumbnailCrop {
  zoom: number;
  focusX: number;
  focusY: number;
}

export interface ProjectThumbnailSource {
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  image: HTMLImageElement;
  objectUrl: string;
  revoke: () => void;
}

interface CropRect {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}

export function validateProjectThumbnailFile(file: File) {
  if (!PROJECT_THUMBNAIL_ALLOWED_TYPES.includes(file.type as (typeof PROJECT_THUMBNAIL_ALLOWED_TYPES)[number])) {
    throw new Error('仅支持 JPG、PNG 或 WebP 图片。');
  }

  if (file.size > PROJECT_THUMBNAIL_MAX_FILE_BYTES) {
    throw new Error('图片大小不能超过 10 MB。');
  }
}

export async function loadProjectThumbnailSource(file: File): Promise<ProjectThumbnailSource> {
  validateProjectThumbnailFile(file);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    return {
      fileName: file.name,
      mimeType: file.type,
      width: image.naturalWidth,
      height: image.naturalHeight,
      image,
      objectUrl,
      revoke: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export function shouldRequireProjectThumbnailCrop(width: number, height: number) {
  return Math.abs(width / height - PROJECT_THUMBNAIL_ASPECT_RATIO) > 0.015;
}

export function createDefaultProjectThumbnailCrop(): ProjectThumbnailCrop {
  return {
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
  };
}

export function renderProjectThumbnailPreview(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  crop: ProjectThumbnailCrop,
  width = PROJECT_THUMBNAIL_OUTPUT_WIDTH,
  height = PROJECT_THUMBNAIL_OUTPUT_HEIGHT,
) {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器不支持图片裁切。');
  }

  const cropRect = resolveCropRect(image.naturalWidth, image.naturalHeight, crop);
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    cropRect.sourceX,
    cropRect.sourceY,
    cropRect.sourceWidth,
    cropRect.sourceHeight,
    0,
    0,
    width,
    height,
  );
}

export function createProjectThumbnailDataUrl(
  image: HTMLImageElement,
  crop: ProjectThumbnailCrop,
) {
  const outputSteps = [
    { width: 640, height: 360, quality: 0.84 },
    { width: 560, height: 315, quality: 0.8 },
    { width: 480, height: 270, quality: 0.76 },
    { width: 400, height: 225, quality: 0.72 },
  ];

  const canvas = document.createElement('canvas');
  for (const step of outputSteps) {
    renderProjectThumbnailPreview(canvas, image, crop, step.width, step.height);
    const dataUrl = canvas.toDataURL('image/webp', step.quality);
    if (estimateDataUrlByteSize(dataUrl) <= PROJECT_THUMBNAIL_MAX_OUTPUT_BYTES) {
      return dataUrl;
    }
  }

  throw new Error('图片压缩后仍超过 256 KB，请换一张更简单的图片。');
}

export function formatProjectThumbnailRatio(width: number, height: number) {
  return `${width} × ${height} (${(width / height).toFixed(2)}:1)`;
}

function resolveCropRect(width: number, height: number, crop: ProjectThumbnailCrop): CropRect {
  const safeZoom = clamp(crop.zoom, 1, 3);
  const targetAspect = PROJECT_THUMBNAIL_ASPECT_RATIO;
  const imageAspect = width / height;

  let cropWidth = width;
  let cropHeight = height;
  if (imageAspect > targetAspect) {
    cropWidth = height * targetAspect;
  } else {
    cropHeight = width / targetAspect;
  }

  cropWidth /= safeZoom;
  cropHeight /= safeZoom;

  const maxSourceX = Math.max(0, width - cropWidth);
  const maxSourceY = Math.max(0, height - cropHeight);

  return {
    sourceX: maxSourceX * clamp(crop.focusX, 0, 1),
    sourceY: maxSourceY * clamp(crop.focusY, 0, 1),
    sourceWidth: cropWidth,
    sourceHeight: cropHeight,
  };
}

function estimateDataUrlByteSize(dataUrl: string) {
  const encoded = dataUrl.split(',', 2)[1] ?? '';
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('读取图片失败，请换一张图片重试。'));
    image.src = src;
  });
}
