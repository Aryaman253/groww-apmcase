import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-lg font-medium">404</p>
      <p className="text-text-secondary">{t("notAllowed")}</p>
      <Button asChild className="h-11"><Link href="/home">{(await getTranslations("nav"))("home")}</Link></Button>
    </div>
  );
}
