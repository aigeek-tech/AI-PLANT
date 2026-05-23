import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import i18n, { setDocumentLocale } from '../i18n';
import { UI_DISPLAY_SETTINGS_STORAGE_KEY, normalizeLocale } from '../i18n/locales';
import {
  DEFAULT_UI_DISPLAY_SETTINGS,
  UiDisplaySettingsContext,
  type UiDisplaySettings,
} from './uiDisplaySettings';

function readSettings(): UiDisplaySettings {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_DISPLAY_SETTINGS;
  }

  const rawValue = window.localStorage.getItem(UI_DISPLAY_SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return DEFAULT_UI_DISPLAY_SETTINGS;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<UiDisplaySettings>;

    return {
      showStandardClassCodes: parsed.showStandardClassCodes === true,
      locale: normalizeLocale(parsed.locale),
    };
  } catch {
    return DEFAULT_UI_DISPLAY_SETTINGS;
  }
}

function persistSettings(settings: UiDisplaySettings) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(UI_DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function UiDisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UiDisplaySettings>(() => readSettings());

  useEffect(() => {
    setDocumentLocale(settings.locale);
    if (i18n.language !== settings.locale) {
      void i18n.changeLanguage(settings.locale);
    }
  }, [settings.locale]);

  const updateSettings = useCallback((patch: Partial<UiDisplaySettings>) => {
    setSettings((current) => {
      const nextSettings = { ...current, ...patch };
      persistSettings(nextSettings);
      return nextSettings;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_UI_DISPLAY_SETTINGS);
    persistSettings(DEFAULT_UI_DISPLAY_SETTINGS);
  }, []);

  const value = useMemo(
    () => ({ settings, updateSettings, resetSettings }),
    [resetSettings, settings, updateSettings],
  );

  return (
    <UiDisplaySettingsContext.Provider value={value}>
      {children}
    </UiDisplaySettingsContext.Provider>
  );
}
