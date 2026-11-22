"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.email().safeParse(email.trim());
    if (!parsed.success) {
      setError(t("invalidEmail"));
      return;
    }
    setError(null);
    setState("sending");
    const supabase = createClient();
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
    const { error: err } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}` },
    });
    if (err) {
      setError(err.status === 429 ? t("rateLimited") : err.message);
      setState("idle");
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="rounded-xl border bg-card p-5" role="status">
        <h2 className="font-semibold">{t("checkEmail")}</h2>
        <p className="mt-1 text-text-secondary">{t("checkEmailBody", { email })}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "email-error" : undefined}
          className="h-12"
          required
        />
        {error ? (
          <p id="email-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" className="h-12 text-base" disabled={state === "sending"}>
        {state === "sending" ? t("sending") : t("sendLink")}
      </Button>
    </form>
  );
}
