"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, highlightClass } from "@/components/app/field";
import { submitVendorDetails } from "./actions";
import { lookupIfsc } from "@/components/vendors/ifsc-lookup";
import { isValidIfsc } from "@/lib/validation";

export function VendorRequestForm({ token, business, askName }: { token: string; business: string; askName: boolean }) {
  const t = useTranslations("vendorRequest");
  const tf = useTranslations("vendors.form");
  const [v, setV] = useState({ name: "", accountHolderName: "", accountNumber: "", accountNumberConfirm: "", ifsc: "", upiId: "", bankName: "", branch: "" });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function onIfscBlur() {
    if (!isValidIfsc(v.ifsc)) return;
    const info = await lookupIfsc(v.ifsc);
    if (info && info !== "error") setV((s) => ({ ...s, bankName: info.bank, branch: info.branch }));
  }

  if (done) {
    return (
      <div className="rounded-2xl border bg-card p-5" role="status">
        <h2 className="text-lg font-semibold">{t("doneTitle")}</h2>
        <p className="mt-1 text-text-secondary">{t("doneBody", { business })}</p>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!consent) return setErrors({ consent: t("consentRequired") });
        start(async () => {
          const res = await submitVendorDetails({
            token,
            name: v.name || undefined,
            consent: true,
            bank: { accountHolderName: v.accountHolderName, accountNumber: v.accountNumber, accountNumberConfirm: v.accountNumberConfirm, ifsc: v.ifsc, upiId: v.upiId, bankName: v.bankName, branch: v.branch },
          });
          if (res.ok) return setDone(true);
          setErrors(res.fieldErrors ?? {});
          setFormError(res.error === "RATE_LIMITED" ? t("rateLimited") : res.error === "INVALID_LINK" ? t("invalidBody") : null);
        });
      }}
    >
      {askName ? (
        <Field id="name" label={t("yourName")}>
          <Input id="name" value={v.name} onChange={set("name")} className="h-12" autoComplete="organization" />
        </Field>
      ) : null}
      <Field id="accountHolderName" label={tf("accountHolderName")} error={errors.accountHolderName}>
        <Input id="accountHolderName" value={v.accountHolderName} onChange={set("accountHolderName")} className={highlightClass(false, !!errors.accountHolderName)} />
      </Field>
      <Field id="accountNumber" label={tf("accountNumber")} error={errors.accountNumber}>
        <Input id="accountNumber" inputMode="numeric" autoComplete="off" value={v.accountNumber} onChange={set("accountNumber")} className={`tabular ${highlightClass(false, !!errors.accountNumber)}`} />
      </Field>
      <Field id="accountNumberConfirm" label={tf("accountNumberConfirm")} error={errors.accountNumberConfirm}>
        <Input id="accountNumberConfirm" inputMode="numeric" autoComplete="off" value={v.accountNumberConfirm} onChange={set("accountNumberConfirm")} onPaste={(e) => e.preventDefault()} className={`tabular ${highlightClass(false, !!errors.accountNumberConfirm)}`} />
      </Field>
      <Field id="ifsc" label={tf("ifsc")} error={errors.ifsc} hint={v.bankName ? `${v.bankName}${v.branch ? " · " + v.branch : ""}` : undefined}>
        <Input id="ifsc" maxLength={11} value={v.ifsc} onChange={(e) => setV((s) => ({ ...s, ifsc: e.target.value.toUpperCase().replace(/\s/g, "") }))} onBlur={onIfscBlur} className={`uppercase ${highlightClass(false, !!errors.ifsc)}`} />
      </Field>
      <Field id="upiId" label={tf("upiId")} optional error={errors.upiId}>
        <Input id="upiId" autoCapitalize="none" value={v.upiId} onChange={set("upiId")} className={highlightClass(false, !!errors.upiId)} />
      </Field>
      <label className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
        <Checkbox checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5 size-5" aria-describedby="consent-err" />
        <span>{t("consent", { business })}</span>
      </label>
      {errors.consent ? <p id="consent-err" className="-mt-2 text-sm text-danger">{errors.consent}</p> : null}
      {formError ? <p className="text-sm text-danger" role="alert">{formError}</p> : null}
      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
        {pending ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
