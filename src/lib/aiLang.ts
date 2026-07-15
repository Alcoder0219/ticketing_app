// Language helpers for the AI Assistant (English / Swahili / Arabic).
// UI chrome stays English; these drive the language selector, RTL rendering,
// voice-input locale, and a lightweight client-side script hint.

export type LangCode = "en" | "sw" | "ar";

export interface LangOption {
  code: LangCode;
  label: string;
  native: string;
  flag: string;
  /** BCP-47 locale for the Web Speech API. */
  voice: string;
}

export const LANGUAGES: LangOption[] = [
  { code: "en", label: "English", native: "English", flag: "🇺🇸", voice: "en-US" },
  { code: "sw", label: "Swahili", native: "Kiswahili", flag: "🇹🇿", voice: "sw-TZ" },
  { code: "ar", label: "Arabic", native: "العربية", flag: "🇸🇦", voice: "ar-SA" },
];

export const DEFAULT_LANG: LangCode = "en";
const STORAGE_KEY = "ai_assistant_lang";

export function isRtl(lang?: string | null): boolean {
  return lang === "ar";
}

export function langOption(code?: string | null): LangOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export function voiceLocale(code?: string | null): string {
  return langOption(code).voice;
}

export function loadLang(): LangCode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && LANGUAGES.some((l) => l.code === v)) return v as LangCode;
  } catch {
    /* ignore storage errors */
  }
  return DEFAULT_LANG;
}

export function saveLang(code: LangCode) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Cheap client-side hint used only to render a user's own message RTL/LTR
 * instantly (before the server confirms the language). Arabic script is the only
 * one detectable reliably from characters; Swahili vs English is left to the
 * backend AI detector.
 */
export function scriptHint(text: string): LangCode | null {
  // Arabic (U+0600–U+06FF) + Arabic Supplement (U+0750–U+077F).
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "ar";
  return null;
}

/** Localized greeting shown at the top of a fresh conversation. */
export function welcomeText(firstName: string, lang: LangCode): string {
  switch (lang) {
    case "sw":
      return `👋 Habari ${firstName}! Mimi ni Msaidizi wa Tiketi. Ninaweza kukusaidia kufungua tiketi, kufuatilia hali ya tiketi, na kujibu maswali kuhusu mfumo. Naweza kukusaidiaje leo?`;
    case "ar":
      return `👋 مرحبًا ${firstName}! أنا مساعد التذاكر. يمكنني مساعدتك في إنشاء التذاكر ومتابعة حالتها والإجابة عن أسئلتك حول النظام. كيف يمكنني مساعدتك اليوم؟`;
    default:
      return `👋 Hello ${firstName}! I'm Ticketing Assistant, your AI helper for the support portal. I can help you with:

- Finding and checking ticket status
- Understanding SLA policies
- Generating ticket summaries and reports
- Answering questions about the ticketing system
- Helping you raise tickets faster

What can I help you with today?`;
  }
}
