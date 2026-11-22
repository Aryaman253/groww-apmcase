import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/crypto";

/**
 * Daily Vercel Cron (vercel.json). One lightweight query keeps the free Supabase
 * project from pausing; also removes demo workspaces older than 24 hours and their
 * anonymous users. Protected by CRON_SECRET (sent by Vercel as a Bearer token).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { error } = await db.from("bank_templates").select("id", { head: true, count: "exact" }).limit(1);
  const { data: expired } = await db.from("workspaces").select("id, created_by").eq("is_demo", true).lt("demo_expires_at", new Date().toISOString()).limit(200);
  let removed = 0;
  for (const w of expired ?? []) {
    await db.from("workspaces").delete().eq("id", w.id).eq("is_demo", true);
    const { data: u } = await db.auth.admin.getUserById(w.created_by);
    if (u.user?.is_anonymous) await db.auth.admin.deleteUser(w.created_by);
    removed++;
  }
  return NextResponse.json({ ok: !error, demoWorkspacesRemoved: removed });
}
