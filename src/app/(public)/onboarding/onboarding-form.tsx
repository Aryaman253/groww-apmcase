"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspace } from "@/app/(app)/more/settings/actions";

export function OnboardingForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createWorkspace, { ok: true } as { ok: boolean; error?: string });
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t("onboarding.businessName")}</Label>
        <Input id="name" name="name" required maxLength={120} placeholder={t("onboarding.businessNamePlaceholder")} className="h-12" />
        {!state.ok ? <p className="text-sm text-danger">{t("common.somethingWrong")}</p> : null}
      </div>
      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
        {pending ? t("onboarding.creating") : t("onboarding.create")}
      </Button>
    </form>
  );
}
