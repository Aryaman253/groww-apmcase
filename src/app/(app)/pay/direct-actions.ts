"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/server/context";
import { refreshRunPayouts, startDirectPayForRun } from "@/lib/server/direct-pay";
import { isDirectPayEnabled } from "@/lib/rails/config";

export async function startDirectPay(runId: string, overrides: string[] = []) {
  if (!isDirectPayEnabled()) return { ok: false as const, error: "DISABLED", message: "Direct pay is turned off" };
  const ctx = await requireOwner();
  const id = z.uuid().parse(runId);
  const { data: run } = await ctx.supabase.from("payment_runs").select("id, status").eq("id", id).eq("workspace_id", ctx.wsId).maybeSingle();
  if (!run || !["confirmed", "in_progress"].includes(run.status)) return { ok: false as const, error: "NOT_CONFIRMED" };
  const res = await startDirectPayForRun(ctx.wsId, id, z.array(z.uuid()).max(500).parse(overrides), ctx.workspace.settings?.rtgsMinPaise);
  revalidatePath(`/pay/${id}`);
  return res;
}

export async function refreshDirectPay(runId: string) {
  const ctx = await requireOwner();
  const id = z.uuid().parse(runId);
  const { data: run } = await ctx.supabase.from("payment_runs").select("id").eq("id", id).eq("workspace_id", ctx.wsId).maybeSingle();
  if (!run) return { ok: false };
  await refreshRunPayouts(ctx.wsId, id);
  revalidatePath(`/pay/${id}`);
  return { ok: true };
}
