"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StickyBar } from "@/components/app/sticky-bar";
import { Money } from "@/components/app/money";
import { readSpreadsheet, guessMapping, mapRows, missingRequiredMappings, MAPPING_FIELDS, type ColumnMapping, type ImportPreviewRow } from "@/lib/import";
import type { PickerVendor } from "@/components/bills/vendor-picker";
import { formatDate } from "@/lib/dates";
import { importBills } from "../actions";
import { cn } from "@/lib/utils";

type Sheet = Awaited<ReturnType<typeof readSpreadsheet>>["sheets"][number];
type ExistingBill = { id: string; vendorId: string; invoiceNumber: string; invoiceDate: string | null; amountPaise: number };
type Choice = { include: boolean; vendorId: string | null };

export function ImportWizard({ vendors, existingBills, presets }: { vendors: PickerVendor[]; existingBills: ExistingBill[]; presets: { name: string; mapping: Record<string, string> }[] }) {
  const t = useTranslations("bills.import");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [presetName, setPresetName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [pending, start] = useTransition();
  const sheet = sheets[sheetIdx];

  async function load(buf: ArrayBuffer, name: string) {
    setError(null);
    try {
      const res = await readSpreadsheet(buf, name);
      const usable = res.sheets.filter((s) => s.rows.length > 0);
      if (!usable.length) return setError(t("noRows"));
      setSheets(usable);
      setSheetIdx(0);
      const preset = presets.find((p) => usable[0].headers.includes(Object.values(p.mapping)[0] ?? "\u0000"));
      setMapping(preset ? (preset.mapping as ColumnMapping) : guessMapping(usable[0].headers));
      setStep(2);
    } catch {
      setError(t("readError"));
    }
  }

  const preview: ImportPreviewRow<PickerVendor>[] = useMemo(() => {
    if (!sheet || step !== 3) return [];
    return mapRows(sheet.rows, mapping, { vendors, existingBills, defaultCreditDays: 30 }).filter((r) => !r.skipped);
  }, [sheet, mapping, vendors, existingBills, step]);

  const choiceFor = (r: ImportPreviewRow<PickerVendor>): Choice =>
    choices[r.index] ?? { include: r.errors.length === 0, vendorId: r.vendorMatch.match?.id ?? null };
  const ready = preview.filter((r) => r.errors.length === 0 && choiceFor(r).include);
  const errorsCount = preview.filter((r) => r.errors.length > 0).length;
  const dupes = preview.filter((r) => r.duplicateOf).length;
  const missing = missingRequiredMappings(mapping);

  function doImport() {
    const rows = ready.map((r) => {
      const c = choiceFor(r);
      return {
        vendorId: c.vendorId,
        newVendorName: c.vendorId ? null : r.vendorName,
        gstin: r.gstin,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate,
        dueDate: r.dueDate,
        amountPaise: r.amountPaise!,
      };
    });
    start(async () => {
      const res = await importBills({ rows, preset: presetName.trim() ? { name: presetName.trim(), mapping: mapping as Record<string, string | undefined> } : undefined });
      if (!res.ok) {
        toast.error(tc("somethingWrong"));
        return;
      }
      toast.success(t("imported", { count: res.data?.count ?? rows.length }));
      router.push("/bills");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="import-wizard">
      <p className="text-sm text-text-secondary">{t("step", { current: step, total: 3 })}</p>

      {step === 1 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t("uploadTitle")}</h2>
          <p className="text-text-secondary">{t("uploadBody")}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            data-testid="import-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await load(await f.arrayBuffer(), f.name);
            }}
          />
          <Button size="lg" className="h-12" onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet className="size-5" aria-hidden /> {t("chooseFile")}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-12"
            onClick={async () => {
              const res = await fetch("/samples/sample-bills-export.xlsx");
              await load(await res.arrayBuffer(), "sample-bills-export.xlsx");
            }}
          >
            {t("trySample")}
          </Button>
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        </section>
      ) : null}

      {step === 2 && sheet ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t("mapTitle")}</h2>
          <p className="text-text-secondary">{t("mapBody")}</p>
          {sheets.length > 1 ? (
            <label className="space-y-1.5">
              <Label>{t("sheet")}</Label>
              <select className="h-12 w-full rounded-lg border bg-background px-3" value={sheetIdx} onChange={(e) => { const i = +e.target.value; setSheetIdx(i); setMapping(guessMapping(sheets[i].headers)); }}>
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>{s.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {presets.length ? (
            <label className="space-y-1.5">
              <Label>{t("preset")}</Label>
              <select className="h-12 w-full rounded-lg border bg-background px-3" defaultValue="" onChange={(e) => { const p = presets.find((x) => x.name === e.target.value); if (p) setMapping(p.mapping as ColumnMapping); }}>
                <option value="">{t("presetNone")}</option>
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {MAPPING_FIELDS.map((f) => (
            <label key={f} className="space-y-1.5">
              <Label>{t(`fields.${f}`)}</Label>
              <select
                className={cn("h-12 w-full rounded-lg border bg-background px-3", missing.includes(f) && "border-warning")}
                value={mapping[f] ?? ""}
                data-testid={`map-${f}`}
                onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))}
              >
                <option value="">{t("notMapped")}</option>
                {sheet.headers.filter(Boolean).map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="space-y-1.5">
            <Label htmlFor="preset-name">{t("savePreset")}</Label>
            <Input id="preset-name" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder={t("presetPlaceholder")} className="h-12" maxLength={80} />
          </label>
          {missing.length ? <p className="text-sm text-warning">{t("missingRequired")}</p> : null}
          <StickyBar className="flex gap-2">
            <Button variant="outline" size="lg" className="h-12" onClick={() => setStep(1)}>{tc("back")}</Button>
            <Button size="lg" className="h-12 flex-1" disabled={missing.length > 0} onClick={() => { setChoices({}); setStep(3); }} data-testid="import-preview">
              {tc("continue")}
            </Button>
          </StickyBar>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("previewTitle")}</h2>
          <p className="text-sm text-text-secondary">{t("previewSummary", { ok: ready.length, errors: errorsCount, dupes })}</p>
          <ul className="flex flex-col gap-2" data-testid="import-rows">
            {preview.map((r) => {
              const c = choiceFor(r);
              const hasErr = r.errors.length > 0;
              return (
                <li key={r.index} className={cn("rounded-xl border bg-card p-3", hasErr && "border-danger/50", !c.include && !hasErr && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    {hasErr ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate font-medium">{c.vendorId ? vendors.find((v) => v.id === c.vendorId)?.name : r.vendorName || "—"}</p>
                      <p className="truncate text-sm text-text-secondary">
                        {r.invoiceNumber || "—"} · {formatDate(r.dueDate, locale)}
                      </p>
                      {r.errors.map((e) => (
                        <p key={e} className="text-sm text-danger">{t(`rowErrors.${e}`)}</p>
                      ))}
                      {r.warnings
                        .filter((w) => w !== "DUE_DATE_COMPUTED")
                        .map((w) => (
                          <p key={w} className="text-sm text-warning">
                            {w === "NEW_VENDOR" && !c.vendorId ? t("newVendor") : t(`rowWarnings.${w}`)}
                          </p>
                        ))}
                      {!r.vendorMatch.match && r.vendorMatch.suggestions.length && !hasErr ? (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <span className="text-xs text-text-secondary">{t("chooseMatch")}</span>
                          {r.vendorMatch.suggestions.map((s) => (
                            <button
                              key={s.vendor.id}
                              type="button"
                              onClick={() => setChoices((x) => ({ ...x, [r.index]: { ...c, vendorId: c.vendorId === s.vendor.id ? null : s.vendor.id } }))}
                              className={cn("min-h-9 rounded-md border px-2 text-xs", c.vendorId === s.vendor.id ? "border-foreground bg-foreground text-background" : "bg-background")}
                            >
                              {s.vendor.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {r.amountPaise ? <Money paise={r.amountPaise} className="text-sm font-medium" /> : null}
                      {!hasErr ? (
                        <button type="button" className="min-h-9 text-xs text-text-secondary underline" onClick={() => setChoices((x) => ({ ...x, [r.index]: { ...c, include: !c.include } }))}>
                          {c.include ? t("skipRow") : t("includeRow")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <StickyBar className="flex gap-2">
            <Button variant="outline" size="lg" className="h-12" onClick={() => setStep(2)}>{tc("back")}</Button>
            <Button size="lg" className="h-12 flex-1" disabled={pending || ready.length === 0} onClick={doImport} data-testid="import-submit">
              {pending ? t("importing") : t("importN", { count: ready.length })}
            </Button>
          </StickyBar>
        </section>
      ) : null}
    </div>
  );
}
