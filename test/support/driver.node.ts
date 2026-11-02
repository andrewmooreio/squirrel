import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeSqliteDriver } from "../../src/db/drivers/node-sqlite";
import type { Driver } from "../../src/db/types";

/** A fresh driver on a database file in a temporary directory. */
export async function newDriver(): Promise<Driver> {
  const dir = mkdtempSync(join(tmpdir(), "squirrel-"));
  return nodeSqliteDriver(join(dir, "test.db"));
}
