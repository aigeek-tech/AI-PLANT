export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
};

export const UI_DISPLAY_SETTINGS_STORAGE_KEY = 'smart-design.ui-display-settings';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function normalizeLocale(value: unknown): SupportedLocale {
  if (isSupportedLocale(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized.startsWith('en')) {
      return 'en-US';
    }
    if (normalized.startsWith('zh')) {
      return 'zh-CN';
    }
  }
  return DEFAULT_LOCALE;
}

export function readStoredLocale(): SupportedLocale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const rawValue = window.localStorage.getItem(UI_DISPLAY_SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return DEFAULT_LOCALE;
  }

  try {
    const parsed = JSON.parse(rawValue) as { locale?: unknown };
    return normalizeLocale(parsed.locale);
  } catch {
    return DEFAULT_LOCALE;
  }
}
