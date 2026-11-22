import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { TryDemoButton } from "./try-demo-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

export default async function LandingPage() {
  const t = await getTranslations("landing");
  return (
    <>
      <header className="flex items-center justify-between py-4">
        <Wordmark />
        <div className="flex items-center gap-1">
          <LanguageSwitcher compact />
          <ThemeToggle />
        </div>
      </header>
      <section className="flex flex-1 flex-col justify-center gap-6 py-10">
        <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance">{t("title")}</h1>
        <p className="text-lg text-text-secondary">{t("subtitle")}</p>
      </section>
      <div className="flex flex-col gap-3">
        <TryDemoButton />
        <Button asChild variant="outline" size="lg" className="h-12 text-base">
          <Link href="/login">{t("signIn")}</Link>
        </Button>
        <p className="pt-2 text-center text-sm text-text-secondary">{t("trust")}</p>
      </div>
    </>
  );
}
