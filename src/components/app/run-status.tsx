"use client";
import { useTranslations } from "next-intl";
import { StatusBadge, type Tone } from "./status-badge";

const tones: Record<string, Tone> = {
  draft: "neutral",
  confirmed: "info",
  in_progress: "info",
  completed: "success",
  partly_failed: "warning",
  cancelled: "neutral",
};

export function RunStatusBadge({ status }: { status: string }) {
  const t = useTranslations("runStatus");
  return <StatusBadge tone={tones[status] ?? "neutral"}>{t.has(status) ? t(status) : status}</StatusBadge>;
}
