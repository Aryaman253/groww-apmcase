import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BarChart3, History, Landmark, Settings, HelpCircle, UserPlus, ChevronRight } from "lucide-react";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "More" };

export default async function MorePage() {
  const ctx = await getAppContext();
  const t = await getTranslations("more");
  const tc = await getTranslations("common");
  const items = [
    { href: "/more/reports", icon: BarChart3, label: t("reports") },
    { href: "/more/activity", icon: History, label: t("activity") },
    { href: "/more/bank-accounts", icon: Landmark, label: t("bankAccounts") },
    { href: "/more/settings", icon: Settings, label: t("settings") },
    { href: "/more/help", icon: HelpCircle, label: t("help") },
  ];
  return (
    <>
      <PageHeader title={t("title")} description={ctx.user.isAnonymous ? t("guest") : t("signedInAs", { email: ctx.user.email ?? "" })} />
      <ul className="flex flex-col overflow-hidden rounded-2xl border bg-card">
        {items.map(({ href, icon: Icon, label }) => (
          <li key={href} className="border-b last:border-b-0">
            <Link href={href} className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-hover">
              <Icon className="size-5 text-text-secondary" aria-hidden />
              <span className="flex-1">{label}</span>
              <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
            </Link>
          </li>
        ))}
        <li>
          <div className="flex min-h-14 items-center gap-3 px-4 text-text-tertiary" aria-disabled="true" data-testid="invite-staff">
            <UserPlus className="size-5" aria-hidden />
            <span className="flex-1">{t("inviteStaff")}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-text-secondary">{tc("comingSoon")}</span>
          </div>
        </li>
      </ul>
      {ctx.user.isAnonymous ? (
        <Button asChild variant="outline" className="mt-6 h-12 w-full">
          <Link href="/login">{t("saveDemo")}</Link>
        </Button>
      ) : null}
    </>
  );
}
