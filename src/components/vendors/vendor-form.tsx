"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field, highlightClass } from "@/components/app/field";
import { StickyBar } from "@/components/app/sticky-bar";
import { lookupIfsc } from "./ifsc-lookup";
import {
  isValidAccountNumber,
  isValidGstin,
  isValidIfsc,
  isValidIndianMobile,
  isValidUpi,
  isValidEmail,
  normalizeAccount,
  namesReasonablyMatch,
} from "@/lib/validation";
import { createVendor, changeBankDetails, updateVendorProfile, logExtraction } from "@/app/(app)/vendors/actions";

const optional = (check: (v: string) => boolean, msg: string) =>
  z.string().refine((v) => !v.trim() || check(v), msg);

const formSchema = z
  .object({
    displayName: z.string(),
    legalName: z.string(),
    gstin: optional(isValidGstin, "gstin"),
    phone: optional(isValidIndianMobile, "phone"),
    email: optional(isValidEmail, "email"),
    creditDays: z.string().refine((v) => v === "" || (/^\d+$/.test(v) && +v <= 365), "creditDays"),
    notes: z.string(),
    accountHolderName: z.string(),
    accountNumber: optional(isValidAccountNumber, "account"),
    accountNumberConfirm: z.string(),
    ifsc: optional(isValidIfsc, "ifsc"),
    bankName: z.string(),
    branch: z.string(),
    upiId: optional(isValidUpi, "upi"),
  });
export type VendorFormValues = z.infer<typeof formSchema>;
export type FieldName = keyof VendorFormValues;

export type ExtractionHints = {
  sourceType: "paste" | "image" | "pdf";
  engine?: string;
  parserVersion: string;
  durationMs?: number;
  confidence: Partial<Record<FieldName, number>>;
  candidates: Partial<Record<FieldName, string[]>>;
};

const EMPTY: VendorFormValues = {
  displayName: "",
  legalName: "",
  gstin: "",
  phone: "",
  email: "",
  creditDays: "30",
  notes: "",
  accountHolderName: "",
  accountNumber: "",
  accountNumberConfirm: "",
  ifsc: "",
  bankName: "",
  branch: "",
  upiId: "",
};

type Mode = { kind: "create" } | { kind: "bank"; vendorId: string; vendorName: string } | { kind: "profile"; vendorId: string };

