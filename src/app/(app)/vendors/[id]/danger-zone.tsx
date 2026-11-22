"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger, DrawerClose } from "@/components/ui/drawer";
import { deleteVendor } from "../actions";

export function VendorDangerZone({ vendorId }: { vendorId: string }) {
  const t = useTranslations("vendors.detail");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="ghost" className="h-12 w-full text-danger">
          {t("delete")}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("deleteTitle")}</DrawerTitle>
          <DrawerDescription>{t("deleteBody")}</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter className="pb-safe">
          <Button
            variant="destructive"
            size="lg"
            className="h-12"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteVendor(vendorId);
                if (!res.ok) return void toast.error(tc("somethingWrong"));
                toast.success(t("deleted"));
                router.push("/vendors");
                router.refresh();
              })
            }
          >
            {t("delete")}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" size="lg" className="h-12">
              {tc("cancel")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
