import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand/logo";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const t = await getTranslations("onboarding");
  return (
    <>
      <header className="py-4">
        <Wordmark />
      </header>
      <section className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-text-secondary">{t("body")}</p>
        </div>
        <OnboardingForm />
      </section>
    </>
  );
}
