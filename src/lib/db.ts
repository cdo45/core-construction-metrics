import { neon, NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

let _sql: Sql | null = null;

export function getDb(): Sql {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _sql = neon(url);
  }
  return _sql;
}
