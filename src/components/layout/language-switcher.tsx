"use client";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { comingSoonLocales } from "@/i18n/config";
import { setLocale } from "@/app/actions/locale";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  function change(v: string) {
    start(async () => {
      await setLocale(v);
      router.refresh();
    });
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "default"}
          className={compact ? "size-11" : "h-11"}
          aria-label={t("nav.language")}
          disabled={pending}
          data-testid="language-switcher"
        >
          <Languages className="size-5" />
          {compact ? null : <span>{locale === "hi" ? "हिन्दी" : "English"}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuRadioGroup value={locale} onValueChange={change}>
          <DropdownMenuRadioItem value="en" className="min-h-11" data-testid="lang-en">
            English
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="hi" className="min-h-11" lang="hi" data-testid="lang-hi">
            हिन्दी
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-text-secondary">{t("common.comingSoon")}</DropdownMenuLabel>
        {comingSoonLocales.map((l) => (
          <DropdownMenuItem key={l} disabled className="min-h-11">
            {l}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
