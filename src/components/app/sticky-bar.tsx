import { cn } from "@/lib/utils";

/** Sticky bottom action bar for forms and the wizard; sits above the tab bar on phones. */
export function StickyBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "no-print sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-6 border-t bg-background/95 px-4 py-3 backdrop-blur lg:bottom-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
