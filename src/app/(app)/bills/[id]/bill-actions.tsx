"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { deleteBill, markBillPaid, setBillHold } from "../actions";

export function BillActions({ billId, status, locked }: { billId: string; status: string; locked: boolean }) {
  const t = useTranslations("bills.actions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState<null | "paid" | "delete" | "hold">(null);
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (status === "paid" || locked) return null;

  const run = (fn: () => Promise<{ ok: boolean }>, msg: string, after?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setErr(t("referenceRequired"));
        return;
      }
      toast.success(msg);
      setSheet(null);
      if (after) router.push(after);
      router.refresh();
    });

  return (
    <div className="mt-6 flex flex-col gap-2">
      <Button size="lg" className="h-12" onClick={() => setSheet("paid")} data-testid="mark-paid">
        {t("markPaid")}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline" className="h-12">
          <Link href={`/bills/${billId}/edit`}>{t("edit")}</Link>
        </Button>
        {status === "on_hold" ? (
          <Button variant="outline" className="h-12" disabled={pending} onClick={() => run(() => setBillHold(billId, false), t("unheld"))}>
            {t("unhold")}
          </Button>
        ) : (
          <Button variant="outline" className="h-12" onClick={() => setSheet("hold")}>
            {t("hold")}
          </Button>
        )}
      </div>
      <Button variant="ghost" className="h-12 text-danger" onClick={() => setSheet("delete")}>
        {t("delete")}
      </Button>

      <Drawer open={sheet !== null} onOpenChange={(o) => !o && (setSheet(null), setErr(null))}>
        <DrawerContent>
          {sheet === "paid" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => markBillPaid(billId, ref), t("markedPaid"));
              }}
            >
              <DrawerHeader>
                <DrawerTitle>{t("markPaidTitle")}</DrawerTitle>
                <DrawerDescription>{t("markPaidBody")}</DrawerDescription>
              </DrawerHeader>
              <div className="space-y-2 px-4">
                <Label htmlFor="ref">{t("reference")}</Label>
                <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} className="tabular h-12" autoComplete="off" required minLength={4} maxLength={40} />
                {err ? <p className="text-sm text-danger">{err}</p> : null}
              </div>
              <DrawerFooter className="pb-safe">
                <Button size="lg" className="h-12" disabled={pending || ref.trim().length < 4}>
                  {t("markPaid")}
                </Button>
              </DrawerFooter>
            </form>
          ) : sheet === "hold" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => setBillHold(billId, true, reason), t("held"));
              }}
            >
              <DrawerHeader>
                <DrawerTitle>{t("hold")}</DrawerTitle>
              </DrawerHeader>
              <div className="space-y-2 px-4">
                <Label htmlFor="reason">{t("holdReason")}</Label>
                <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-12" maxLength={200} />
              </div>
              <DrawerFooter className="pb-safe">
                <Button size="lg" className="h-12" disabled={pending}>
                  {t("hold")}
                </Button>
              </DrawerFooter>
            </form>
          ) : sheet === "delete" ? (
            <>
              <DrawerHeader>
                <DrawerTitle>{t("deleteTitle")}</DrawerTitle>
                <DrawerDescription>{t("deleteBody")}</DrawerDescription>
              </DrawerHeader>
              <DrawerFooter className="pb-safe">
                <Button size="lg" variant="destructive" className="h-12" disabled={pending} onClick={() => run(() => deleteBill(billId), t("deleted"), "/bills")}>
                  {t("delete")}
                </Button>
                <Button size="lg" variant="outline" className="h-12" onClick={() => setSheet(null)}>
                  {tc("cancel")}
                </Button>
              </DrawerFooter>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
