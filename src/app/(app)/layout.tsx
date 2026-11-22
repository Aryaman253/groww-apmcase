import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { TopBar } from "@/components/layout/top-bar";
import { BottomNav, SideNav } from "@/components/layout/bottom-nav";
import { Wordmark } from "@/components/brand/logo";
import { DemoBanner } from "@/components/layout/demo-banner";
import { isDirectPayEnabled } from "@/lib/rails/config";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();
  const t = await getTranslations();
  const { data: provider } = await ctx.supabase
    .from("payout_providers")
    .select("id")
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  const testMode = isDirectPayEnabled() && (Boolean(provider) || ctx.workspace.is_demo);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="no-print sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-bg-secondary px-3 py-5 lg:flex">
        <div className="px-3">
          <Wordmark />
        </div>
        <SideNav />
      </aside>
      <div className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-background focus:px-3 focus:py-2">
          {t("common.skipToContent")}
        </a>
        <TopBar current={ctx.workspace} workspaces={ctx.workspaces} testMode={testMode} />
        {ctx.workspace.is_demo ? <DemoBanner /> : null}
        <main id="main" className="mx-auto w-full max-w-lg flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:max-w-5xl lg:px-8 lg:pb-10">
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
