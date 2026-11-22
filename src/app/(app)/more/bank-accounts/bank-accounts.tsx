"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, highlightClass } from "@/components/app/field";
import { EmptyState } from "@/components/app/empty-state";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer";
import { maskAccount } from "@/lib/validation";
import { lookupIfsc } from "@/components/vendors/ifsc-lookup";
import { addDebitAccount, removeDebitAccount, setDebitTemplate, setDefaultDebitAccount } from "./actions";

type Acc = { id: string; bank_name: string; nickname: string; account_last4: string; ifsc: string | null; is_default: boolean; bank_template_id: string | null };

export function BankAccounts({ accounts, templates }: { accounts: Acc[]; templates: { id: string; name: string }[] }) {
  const t = useTranslations("bankAccounts");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ bankName: "", nickname: "", accountNumber: "", accountNumberConfirm: "", ifsc: "", templateId: templates[0]?.id ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-3">
      {accounts.length === 0 ? (
        <EmptyState icon={Landmark} title={t("empty")} body={t("emptyBody")} action={<Button className="h-11" onClick={() => setOpen(true)}>{t("add")}</Button>} />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {accounts.map((a) => (
              <li key={a.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{a.nickname}</p>
                    <p className="tabular text-sm text-text-secondary">{a.bank_name} · {maskAccount(a.account_last4)} · {a.ifsc}</p>
                  </div>
                  {a.is_default ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t("default")}</span> : null}
                </div>
                <label className="mt-3 block space-y-1 text-sm">
                  <span className="text-text-secondary">{t("template")}</span>
                  <select className="h-11 w-full rounded-lg border bg-background px-3" defaultValue={a.bank_template_id ?? ""} onChange={(e) => start(async () => { await setDebitTemplate(a.id, e.target.value || null); router.refresh(); })}>
                    {templates.map((tp) => (
                      <option key={tp.id} value={tp.id}>{tp.name}</option>
                    ))}
                  </select>
                </label>
                <div className="mt-2 flex gap-4">
                  {!a.is_default ? (
                    <button type="button" className="min-h-10 text-sm underline" onClick={() => start(async () => { await setDefaultDebitAccount(a.id); router.refresh(); })}>{t("makeDefault")}</button>
                  ) : null}
                  <button type="button" className="min-h-10 text-sm text-danger underline" onClick={() => start(async () => { await removeDebitAccount(a.id); toast.success(t("removed")); router.refresh(); })}>{t("remove")}</button>
                </div>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="h-12" onClick={() => setOpen(true)}>{t("add")}</Button>
        </>
      )}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[92dvh]">
          <form
            className="flex flex-col overflow-y-auto"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await addDebitAccount({ ...v, templateId: v.templateId || null });
                if (!res.ok) return setErrors(res.fieldErrors);
                toast.success(t("added"));
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <DrawerHeader><DrawerTitle>{t("add")}</DrawerTitle></DrawerHeader>
            <div className="flex flex-col gap-3 px-4">
              <Field id="da-nick" label={t("nickname")} error={errors.nickname}><Input id="da-nick" value={v.nickname} onChange={set("nickname")} placeholder={t("nicknamePlaceholder")} className="h-12" /></Field>
              <Field id="da-acct" label={t("accountNumber")} error={errors.accountNumber}><Input id="da-acct" inputMode="numeric" value={v.accountNumber} onChange={set("accountNumber")} className={`tabular ${highlightClass(false, !!errors.accountNumber)}`} /></Field>
              <Field id="da-acct2" label={t("accountNumberConfirm")} error={errors.accountNumberConfirm}><Input id="da-acct2" inputMode="numeric" value={v.accountNumberConfirm} onChange={set("accountNumberConfirm")} onPaste={(e) => e.preventDefault()} className={`tabular ${highlightClass(false, !!errors.accountNumberConfirm)}`} /></Field>
              <Field id="da-ifsc" label={t("ifsc")} error={errors.ifsc}>
                <Input id="da-ifsc" maxLength={11} value={v.ifsc} className={`uppercase ${highlightClass(false, !!errors.ifsc)}`} onChange={(e) => setV((s) => ({ ...s, ifsc: e.target.value.toUpperCase() }))} onBlur={async () => { const i = await lookupIfsc(v.ifsc); if (i && i !== "error") setV((s) => ({ ...s, bankName: s.bankName || i.bank })); }} />
              </Field>
              <Field id="da-bank" label={t("bankName")} error={errors.bankName}><Input id="da-bank" value={v.bankName} onChange={set("bankName")} className="h-12" /></Field>
              <label className="space-y-1.5 text-sm"><span>{t("template")}</span>
                <select className="h-12 w-full rounded-lg border bg-background px-3" value={v.templateId} onChange={set("templateId")}>
                  {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                </select>
              </label>
            </div>
            <DrawerFooter className="pb-safe"><Button size="lg" className="h-12" disabled={pending}>{pending ? tc("saving") : tc("save")}</Button></DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
