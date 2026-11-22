"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/app/field";
import { TestModeBadge } from "@/components/app/status-badge";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { updateProfile, updateSettings, signOut } from "./actions";
import { connectProvider, disconnectProvider, copyTemplate, saveTemplate } from "./provider-actions";
import { resetDemo } from "@/app/demo/actions";
import { parseAmountToPaise, paiseToDecimalString } from "@/lib/money";
import type { WorkspaceSettings } from "@/lib/server/context";

type WS = { name: string; legal_name: string | null; gstin: string | null; phone: string | null; email: string | null; address: string | null; is_demo: boolean };
type Tpl = { id: string; name: string; editable: boolean; json: string; placeholder: boolean };

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsForms({ workspace, settings, provider, webhookBase, templates }: { workspace: WS; settings: WorkspaceSettings; provider: { provider: string; status: string; demo: boolean; account: string | null } | null; webhookBase: string; templates: Tpl[] }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const td = useTranslations("demo");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [p, setP] = useState({ name: workspace.name, legal_name: workspace.legal_name ?? "", gstin: workspace.gstin ?? "", phone: workspace.phone ?? "", email: workspace.email ?? "", address: workspace.address ?? "" });
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [prov, setProv] = useState<"razorpayx" | "cashfree">("razorpayx");
  const [creds, setCreds] = useState({ keyId: "", keySecret: "", accountNumber: "", webhookSecret: "", clientId: "", clientSecret: "" });
  const [rtgs, setRtgs] = useState(paiseToDecimalString(settings.rtgsMinPaise ?? 2_00_000_00, 0));
  const [editing, setEditing] = useState<Tpl | null>(null);
  const [tplErr, setTplErr] = useState<string | null>(null);

  const saveSetting = (patch: WorkspaceSettings) => start(async () => { const r = await updateSettings(patch); if (r.ok) { toast.success(t("saved")); router.refresh(); } else toast.error(tc("somethingWrong")); });
  const providerName = provider?.provider === "razorpayx" ? "RazorpayX" : provider?.provider === "cashfree" ? "Cashfree" : t("simulated");

  return (
    <div className="flex flex-col gap-4">
      <Section title={t("appearance")}>
        <div className="flex items-center justify-between"><span>{t("language")}</span><LanguageSwitcher /></div>
        <div className="flex items-center justify-between"><span>{t("theme")}</span><ThemeToggle /></div>
      </Section>

      <Section title={t("payments")} id="payments">
        <p className="text-sm text-text-secondary">{t("paymentsBody")}</p>
        {provider ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium" data-testid="provider-status">{t("connected", { provider: providerName })}</span>
              <TestModeBadge label={tc("testMode")} />
            </div>
            {provider.demo ? <p className="text-sm text-text-secondary">{t("demoKeys")}</p> : null}
            {!provider.demo ? (
              <p className="text-xs break-all text-text-secondary">{t("webhookUrl")}: <span className="tabular">{webhookBase}/{provider.provider}</span></p>
            ) : null}
            <Button variant="outline" className="h-11" disabled={pending} onClick={() => start(async () => { await disconnectProvider(); toast.success(t("disconnected")); router.refresh(); })}>{t("disconnect")}</Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await connectProvider(prov === "razorpayx" ? { provider: "razorpayx", keyId: creds.keyId, keySecret: creds.keySecret, accountNumber: creds.accountNumber, webhookSecret: creds.webhookSecret } : { provider: "cashfree", clientId: creds.clientId, clientSecret: creds.clientSecret, webhookSecret: creds.webhookSecret });
                if (!res.ok) return void toast.error(t("connectFailed", { reason: res.reason === "testKeysOnly" ? t("testKeysOnly") : res.reason }));
                toast.success(t("connectedOk"));
                setCreds({ keyId: "", keySecret: "", accountNumber: "", webhookSecret: "", clientId: "", clientSecret: "" });
                router.refresh();
              });
            }}
          >
            <p className="text-sm">{t("notConnected")}</p>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
              {(["razorpayx", "cashfree"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={prov === k} onClick={() => setProv(k)} className={`min-h-10 rounded-md text-sm ${prov === k ? "bg-card font-medium shadow-xs" : "text-text-secondary"}`}>
                  {k === "razorpayx" ? "RazorpayX" : "Cashfree"}
                </button>
              ))}
            </div>
            {prov === "razorpayx" ? (
              <>
                <Field id="keyId" label={t("keyId")} hint={t("testKeysOnly")}><Input id="keyId" autoComplete="off" value={creds.keyId} onChange={(e) => setCreds((c) => ({ ...c, keyId: e.target.value }))} className="h-12" /></Field>
                <Field id="keySecret" label={t("keySecret")}><Input id="keySecret" type="password" autoComplete="off" value={creds.keySecret} onChange={(e) => setCreds((c) => ({ ...c, keySecret: e.target.value }))} className="h-12" /></Field>
                <Field id="acct" label={t("accountNumber")}><Input id="acct" inputMode="numeric" autoComplete="off" value={creds.accountNumber} onChange={(e) => setCreds((c) => ({ ...c, accountNumber: e.target.value }))} className="h-12" /></Field>
              </>
            ) : (
              <>
                <Field id="clientId" label={t("clientId")}><Input id="clientId" autoComplete="off" value={creds.clientId} onChange={(e) => setCreds((c) => ({ ...c, clientId: e.target.value }))} className="h-12" /></Field>
                <Field id="clientSecret" label={t("clientSecret")}><Input id="clientSecret" type="password" autoComplete="off" value={creds.clientSecret} onChange={(e) => setCreds((c) => ({ ...c, clientSecret: e.target.value }))} className="h-12" /></Field>
              </>
            )}
            <Field id="wh" label={t("webhookSecret")} hint={`${t("webhookUrl")}: ${webhookBase}/${prov}`}><Input id="wh" type="password" autoComplete="off" value={creds.webhookSecret} onChange={(e) => setCreds((c) => ({ ...c, webhookSecret: e.target.value }))} className="h-12" /></Field>
            <p className="text-xs text-text-secondary">{t("credsNote")}</p>
            <Button className="h-12" disabled={pending}>{t("connect")}</Button>
          </form>
        )}
      </Section>

      <Section title={t("rules")}>
        <div className="flex items-start justify-between gap-4">
          <Label htmlFor="hold" className="flex-1 flex-col items-start gap-1">
            <span>{t("hold")}</span>
            <span className="text-sm font-normal text-text-secondary">{t("holdHint")}</span>
          </Label>
          <Switch id="hold" checked={Boolean(settings.hold24h)} onCheckedChange={(c) => saveSetting({ hold24h: c })} disabled={pending} />
        </div>
        <Field id="rtgs" label={t("rtgsMin")}>
          <div className="flex gap-2">
            <Input id="rtgs" inputMode="numeric" value={rtgs} onChange={(e) => setRtgs(e.target.value)} className="tabular h-12" />
            <Button variant="outline" className="h-12" disabled={pending} onClick={() => { const v = parseAmountToPaise(rtgs); if (v && v > 0) saveSetting({ rtgsMinPaise: v }); }}>{tc("save")}</Button>
          </div>
        </Field>
        <label className="space-y-1.5 text-sm">
          <span>{t("defaultMethod")}</span>
          <select className="h-12 w-full rounded-lg border bg-background px-3" defaultValue={settings.defaultMethod ?? "direct"} onChange={(e) => saveSetting({ defaultMethod: e.target.value as "direct" | "bank_file" | "upi" })}>
            <option value="direct">Direct pay</option>
            <option value="bank_file">Bank file</option>
            <option value="upi">UPI</option>
          </select>
        </label>
        <div className="flex items-start justify-between gap-4">
          <Label htmlFor="keep" className="flex-1 flex-col items-start gap-1">
            <span>{t("keepImages")}</span>
            <span className="text-sm font-normal text-text-secondary">{t("keepImagesHint")}</span>
          </Label>
          <Switch id="keep" checked={Boolean(settings.keepInvoiceImages)} onCheckedChange={(c) => saveSetting({ keepInvoiceImages: c })} disabled={pending} />
        </div>
      </Section>

      <Section title={t("templates")}>
        <p className="text-sm text-text-secondary">{t("templatesBody")}</p>
        <ul className="flex flex-col gap-2">
          {templates.map((tp) => (
            <li key={tp.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <span className="min-w-0 text-sm">
                {tp.name} {tp.placeholder ? <span className="ml-1 rounded bg-warning-bg px-1.5 text-xs text-warning">{t("templatePlaceholder")}</span> : null}
              </span>
              {tp.editable ? (
                <Button variant="ghost" size="sm" className="h-10" onClick={() => { setTplErr(null); setEditing(tp); }}>{t("editTemplate")}</Button>
              ) : (
                <Button variant="ghost" size="sm" className="h-10" disabled={pending} onClick={() => start(async () => { await copyTemplate(tp.id); router.refresh(); })}>{t("copyTemplate")}</Button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("profile")}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await updateProfile(p);
              if (!r.ok) return setProfileErr(r.error === "INVALID_GSTIN" ? "gstin" : r.error);
              setProfileErr(null);
              toast.success(t("saved"));
              router.refresh();
            });
          }}
        >
          <Field id="bn" label={t("businessName")}><Input id="bn" value={p.name} onChange={(e) => setP((s) => ({ ...s, name: e.target.value }))} className="h-12" /></Field>
          <Field id="ln" label={t("legalName")} optional><Input id="ln" value={p.legal_name} onChange={(e) => setP((s) => ({ ...s, legal_name: e.target.value }))} className="h-12" /></Field>
          <Field id="bg" label={t("gstin")} optional error={profileErr ?? undefined}><Input id="bg" value={p.gstin} maxLength={15} onChange={(e) => setP((s) => ({ ...s, gstin: e.target.value.toUpperCase() }))} className="h-12" /></Field>
          <Field id="bp" label={t("phone")} optional><Input id="bp" type="tel" value={p.phone} onChange={(e) => setP((s) => ({ ...s, phone: e.target.value }))} className="h-12" /></Field>
          <Field id="be" label={t("email")} optional><Input id="be" type="email" value={p.email} onChange={(e) => setP((s) => ({ ...s, email: e.target.value }))} className="h-12" /></Field>
          <Field id="ba" label={t("address")} optional><Textarea id="ba" rows={2} value={p.address} onChange={(e) => setP((s) => ({ ...s, address: e.target.value }))} /></Field>
          <Button className="h-12" disabled={pending}>{tc("save")}</Button>
        </form>
      </Section>

      {workspace.is_demo ? (
        <Section title={t("demo")} id="demo">
          <Drawer>
            <DrawerTrigger asChild><Button variant="outline" className="h-12" data-testid="reset-demo">{t("resetDemo")}</Button></DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{td("resetTitle")}</DrawerTitle>
                <DrawerDescription>{td("resetBody")}</DrawerDescription>
              </DrawerHeader>
              <DrawerFooter className="pb-safe">
                <Button size="lg" className="h-12" disabled={pending} data-testid="confirm-reset-demo" onClick={() => start(async () => { await resetDemo(); toast.success(td("resetDone")); router.push("/home"); router.refresh(); })}>{t("resetConfirm")}</Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </Section>
      ) : null}

      <Section title={t("danger")}>
        <form action={signOut}><Button variant="outline" className="h-12 w-full">{t("signOut")}</Button></form>
      </Section>

      <Drawer open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader><DrawerTitle>{editing?.name}</DrawerTitle></DrawerHeader>
          <div className="px-4">
            <Textarea className="h-[50dvh] font-mono text-xs" defaultValue={editing?.json} id="tpl-json" spellCheck={false} />
            {tplErr ? <p className="mt-2 text-sm text-danger">{t("templateInvalid", { reason: tplErr })}</p> : null}
          </div>
          <DrawerFooter className="pb-safe">
            <Button className="h-12" disabled={pending} onClick={() => start(async () => {
              const json = (document.getElementById("tpl-json") as HTMLTextAreaElement).value;
              const r = await saveTemplate(editing!.id, json);
              if (!r.ok) return setTplErr(r.reason);
              toast.success(t("templateSaved"));
              setEditing(null);
              router.refresh();
            })}>{tc("save")}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
