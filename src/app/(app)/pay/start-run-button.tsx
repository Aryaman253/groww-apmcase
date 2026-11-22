"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createDraftRun } from "./actions";

export function StartRunButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="lg" className="h-12 w-full text-base" disabled={pending} onClick={() => start(() => createDraftRun())} data-testid="start-run-btn">
      {label}
    </Button>
  );
}
