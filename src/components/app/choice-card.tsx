import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

export function ChoiceCard({ href, icon: Icon, title, hint, testId }: { href: string; icon: LucideIcon; title: string; hint: string; testId?: string }) {
  return (
    <Link href={href} data-testid={testId} className="flex min-h-16 items-center gap-4 rounded-xl border bg-card p-4 hover:bg-surface-hover">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-text-secondary">{hint}</span>
      </span>
      <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
    </Link>
  );
}
