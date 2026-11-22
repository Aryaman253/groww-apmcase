/**
 * Dev helper: applies pending migrations in supabase/migrations to the hosted
 * project through the Supabase Management API and records them in
 * supabase_migrations.schema_migrations, exactly like `supabase db push`, so the
 * Supabase GitHub integration sees them as already applied on merge.
 *
 * Usage: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... npx tsx scripts/db-apply.ts [--dry-run]
 * (In the Claude cloud session the token is injected by the network proxy.)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ref = process.env.SUPABASE_PROJECT_REF ?? "vcqmnxhoadgjrmuerreb";
const token = process.env.SUPABASE_ACCESS_TOKEN ?? "proxy-injected";
const dry = process.argv.includes("--dry-run");

async function query<T = unknown>(sql: string): Promise<T> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  await query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text not null primary key, statements text[], name text);`);
  const applied = new Set(
    (await query<{ version: string }[]>("select version from supabase_migrations.schema_migrations")).map((r) => r.version),
  );
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    const version = f.slice(0, 14);
    const name = f.slice(15, -4);
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(dir, f), "utf8");
    console.log(`${dry ? "[dry-run] would apply" : "applying"} ${f}`);
    if (dry) continue;
    await query(`begin;\n${sql}\n;insert into supabase_migrations.schema_migrations (version, name, statements)
      values (${lit(version)}, ${lit(name)}, array[${lit(sql)}]);\ncommit;`);
  }
  console.log("migrations up to date");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
