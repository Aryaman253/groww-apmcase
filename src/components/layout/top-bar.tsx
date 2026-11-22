import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { ThemeToggle } from "./theme-toggle";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { TestModeBadge } from "@/components/app/status-badge";

type Ws = { id: string; name: string; is_demo: boolean };

export async function TopBar({ current, workspaces, testMode }: { current: Ws; workspaces: Ws[]; testMode: boolean }) {
  const t = await getTranslations();
  return (
    <header className="no-print pt-safe sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-3">
        <Link href="/home" className="flex size-11 items-center justify-center rounded-lg lg:hidden" aria-label="TArrow">
          <LogoMark className="size-7" />
        </Link>
        <WorkspaceSwitcher current={current} workspaces={workspaces} />
        {testMode ? <TestModeBadge label={t("common.testMode")} /> : null}
        <div className="flex-1" />
        <Link
          href="/search"
          className="flex size-11 items-center justify-center rounded-lg hover:bg-surface-hover"
          aria-label={t("nav.openSearch")}
          data-testid="open-search"
        >
          <Search className="size-5" aria-hidden />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
