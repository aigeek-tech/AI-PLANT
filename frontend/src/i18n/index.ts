import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, readStoredLocale, SUPPORTED_LOCALES, type SupportedLocale } from './locales';
import { resources } from './resources';

void i18n.use(initReactI18next).init({
  resources,
  lng: readStoredLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export function setDocumentLocale(locale: SupportedLocale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

setDocumentLocale(readStoredLocale());

export default i18n;
