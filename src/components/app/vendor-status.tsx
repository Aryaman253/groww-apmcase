"use client";
import { useTranslations } from "next-intl";
import { StatusBadge, type Tone } from "./status-badge";

const tones: Record<string, Tone> = { verified: "success", new: "info", changed: "warning", missing: "danger" };

export function VendorStatusBadge({ status }: { status: "verified" | "new" | "changed" | "missing" }) {
  const t = useTranslations("vendors.status");
  return <StatusBadge tone={tones[status]}>{t(status)}</StatusBadge>;
}
