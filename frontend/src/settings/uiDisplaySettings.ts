import { createContext, useContext } from 'react';
import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n/locales';

export interface UiDisplaySettings {
  showStandardClassCodes: boolean;
  locale: SupportedLocale;
}

export const DEFAULT_UI_DISPLAY_SETTINGS: UiDisplaySettings = {
  showStandardClassCodes: false,
  locale: DEFAULT_LOCALE,
};

export interface UiDisplaySettingsContextValue {
  settings: UiDisplaySettings;
  updateSettings: (patch: Partial<UiDisplaySettings>) => void;
  resetSettings: () => void;
}

export const UiDisplaySettingsContext = createContext<UiDisplaySettingsContextValue | null>(null);

export function useUiDisplaySettings() {
  const context = useContext(UiDisplaySettingsContext);
  if (!context) {
    throw new Error('useUiDisplaySettings must be used within UiDisplaySettingsProvider');
  }
  return context;
}
