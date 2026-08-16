import { Globe, Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES, setLanguage, type LanguageCode } from "@/i18n";
import { supabase } from "@/integrations/api/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * English / Swahili UI language switcher, sitting next to the theme toggle.
 *
 * Built on the same Radix dropdown as ThemeToggle, so keyboard navigation,
 * focus rings, click-outside and Escape-to-close come from the shared
 * primitive rather than bespoke handlers. Switching language only calls
 * i18next — no reload, and no auth/permission state is touched.
 */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const current =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  /**
   * Switch the UI immediately, then persist to the profile so server-sent
   * emails use the same language. The profile write is best-effort: it never
   * blocks the UI, and localStorage remains the source of truth for the client.
   */
  const choose = (code: LanguageCode) => {
    setLanguage(code);
    if (user?.id) {
      void supabase
        .from("profiles")
        .update({ preferred_language: code } as any)
        .eq("user_id", user.id);
    }
  };

  // "English"/"Swahili" rendered in the *active* language, so the menu reads
  // naturally whichever language is on.
  const labelFor = (code: LanguageCode) =>
    code === "en" ? t("header.english") : t("header.swahili");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1 rounded-full px-2.5 hover:bg-muted transition-colors"
          aria-label={t("header.currentLanguage", { language: labelFor(current.code) })}
        >
          <Globe className="h-[18px] w-[18px] shrink-0" />
          <span className="text-xs font-semibold tracking-wide">{current.short}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
          {t("header.language")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LANGUAGES.map(({ code }) => (
          <DropdownMenuItem
            key={code}
            onSelect={() => choose(code)}
            className="cursor-pointer"
          >
            <span>{labelFor(code)}</span>
            {i18n.language === code && <Check className="ml-auto h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
