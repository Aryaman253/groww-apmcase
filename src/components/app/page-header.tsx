import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 pb-4">
      {backHref ? (
        <Link href={backHref} className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {action}
      </div>
      {description ? <p className="text-text-secondary">{description}</p> : null}
    </div>
  );
}
