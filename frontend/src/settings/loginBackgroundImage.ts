export const LOGIN_BACKGROUND_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const LOGIN_BACKGROUND_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const LOGIN_BACKGROUND_MAX_OUTPUT_BYTES = 450 * 1024;
export const LOGIN_BACKGROUND_ASPECT_RATIO = 16 / 9;

interface CompressionStep {
  width: number;
  height: number;
  quality: number;
}

export interface LoginBackgroundImageResult {
  blob: Blob;
  mimeType: 'image/webp';
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  byteSize: number;
}

const OUTPUT_STEPS: CompressionStep[] = [
  { width: 1600, height: 900, quality: 0.82 },
  { width: 1440, height: 810, quality: 0.78 },
  { width: 1280, height: 720, quality: 0.74 },
  { width: 960, height: 540, quality: 0.72 },
];

export function validateLoginBackgroundFile(file: File) {
  if (!LOGIN_BACKGROUND_ALLOWED_TYPES.includes(file.type as (typeof LOGIN_BACKGROUND_ALLOWED_TYPES)[number])) {
    throw new Error('登录背景图仅支持 JPG、PNG 或 WebP 图片。');
  }

  if (file.size > LOGIN_BACKGROUND_MAX_FILE_BYTES) {
    throw new Error('登录背景图源文件不能超过 10 MB。');
  }
}

export async function createLoginBackgroundImage(file: File): Promise<LoginBackgroundImageResult> {
  validateLoginBackgroundFile(file);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');

    for (const step of OUTPUT_STEPS) {
      renderCoverImage(canvas, image, step.width, step.height);
      const blob = await createCanvasBlob(canvas, 'image/webp', step.quality);
      const byteSize = blob.size;
      if (byteSize <= LOGIN_BACKGROUND_MAX_OUTPUT_BYTES) {
        return {
          blob,
          mimeType: 'image/webp',
          sourceWidth: image.naturalWidth,
          sourceHeight: image.naturalHeight,
          outputWidth: step.width,
          outputHeight: step.height,
          byteSize,
        };
      }
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  throw new Error('登录背景图压缩后仍超过 450 KB，请换一张更简洁的图片。');
}

function renderCoverImage(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  outputWidth: number,
  outputHeight: number,
) {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器不支持图片压缩。');
  }

  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceAspect > LOGIN_BACKGROUND_ASPECT_RATIO) {
    cropWidth = sourceHeight * LOGIN_BACKGROUND_ASPECT_RATIO;
  } else {
    cropHeight = sourceWidth / LOGIN_BACKGROUND_ASPECT_RATIO;
  }

  const sourceX = Math.max(0, (sourceWidth - cropWidth) / 2);
  const sourceY = Math.max(0, (sourceHeight - cropHeight) / 2);

  canvas.width = outputWidth;
  canvas.height = outputHeight;
  context.clearRect(0, 0, outputWidth, outputHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  );
}

function createCanvasBlob(canvas: HTMLCanvasElement, mimeType: 'image/webp', quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('浏览器不支持 WebP 图片压缩。'));
    }, mimeType, quality);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('读取登录背景图失败，请换一张图片重试。'));
    image.src = src;
  });
}
