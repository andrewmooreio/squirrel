// An old 1.x SQLite file opens in place. This test needs a file on disk, so it runs on Node only.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createStore } from "../src/app/store";
import { sqliteMigrations } from "../src/db/dialects/sqlite/migrations";
import { nodeSqliteDriver } from "../src/db/drivers/node-sqlite";

it("opens a 1.x file with user_version 3 and seeds schema_migrations", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "squirrel-old-")), "old.db");
  const old = new DatabaseSync(path);
  for (const m of sqliteMigrations) for (const s of m.statements) old.exec(s);
  old.exec(`
    PRAGMA user_version = 3;
    INSERT INTO categories (name) VALUES ('Food');
    INSERT INTO locations (name) VALUES ('Pantry');
    INSERT INTO stores (name) VALUES ('Aldi');
    INSERT INTO items (name, count, category_id, location_id, store_id, unit)
      VALUES ('Beans', 3, 1, 1, 1, 'tins');`);
  old.close();

  const driver = nodeSqliteDriver(path);
  const store = createStore(driver);
  const items = await store.listItems();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ name: "Beans", count: 3, unit: "tins" });

  const versions = await driver.query("SELECT version FROM schema_migrations ORDER BY version");
  expect(versions.map((r) => r.version)).toEqual([1, 2, 3]);
  // The old file keeps working for writes.
  await store.adjust(items[0]?.id ?? 0, 1);
  expect((await store.listItems())[0]?.count).toBe(4);
});
