import { formatInr, formatInrRounded } from "@/lib/money";
import { cn } from "@/lib/utils";

export function Money({ paise, rounded = false, className }: { paise: number; rounded?: boolean; className?: string }) {
  return <span className={cn("tabular whitespace-nowrap", className)}>{rounded ? formatInrRounded(paise) : formatInr(paise)}</span>;
}
