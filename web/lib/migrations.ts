import fs from "node:fs";
import path from "node:path";
import type { Sql } from "./db";

export async function migrate(sql: Sql, dir = path.join(process.cwd(), "db", "migrations")): Promise<string[]> {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(7266001)`;
    await tx`create table if not exists schema_migrations (name text primary key, at timestamptz not null default now())`;
    const done = new Set((await tx`select name from schema_migrations`).map((r) => r.name as string));
    for (const f of files) {
      const always = f.startsWith("9999_");
      if (done.has(f) && !always) continue;
      await tx.unsafe(fs.readFileSync(path.join(dir, f), "utf8"));
      if (!done.has(f)) await tx`insert into schema_migrations(name) values (${f})`;
      applied.push(f);
    }
  });
  return applied;
}
