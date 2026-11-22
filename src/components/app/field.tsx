"use client";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Form field wrapper: label, hint, error (i18n key under "validation"), low-confidence highlight. */
export function Field({
  id,
  label,
  hint,
  error,
  warn,
  optional,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  warn?: string;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations();
  const errText = error ? (t.has(`validation.${error}`) ? t(`validation.${error}`) : error) : undefined;
  return (
    <div className={cn("space-y-1.5", className)} data-warn={warn ? "true" : undefined}>
      <Label htmlFor={id} className="flex items-baseline gap-2">
        {label}
        {optional ? <span className="text-xs font-normal text-text-secondary">{t("common.optional")}</span> : null}
      </Label>
      {children}
      {errText ? (
        <p id={`${id}-error`} className="text-sm text-danger" role="alert">
          {errText}
        </p>
      ) : warn ? (
        <p id={`${id}-warn`} className="text-sm text-warning">
          {warn}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function highlightClass(warn?: boolean, error?: boolean) {
  return cn("h-12", error ? "border-danger" : warn ? "border-warning bg-warning-bg/40 ring-1 ring-warning/40" : "");
}
