import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en/translation.json";
import sw from "./locales/sw/translation.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "sw", label: "Swahili", short: "SW" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: LanguageCode = "en";
export const LANGUAGE_STORAGE_KEY = "support_portal_language";

/**
 * Restore the saved UI language. Deliberately does NOT sniff `navigator.language`:
 * the portal must always open in English until the user picks otherwise.
 */
export function loadLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
      return saved as LanguageCode;
    }
  } catch {
    /* private mode / storage disabled — fall through to the default */
  }
  return DEFAULT_LANGUAGE;
}

export function saveLanguage(code: LanguageCode) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    /* ignore storage errors; the in-memory choice still applies */
  }
}

/** Keep <html lang> in sync so screen readers announce the right language. */
function syncDocumentLang(code: string) {
  if (typeof document !== "undefined") document.documentElement.lang = code;
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    sw: { translation: sw },
  },
  lng: loadLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

syncDocumentLang(i18n.language);
i18n.on("languageChanged", (lng) => syncDocumentLang(lng));

/**
 * Switch the UI language. Only touches i18next + localStorage — no page reload,
 * no auth/session/permission state is read or cleared.
 */
export function setLanguage(code: LanguageCode) {
  saveLanguage(code);
  void i18n.changeLanguage(code);
}

export default i18n;
