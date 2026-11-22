"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PickerVendor = { id: string; name: string; gstin?: string | null; creditDays: number };

/** Bottom-sheet vendor picker with search and "Create vendor". */
export function VendorPicker({
  vendors,
  value,
  onChange,
  onCreate,
  invalid,
  id,
}: {
  vendors: PickerVendor[];
  value: string | null;
  onChange: (id: string) => void;
  onCreate?: (name: string) => void;
  invalid?: boolean;
  id?: string;
}) {
  const t = useTranslations("bills.form");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = vendors.find((v) => v.id === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? vendors.filter((v) => v.name.toLowerCase().includes(s) || (v.gstin ?? "").toLowerCase().includes(s)) : vendors;
  }, [q, vendors]);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          id={id}
          type="button"
          aria-invalid={invalid}
          className={cn("flex h-12 w-full items-center justify-between rounded-lg border bg-background px-3 text-left", invalid && "border-danger")}
          data-testid="vendor-picker"
        >
          <span className={cn("truncate", !selected && "text-text-secondary")}>{selected?.name ?? t("chooseVendor")}</span>
          <ChevronsUpDown className="size-4 text-text-secondary" aria-hidden />
        </button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader>
          <DrawerTitle>{t("chooseVendor")}</DrawerTitle>
        </DrawerHeader>
        <div className="px-4">
          <Input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchVendor")} aria-label={t("searchVendor")} className="h-12" />
        </div>
        <ul className="pb-safe mt-2 overflow-y-auto px-2 pb-4">
          {shown.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-surface-hover"
                onClick={() => {
                  onChange(v.id);
                  setOpen(false);
                }}
              >
                <span className="flex-1 truncate">{v.name}</span>
                {v.id === value ? <Check className="size-4" aria-hidden /> : null}
              </button>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-3 py-4 text-sm text-text-secondary">{t("noVendors")}</li> : null}
          {onCreate && q.trim() ? (
            <li>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-medium hover:bg-surface-hover"
                onClick={() => {
                  onCreate(q.trim());
                  setOpen(false);
                }}
              >
                <Plus className="size-4" aria-hidden /> {t("createVendor", { name: q.trim() })}
              </button>
            </li>
          ) : null}
        </ul>
      </DrawerContent>
    </Drawer>
  );
}
