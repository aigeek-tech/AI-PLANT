const STANDARD_ICON_STORAGE_KEY = 'smart-design-standard-icons';

export type StandardIconMap = Record<string, string>;

export function loadStandardIcons(): StandardIconMap {
  try {
    const raw = window.localStorage.getItem(STANDARD_ICON_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed as StandardIconMap : {};
  } catch {
    return {};
  }
}

export function saveStandardIcons(icons: StandardIconMap) {
  window.localStorage.setItem(STANDARD_ICON_STORAGE_KEY, JSON.stringify(icons));
}

export async function createStandardIconPreview(file: File, size = 192) {
  if (file.type === 'image/svg+xml') {
    return fileToDataUrl(file);
  }

  const bitmap = await createImageBitmap(file);
  const cropSize = Math.min(bitmap.width, bitmap.height);
  const sourceX = (bitmap.width - cropSize) / 2;
  const sourceY = (bitmap.height - cropSize) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器不支持图标裁剪。');
  }

  context.drawImage(bitmap, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);

  return canvas.toDataURL('image/webp', 0.82);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败。'));
    reader.readAsDataURL(file);
  });
}
