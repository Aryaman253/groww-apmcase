"use client";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchWorkspace } from "@/app/(app)/more/settings/actions";
import { Badge } from "@/components/ui/badge";

type Ws = { id: string; name: string; is_demo: boolean };

export function WorkspaceSwitcher({ current, workspaces }: { current: Ws; workspaces: Ws[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-11 max-w-[11rem] items-center gap-1 rounded-lg px-2 text-left text-sm font-medium hover:bg-surface-hover"
        aria-label={t("nav.switchWorkspace")}
        disabled={pending}
      >
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-text-secondary" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel className="text-xs text-text-secondary">{t("nav.switchWorkspace")}</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            className="min-h-11"
            onSelect={() =>
              start(async () => {
                await switchWorkspace(w.id);
                router.refresh();
              })
            }
          >
            <span className="flex-1 truncate">{w.name}</span>
            {w.is_demo ? <Badge variant="secondary">{t("common.demo")}</Badge> : null}
            {w.id === current.id ? <Check className="size-4" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/onboarding">
            <Plus className="size-4" aria-hidden /> {t("nav.newWorkspace")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
