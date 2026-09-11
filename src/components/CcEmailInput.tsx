import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

const ALLOWED_CC_DOMAIN = "amsonsgroup.net";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  value: string[];
  onChange: (emails: string[]) => void;
  disabled?: boolean;
}

export function CcEmailInput({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tryAdd = () => {
    const email = draft.trim();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setError(t("createTicket.ccInvalidEmail"));
      return;
    }
    if (!email.toLowerCase().endsWith(`@${ALLOWED_CC_DOMAIN}`)) {
      setError(t("createTicket.ccDomainNotAllowed"));
      return;
    }
    const normalized = email.toLowerCase();
    if (!value.some((v) => v.toLowerCase() === normalized)) {
      onChange([...value, email]);
    }
    setDraft("");
    setError(null);
  };

  const remove = (email: string) => {
    onChange(value.filter((v) => v !== email));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 min-h-10 focus-within:ring-1 focus-within:ring-ring">
        {value.map((email) => (
          <Badge key={email} variant="secondary" className="gap-1 font-normal">
            {email}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(email)}
                className="ml-1 rounded-full hover:bg-muted-foreground/20"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
        <input
          type="email"
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              tryAdd();
            } else if (e.key === "Backspace" && !draft && value.length) {
              remove(value[value.length - 1]);
            }
          }}
          onBlur={() => {
            if (draft.trim()) tryAdd();
          }}
          placeholder={value.length ? "" : t("createTicket.ccPlaceholder")}
          className="flex-1 min-w-[180px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
