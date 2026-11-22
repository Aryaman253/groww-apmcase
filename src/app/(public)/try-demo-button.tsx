"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { startDemo } from "@/app/demo/actions";

export function TryDemoButton() {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      const res = await startDemo();
      if (!res.ok) throw new Error(res.error);
      router.replace("/home?tour=1");
    } catch {
      toast.error(t("common.somethingWrong"));
      setBusy(false);
    }
  }
  return (
    <Button size="lg" className="h-12 text-base" onClick={onClick} disabled={busy}>
      {busy ? t("landing.startingDemo") : t("landing.tryDemo")}
    </Button>
  );
}
