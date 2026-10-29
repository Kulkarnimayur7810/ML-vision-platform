import postgres from "postgres";

export type Sql = postgres.Sql;
const g = globalThis as unknown as { __sql?: Sql };

export function sql(): Sql {
  if (!g.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__sql = postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idle_timeout: 20,
      prepare: false, // works with Supabase/pgbouncer transaction pooling
      onnotice: () => {},
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
    });
  }
  return g.__sql;
}
export async function closeSql() { if (g.__sql) { await g.__sql.end(); g.__sql = undefined; } }

/** Run `fn` in a transaction; `tx` is typed like the pool so helpers accept either. */
export function tx<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql().begin((t) => fn(t as unknown as Sql)) as Promise<T>;
}
