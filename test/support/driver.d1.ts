import { env } from "cloudflare:test";
import { d1Driver } from "../../src/db/drivers/d1";
import type { Driver } from "../../src/db/types";

const TABLES = ["changes", "items", "categories", "locations", "stores", "schema_migrations"];

/** A driver on the D1 binding, with every table dropped first. */
export async function newDriver(): Promise<Driver> {
  const db = (env as { DB: D1Database }).DB;
  await db.batch(TABLES.map((t) => db.prepare(`DROP TABLE IF EXISTS ${t}`)));
  return d1Driver(db);
}
