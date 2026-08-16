import { useEffect, useState } from "react";
import { Moon, Sun, Monitor, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Light / Dark / System theme switcher. Keyboard-accessible (it's a menu
 * button), reflects the active choice with an aria-label + check mark, and
 * animates the sun/moon swap via the `.dark` class.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid a hydration/first-paint mismatch before next-themes resolves.
  useEffect(() => setMounted(true), []);

  const current = mounted ? theme ?? "system" : "system";

  const options = [
    { value: "light", label: t("header.themeLight"), icon: Sun },
    { value: "dark", label: t("header.themeDark"), icon: Moon },
    { value: "system", label: t("header.themeSystem"), icon: Monitor },
  ] as const;

  const currentLabel = options.find((o) => o.value === current)?.label ?? current;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full hover:bg-muted transition-colors"
          aria-label={t("header.changeTheme", { theme: currentLabel })}
        >
          <Sun className="h-[18px] w-[18px] rotate-0 scale-100 transition-all duration-300 dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t("header.toggleTheme")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {options.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className="cursor-pointer"
          >
            <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>{label}</span>
            {mounted && current === value && <Check className="ml-auto h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
