"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Press-and-hold button for money steps (deliberate action). Keyboard: hold Enter/Space.
 * Respects reduced motion (still requires the hold, just no animated fill).
 */
export function HoldToConfirm({
  label,
  holdingLabel,
  onConfirm,
  disabled,
  durationMs = 1200,
  testId,
}: {
  label: string;
  holdingLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  durationMs?: number;
  testId?: string;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const startAt = useRef<number | null>(null);
  const fired = useRef(false);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    startAt.current = null;
    if (!fired.current) setProgress(0);
  };
  const tick = (now: number) => {
    if (startAt.current === null) startAt.current = now;
    const p = Math.min(1, (now - startAt.current) / durationMs);
    setProgress(p);
    if (p >= 1) {
      fired.current = true;
      stop();
      onConfirm();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (disabled || fired.current || raf.current) return;
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  useEffect(() => {
    if (!disabled) fired.current = false;
  }, [disabled]);

  return (
    <button
      type="button"
      disabled={disabled}
      data-testid={testId}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") stop();
      }}
      aria-describedby={testId ? `${testId}-desc` : undefined}
      className={cn(
        "relative h-14 w-full touch-none overflow-hidden rounded-xl bg-primary text-base font-semibold text-primary-foreground select-none disabled:opacity-50",
      )}
    >
      <span className="absolute inset-y-0 left-0 bg-brand/80 motion-reduce:transition-none" style={{ width: `${progress * 100}%` }} aria-hidden />
      <span className="relative">{progress > 0 && progress < 1 ? holdingLabel : label}</span>
    </button>
  );
}
