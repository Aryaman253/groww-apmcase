import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Row } from "@/lib/supabase";

export const WORKSPACE_COOKIE = "tarrow_ws";

export type WorkspaceSettings = {
  hold24h?: boolean;
  keepInvoiceImages?: boolean;
  tourDone?: boolean;
  rtgsMinPaise?: number;
  defaultMethod?: "direct" | "bank_file" | "upi";
};

export type AppContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string | null; isAnonymous: boolean };
  workspace: Row<"workspaces"> & { settings: WorkspaceSettings };
  workspaces: Pick<Row<"workspaces">, "id" | "name" | "is_demo">[];
};

/** Signed-in user + current workspace. Redirects when missing. Cached per request. */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("*")
    .is("deleted_at", null)
    .order("created_at");
  if (!workspaces || workspaces.length === 0) redirect("/onboarding");
  const store = await cookies();
  const wanted = store.get(WORKSPACE_COOKIE)?.value;
  const workspace = workspaces.find((w) => w.id === wanted) ?? workspaces[0];
  return {
    supabase,
    user: { id: user.id, email: user.email ?? null, isAnonymous: Boolean(user.is_anonymous) },
    workspace: workspace as AppContext["workspace"],
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, is_demo: w.is_demo })),
  };
});

/**
 * For server actions: re-check that the user owns the workspace they act on
 * (RLS also enforces this; this gives a clear error and blocks cross-workspace ids).
 */
export async function requireOwner(workspaceId?: string) {
  const ctx = await getAppContext();
  const wsId = workspaceId ?? ctx.workspace.id;
  const { data, error } = await ctx.supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", wsId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error || !data || data.role !== "owner") throw new Error("FORBIDDEN");
  return { ...ctx, wsId };
}
