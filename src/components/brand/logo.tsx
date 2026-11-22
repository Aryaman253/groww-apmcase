import { cn } from "@/lib/utils";

/**
 * TArrow mark: a bold geometric "T" whose crossbar runs right into an arrow head —
 * the letter itself shows money moving out. 32×32 grid, flat, rounded joins.
 */
export const MARK_PATH = "M4 7.5H19.5V3.5L28.5 10L19.5 16.5V12.5H15.5V27.5H9.5V12.5H4Z";

export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-6", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={MARK_PATH} fill="var(--brand)" stroke="var(--brand)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground", className)}>
      <LogoMark className="size-7" />
      <span>TArrow</span>
    </span>
  );
}
