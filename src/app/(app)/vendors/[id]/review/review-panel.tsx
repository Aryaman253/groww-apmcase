"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, EyeOff, ShieldAlert, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { HoldToConfirm } from "@/components/app/hold-to-confirm";
import { StickyBar } from "@/components/app/sticky-bar";
import { reviewBankDetails, revealAccountNumber } from "../../actions";
import { maskAccount, namesReasonablyMatch } from "@/lib/validation";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

type D = { id: string; holder: string | null; last4: string | null; ifsc: string | null; bank: string | null; upi: string | null; source: string; createdAt: string };

export function ReviewPanel({
  vendorId,
  vendorName,
  legalName,
  oldDetails,
  newDetails,
  hold24h,
}: {
  vendorId: string;
  vendorName: string;
  legalName: string | null;
  oldDetails: D | null;
  newDetails: D;
  hold24h: boolean;
}) {
  const t = useTranslations("vendors");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const locale = useLocale();
  const router = useRouter();
  const [full, setFull] = useState<Record<string, string> | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  async function toggleShow() {
    if (full) return setFull(null);
    const out: Record<string, string> = {};
    for (const d of [oldDetails, newDetails]) {
      if (d?.last4) {
        const res = await revealAccountNumber(d.id);
        if (res.ok && res.data) out[d.id] = res.data.accountNumber;
      }
    }
    setFull(out);
  }

  const acct = (d: D | null) => (d?.last4 ? (full?.[d.id] ?? maskAccount(d.last4)) : "—");
  const rows: { k: string; old: string; neu: string }[] = [
    { k: t("form.accountHolderName"), old: oldDetails?.holder ?? "—", neu: newDetails.holder ?? "—" },
    { k: t("form.accountNumber"), old: acct(oldDetails), neu: acct(newDetails) },
    { k: t("form.ifsc"), old: oldDetails?.ifsc ?? "—", neu: newDetails.ifsc ?? "—" },
    { k: t("form.bankBranch"), old: oldDetails?.bank ?? "—", neu: newDetails.bank ?? "—" },
    { k: t("form.upiId"), old: oldDetails?.upi ?? "—", neu: newDetails.upi ?? "—" },
  ];
  const nameOk = !newDetails.holder || namesReasonablyMatch(newDetails.holder, vendorName) || (legalName ? namesReasonablyMatch(newDetails.holder, legalName) : false);

  function decide(approve: boolean) {
    start(async () => {
      const res = await reviewBankDetails(newDetails.id, approve);
      if (!res.ok) return void toast.error(tc("somethingWrong"));
      toast.success(approve ? t("review.approved") : t("review.rejected"));
      setConfirmOpen(false);
      router.push(`/vendors/${vendorId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="review-panel">
      <p className="flex items-start gap-2 rounded-xl bg-warning-bg p-3 text-sm text-warning">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("review.intro")}
      </p>
      <p className="text-sm text-text-secondary">
        {t(`detail.source.${newDetails.source}`)} · {t("detail.addedOn", { date: formatDate(newDetails.createdAt.slice(0, 10), locale) })}
      </p>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="grid grid-cols-[1fr_1fr] border-b bg-secondary text-xs font-semibold tracking-wide text-text-secondary uppercase">
          <div className="px-3 py-2">{t("review.old")}</div>
          <div className="border-l px-3 py-2">{t("review.new")}</div>
        </div>
        {!oldDetails ? <p className="border-b px-3 py-2 text-xs text-text-secondary">{t("review.noOld")}</p> : null}
        <dl>
          {rows.map((r) => {
            const changed = r.old !== r.neu && oldDetails;
            return (
              <div key={r.k} className="border-b last:border-b-0">
                <dt className="px-3 pt-2 text-xs text-text-secondary">{r.k}</dt>
                <dd className="grid grid-cols-2 text-sm">
                  <span className="tabular px-3 pb-2 break-all text-text-secondary">{r.old}</span>
                  <span className={cn("tabular border-l px-3 pb-2 break-all", changed && "bg-warning-bg font-semibold text-foreground")}>{r.neu}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      <Button variant="outline" className="h-11 w-fit" onClick={toggleShow} data-testid="show-full">
        {full ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        {full ? t("review.hideFull") : t("review.showFull")}
      </Button>
      {!nameOk ? (
        <p className="flex items-start gap-2 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {tv("nameMismatch")}
        </p>
      ) : null}
      {hold24h ? <p className="text-sm text-text-secondary">{t("review.holdNote")}</p> : null}
      <StickyBar className="flex gap-2">
        <Button variant="outline" size="lg" className="h-12" disabled={pending} onClick={() => decide(false)} data-testid="reject-bank">
          {t("review.reject")}
        </Button>
        <Button size="lg" className="h-12 flex-1" onClick={() => setConfirmOpen(true)} data-testid="approve-bank">
          {t("review.approve")}
        </Button>
      </StickyBar>
      <Drawer open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("review.confirmTitle")}</DrawerTitle>
            <DrawerDescription>
              {t("review.confirmBody", { name: vendorName, account: newDetails.last4 ? maskAccount(newDetails.last4) : (newDetails.upi ?? "") })}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="pb-safe">
            <HoldToConfirm label={t("review.approve")} holdingLabel={tc("confirm") + "…"} onConfirm={() => decide(true)} disabled={pending} testId="confirm-approve" />
            <Button variant="ghost" className="h-12" onClick={() => setConfirmOpen(false)}>
              {tc("cancel")}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
