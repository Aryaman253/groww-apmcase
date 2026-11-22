/**
 * Runs SQL against the hosted Supabase Postgres through the Management API.
 * Requires SUPABASE_ACCESS_TOKEN (or the Claude cloud proxy) and SUPABASE_PROJECT_REF.
 */
const ref = process.env.SUPABASE_PROJECT_REF ?? "vcqmnxhoadgjrmuerreb";
const token = process.env.SUPABASE_ACCESS_TOKEN ?? "proxy-injected";

export async function sql<T = Record<string, unknown>>(query: string): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: text };
  return { ok: true, rows: JSON.parse(text) as T[] };
}

/** Runs `query` as an authenticated user (RLS applies). The transaction is never committed. */
export function asUser<T = Record<string, unknown>>(userId: string, query: string) {
  return sql<T>(
    `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true); ${query}`,
  );
}

export const dbTestsEnabled = process.env.RUN_DB_TESTS === "1";
