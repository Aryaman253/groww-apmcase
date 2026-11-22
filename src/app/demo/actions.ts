"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { seedDemoWorkspace, deleteDemoWorkspace } from "@/lib/server/demo-seed";
import { requireOwner, WORKSPACE_COOKIE } from "@/lib/server/context";

const cookieOpts = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };

/** Creates (or reuses) this visitor's isolated demo workspace. */
export async function startDemo(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "NO_SESSION" };
  const { data: existing } = await supabase.from("workspaces").select("id").eq("is_demo", true).is("deleted_at", null).limit(1);
  let wsId = existing?.[0]?.id;
  if (!wsId) {
    try {
      wsId = await seedDemoWorkspace(user.id);
    } catch (e) {
      console.error("demo seed failed", e instanceof Error ? e.message : e);
      return { ok: false, error: "SEED_FAILED" };
    }
  }
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, wsId, cookieOpts);
  return { ok: true };
}

export async function resetDemo(): Promise<{ ok: boolean }> {
  const ctx = await requireOwner();
  if (!ctx.workspace.is_demo) return { ok: false };
  await deleteDemoWorkspace(ctx.wsId);
  const wsId = await seedDemoWorkspace(ctx.user.id);
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, wsId, cookieOpts);
  revalidatePath("/", "layout");
  return { ok: true };
}
