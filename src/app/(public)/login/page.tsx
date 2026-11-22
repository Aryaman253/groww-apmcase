import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const t = await getTranslations("auth");
  const sp = await searchParams;
  return (
    <>
      <header className="py-4">
        <Link href="/" aria-label="TArrow">
          <Wordmark />
        </Link>
      </header>
      <section className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t("signInTitle")}</h1>
          <p className="text-text-secondary">{t("signInHelp")}</p>
        </div>
        {sp.error ? (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            {t("linkError")}
          </p>
        ) : null}
        <LoginForm next={sp.next} />
      </section>
    </>
  );
}
