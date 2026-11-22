import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppContext } from "@/lib/server/context";
import { buildBankFileInput, generateBankFile, validateRun } from "@/lib/server/run-files";
import { logActivity } from "@/lib/server/activity";

/**
 * GET ?check=1 → validation result (JSON, no account numbers).
 * GET → the file (first part; ?part=N for split files). Blocks download on any row error.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "BAD_ID" }, { status: 400 });
  const ctx = await getAppContext();
  const built = await buildBankFileInput(ctx, id);
  if (!built) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const url = new URL(req.url);
  const v = validateRun(built.input);
  const safe = {
    ok: v.ok,
    isPlaceholder: built.isPlaceholder,
    fileCount: v.fileCount,
    totalPaise: v.totalPaise,
    rowErrors: v.rowErrors.map((e) => ({ row: e.row, paymentId: e.paymentId, vendorName: e.vendorName, field: e.field, code: e.code })),
    rowWarnings: v.rowWarnings.map((e) => ({ row: e.row, paymentId: e.paymentId, vendorName: e.vendorName, code: e.code })),
    fileErrors: v.fileErrors.map((e) => ({ code: e.code })),
    count: built.input.payments.length,
  };
  if (url.searchParams.get("check") || !v.ok) return NextResponse.json(safe, { status: v.ok ? 200 : 422 });
  const out = generateBankFile(built.input);
  const part = Math.max(1, Math.min(out.files.length, Number(url.searchParams.get("part") ?? 1) || 1));
  const file = out.files[part - 1];
  await logActivity(ctx, ctx.workspace.id, "run.file_downloaded", { type: "run", id }, { rows: file.rowCount, total_paise: file.totalPaise, part });
  const body = typeof file.content === "string" ? file.content : Buffer.from(file.content);
  return new NextResponse(body, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
