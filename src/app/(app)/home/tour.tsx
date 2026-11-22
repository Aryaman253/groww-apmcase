"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { updateSettings } from "@/app/(app)/more/settings/actions";

const STEPS = [
  { target: "hero", title: "step1Title", body: "step1Body" },
  { target: "start-run", title: "step2Title", body: "step2Body" },
  { target: "start-run", title: "step3Title", body: "step3Body" },
] as const;

/** First-run 3-step tooltip tour (skippable): Home → Start payment run → Confirm and pay. */
export function Tour({ autoStart }: { autoStart: boolean }) {
  const t = useTranslations("tour");
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem("tarrow_tour_done") === "1";
    } catch {}
    if (!autoStart || seen) return;
    const id = setTimeout(() => setStep(0), 400);
    return () => clearTimeout(id);
  }, [autoStart]);

  useEffect(() => {
    if (step === null) return;
    const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
    };
  }, [step]);

  function finish() {
    setStep(null);
    try {
      localStorage.setItem("tarrow_tour_done", "1");
    } catch {}
    void updateSettings({ tourDone: true });
  }

  if (step === null) return null;
  const s = STEPS[step];
  const top = rect ? Math.min(rect.bottom + 12, window.innerHeight - 220) : 120;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="tour-title" data-testid="tour">
      <div className="absolute inset-0 bg-black/40" onClick={finish} />
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-4 ring-brand"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : null}
      <div className="absolute inset-x-4 mx-auto max-w-sm rounded-2xl border bg-card p-5 shadow-lg" style={{ top }}>
        <p className="text-xs text-text-secondary">{t("progress", { current: step + 1, total: STEPS.length })}</p>
        <h2 id="tour-title" className="mt-1 text-lg font-semibold">
          {t(s.title)}
        </h2>
        <p className="mt-1 text-text-secondary">{t(s.body)}</p>
        <div className="mt-4 flex justify-between gap-2">
          <Button variant="ghost" className="h-11" onClick={finish}>
            {t("skip")}
          </Button>
          <Button className="h-11" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : finish())} autoFocus>
            {step + 1 < STEPS.length ? t("next") : t("finish")}
          </Button>
        </div>
      </div>
    </div>
  );
}
