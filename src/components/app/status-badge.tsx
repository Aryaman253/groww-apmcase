import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

const toneClass: Record<Tone, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  neutral: "bg-secondary text-text-secondary",
  brand: "border border-brand/40 text-brand",
};

export function StatusBadge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function TestModeBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full border border-brand/50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-brand uppercase"
      data-testid="test-mode-badge"
    >
      {label}
    </span>
  );
}