export function VendorForm({
  mode,
  initial,
  hints,
}: {
  mode: Mode;
  initial?: Partial<VendorFormValues>;
  hints?: ExtractionHints;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ifscState, setIfscState] = useState<"idle" | "loading" | "notfound" | "error">("idle");
  const showProfile = mode.kind !== "bank";
  const showBank = mode.kind !== "profile";
  // Account numbers typed by hand are entered twice; auto-filled ones are confirmed by review.
  const typedByHand = !hints || !initial?.accountNumber;

  const form = useForm<VendorFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { ...EMPTY, ...initial },
    mode: "onBlur",
  });
  const { register, watch, setValue, formState, setError, handleSubmit } = form;
  const errors = formState.errors;

  const ifsc = watch("ifsc");
  useEffect(() => {
    if (!isValidIfsc(ifsc ?? "")) {
      setIfscState("idle");
      return;
    }
    const ctrl = new AbortController();
    setIfscState("loading");
    lookupIfsc(ifsc, ctrl.signal).then((info) => {
      if (ctrl.signal.aborted) return;
      if (info === "error") return setIfscState("error");
      if (!info) return setIfscState("notfound");
      setIfscState("idle");
      setValue("bankName", info.bank);
      setValue("branch", [info.branch, info.city].filter(Boolean).join(", "));
    });
    return () => ctrl.abort();
  }, [ifsc, setValue]);

  const displayName = watch("displayName");
  const holder = watch("accountHolderName");
  const vendorNameForMatch = mode.kind === "bank" ? mode.vendorName : displayName;
  const nameMismatch = Boolean(holder && vendorNameForMatch && !namesReasonablyMatch(holder, vendorNameForMatch) && !namesReasonablyMatch(holder, watch("legalName") || ""));

  function low(f: FieldName) {
    const c = hints?.confidence[f];
    return c !== undefined && c < 0.8 && Boolean(watch(f));
  }

  function warnText(f: FieldName) {
    return low(f) ? t("validation.lowConfidence") : undefined;
  }

  function chips(f: FieldName) {
    const c = hints?.candidates[f];
    if (!c || c.length < 2) return null;
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-warning-bg/50 p-3">
        <span className="text-sm text-warning">{t("vendors.chooseOne")}</span>
        <div className="flex flex-wrap gap-2">
          {c.map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => setValue(f, v, { shouldValidate: true, shouldDirty: true })}
              className="tabular min-h-11 rounded-lg border bg-card px-3 text-sm hover:bg-surface-hover"
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const onSubmit = handleSubmit((values) => {
    if (showProfile && !values.displayName.trim()) {
      setError("displayName", { message: "required" });
      return;
    }
    const corrected = hints
      ? (Object.keys(hints.confidence) as FieldName[]).filter((k) => (initial?.[k] ?? "") !== (values[k] ?? ""))
      : [];
    const bank = {
      accountHolderName: values.accountHolderName,
      accountNumber: values.accountNumber,
      accountNumberConfirm: values.accountNumberConfirm,
      ifsc: values.ifsc,
      bankName: values.bankName,
      branch: values.branch,
      upiId: values.upiId,
      requireConfirm: typedByHand && Boolean(values.accountNumber),
    };
    const profile = {
      displayName: values.displayName,
      legalName: values.legalName,
      gstin: values.gstin,
      phone: values.phone,
      email: values.email,
      creditDays: values.creditDays === "" ? 30 : Number(values.creditDays),
      notes: values.notes,
    };
    const source = hints ? "autofill" : "manual";
    start(async () => {
      let res;
      if (mode.kind === "create") res = await createVendor({ profile, bank, source });
      else if (mode.kind === "bank") res = await changeBankDetails(mode.vendorId, bank, source);
      else res = await updateVendorProfile(mode.vendorId, profile);
      if (!res.ok) {
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) {
          setError(k.replace(/^bank\./, "") as FieldName, { message: msg });
        }
        if (!res.fieldErrors) toast.error(t("common.somethingWrong"));
        return;
      }
      if (hints) {
        void logExtraction({
          kind: "vendor",
          sourceType: hints.sourceType,
          engine: hints.engine,
          parserVersion: hints.parserVersion,
          durationMs: hints.durationMs,
          fields: Object.fromEntries(
            (Object.keys(hints.confidence) as FieldName[]).map((k) => [k, { confidence: hints.confidence[k] ?? 0, present: Boolean(initial?.[k]) }]),
          ),
          correctedFields: corrected,
        });
      }
      const hasBank = Boolean(values.accountNumber || values.upiId);
      if (mode.kind === "create") {
        const id = (res as { data?: { id: string } }).data?.id;
        toast.success(hasBank ? t("vendors.savedNeedsReview") : t("vendors.saved"));
        router.push(hasBank && id ? `/vendors/${id}/review` : `/vendors/${id ?? ""}`);
      } else if (mode.kind === "bank") {
        toast.success(t("vendors.savedNeedsReview"));
        router.push(`/vendors/${mode.vendorId}/review`);
      } else {
        toast.success(t("vendors.saved"));
        router.push(`/vendors/${mode.vendorId}`);
      }
      router.refresh();
    });
  });

  const err = (f: FieldName) => errors[f]?.message as string | undefined;
  const acc = normalizeAccount(watch("accountNumber") ?? "");

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" data-testid="vendor-form">
      {hints ? (
        <p className="rounded-lg bg-info-bg px-3 py-2 text-sm text-info" role="status">
          {t("vendors.checkFields")}
        </p>
      ) : null}

      {showProfile ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">{t("vendors.form.sectionVendor")}</h2>
          <Field id="displayName" label={t("vendors.form.displayName")} hint={t("vendors.form.displayNameHint")} error={err("displayName")}>
            <Input id="displayName" autoComplete="organization" className={highlightClass(false, !!err("displayName"))} {...register("displayName")} />
          </Field>
          <Field id="legalName" label={t("vendors.form.legalName")} optional error={err("legalName")}>
            <Input id="legalName" className="h-12" {...register("legalName")} />
          </Field>
        </section>
      ) : null}

      {showBank ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold tracking-wide text-text-secondary uppercase">{t("vendors.form.sectionBank")}</h2>
          <Field
            id="accountHolderName"
            label={t("vendors.form.accountHolderName")}
            error={err("accountHolderName")}
            warn={nameMismatch ? t("validation.nameMismatch") : warnText("accountHolderName")}
          >
            <Input id="accountHolderName" className={highlightClass(low("accountHolderName") || nameMismatch, !!err("accountHolderName"))} {...register("accountHolderName")} />
          </Field>
          <Field id="accountNumber" label={t("vendors.form.accountNumber")} error={err("accountNumber")} warn={warnText("accountNumber")}>
            <Input
              id="accountNumber"
              inputMode="numeric"
              autoComplete="off"
              className={`tabular ${highlightClass(low("accountNumber"), !!err("accountNumber"))}`}
              {...register("accountNumber")}
            />
          </Field>
          {chips("accountNumber")}
          {typedByHand && acc ? (
            <Field id="accountNumberConfirm" label={t("vendors.form.accountNumberConfirm")} error={err("accountNumberConfirm")}>
              <Input
                id="accountNumberConfirm"
                inputMode="numeric"
                autoComplete="off"
                onPaste={(e) => e.preventDefault()}
                className={`tabular ${highlightClass(false, !!err("accountNumberConfirm"))}`}
                {...register("accountNumberConfirm")}
              />
            </Field>
          ) : null}
          <Field
            id="ifsc"
            label={t("vendors.form.ifsc")}
            error={err("ifsc")}
            warn={
              ifscState === "notfound"
                ? t("validation.ifscNotFound")
                : ifscState === "error"
                  ? t("validation.ifscLookupFailed")
                  : warnText("ifsc")
            }
            hint={ifscState === "loading" ? t("vendors.form.lookingUp") : undefined}
          >
            <Input
              id="ifsc"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={11}
              className={`uppercase ${highlightClass(low("ifsc") || ifscState === "notfound", !!err("ifsc"))}`}
              {...register("ifsc", { setValueAs: (v: string) => v.toUpperCase().replace(/\s/g, "") })}
            />
          </Field>
          {chips("ifsc")}
          {watch("bankName") ? (
            <p className="-mt-2 text-sm text-text-secondary" data-testid="bank-branch">
              {watch("bankName")}
              {watch("branch") ? ` · ${watch("branch")}` : ""}
            </p>
          ) : null}
          <Field id="upiId" label={t("vendors.form.upiId")} optional error={err("upiId")} warn={warnText("upiId")}>
            <Input id="upiId" autoCapitalize="none" autoComplete="off" className={highlightClass(low("upiId"), !!err("upiId"))} {...register("upiId")} />
          </Field>
          {chips("upiId")}
        </section>
      ) : null}

      {showProfile ? (
        <details className="group rounded-xl border bg-card p-4" open={Boolean(initial?.gstin || initial?.phone || initial?.email)}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center font-medium">{t("common.moreDetails")}</summary>
          <div className="mt-3 flex flex-col gap-4">
            <Field id="gstin" label={t("vendors.form.gstin")} optional error={err("gstin")} warn={warnText("gstin")}>
              <Input id="gstin" autoCapitalize="characters" maxLength={15} className={`uppercase ${highlightClass(low("gstin"), !!err("gstin"))}`} {...register("gstin", { setValueAs: (v: string) => v.toUpperCase().trim() })} />
            </Field>
            <Field id="phone" label={t("vendors.form.phone")} optional error={err("phone")} warn={warnText("phone")}>
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" className={highlightClass(low("phone"), !!err("phone"))} {...register("phone")} />
            </Field>
            <Field id="email" label={t("vendors.form.email")} optional error={err("email")} warn={warnText("email")}>
              <Input id="email" type="email" inputMode="email" className={highlightClass(low("email"), !!err("email"))} {...register("email")} />
            </Field>
            <Field id="creditDays" label={t("vendors.form.creditDays")} hint={t("vendors.form.creditDaysHint")} error={err("creditDays")}>
              <Input id="creditDays" inputMode="numeric" className="h-12 w-32" {...register("creditDays")} />
            </Field>
            <Field id="notes" label={t("vendors.form.notes")} optional>
              <Textarea id="notes" rows={3} {...register("notes")} />
            </Field>
          </div>
        </details>
      ) : null}

      {nameMismatch ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("validation.nameMismatch")}
        </p>
      ) : null}

      <StickyBar>
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending} data-testid="vendor-save">
          {pending ? t("common.saving") : mode.kind === "create" ? t("vendors.form.save") : t("vendors.form.saveChanges")}
        </Button>
      </StickyBar>
    </form>
  );
}
