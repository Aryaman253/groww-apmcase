"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, Send, ReceiptText, Users, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/home", key: "home", icon: Home },
  { href: "/pay", key: "pay", icon: Send },
  { href: "/bills", key: "bills", icon: ReceiptText },
  { href: "/vendors", key: "vendors", icon: Users },
  { href: "/more", key: "more", icon: Menu },
] as const;

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("mainNav")}
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:hidden"
    >
      <ul className="pb-safe mx-auto grid max-w-lg grid-cols-5">
        {NAV_ITEMS.map(({ href, key, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-foreground" : "text-text-secondary",
                )}
              >
                <Icon className={cn("size-5", active && "text-brand")} aria-hidden />
                <span>{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("mainNav")} className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, key, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              active ? "bg-surface-hover text-foreground" : "text-text-secondary hover:bg-surface-hover/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("size-5", active && "text-brand")} aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
