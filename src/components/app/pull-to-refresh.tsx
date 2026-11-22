"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 70;

/** Touch pull-to-refresh for lists: pulls at scroll top trigger router.refresh(). */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const router = useRouter();
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [pending, start] = useTransition();

  return (
    <div
      onTouchStart={(e) => {
        startY.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
      }}
      onTouchMove={(e) => {
        if (startY.current === null) return;
        const d = e.touches[0].clientY - startY.current;
        setPull(d > 0 ? Math.min(d * 0.5, THRESHOLD * 1.3) : 0);
      }}
      onTouchEnd={() => {
        if (pull >= THRESHOLD) start(() => router.refresh());
        startY.current = null;
        setPull(0);
      }}
    >
      <div
        className="flex items-center justify-center overflow-hidden text-xs text-text-secondary transition-[height]"
        style={{ height: pending ? 36 : pull }}
        aria-live="polite"
      >
        {pull > 0 || pending ? (
          <span className="flex items-center gap-2">
            <RefreshCw className={cn("size-4", pending && "animate-spin")} aria-hidden />
            {pending ? t("refreshing") : t("pullToRefresh")}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
