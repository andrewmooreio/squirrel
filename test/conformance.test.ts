// The conformance suite. A new driver must pass every test in this file.

import { describe, expect, it } from "vitest";
import { newDriver } from "#driver";
import { NotFoundError, ValidationError } from "../src/app/errors";
import { createStore, type Item } from "../src/app/store";
import { BelowZeroError, DuplicateError } from "../src/db/errors";
import type { Driver } from "../src/db/types";

async function setup() {
  const driver = await newDriver();
  return { driver, store: createStore(driver) };
}

async function makeItem(
  store: ReturnType<typeof createStore>,
  name: string,
  count = 0,
): Promise<Item> {
  const categoryId = await store.createListValue("categories", `Cat ${name}`);
  const locationId = await store.createListValue("locations", `Loc ${name}`);
  const storeId = await store.createListValue("stores", `Shop ${name}`);
  return store.createItem({ name, count, categoryId, locationId, storeId });
}

const raw = (driver: Driver, sql: string, params: (string | number)[] = []) =>
  driver.batch([{ sql, params }]);

describe("conformance", () => {
  it("adds 50 parallel +1 changes exactly", async () => {
    const { store } = await setup();
    const item = await makeItem(store, "Toothpaste");
    await Promise.all(Array.from({ length: 50 }, () => store.adjust(item.id, 1)));
    expect((await store.getItem(item.id)).count).toBe(50);
    expect(await store.history(item.id, 100)).toHaveLength(50);
  });

  it("never lets a count go below 0", async () => {
    const { store } = await setup();
    const item = await makeItem(store, "Tomatoes");
    await expect(store.adjust(item.id, -1)).rejects.toBeInstanceOf(BelowZeroError);
    expect((await store.getItem(item.id)).count).toBe(0);
    expect(await store.history(item.id, 10)).toHaveLength(0);
  });

  it("reports an unknown item on adjust", async () => {
    const { store } = await setup();
    await expect(store.adjust(9999, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sets an exact count and records the difference", async () => {
    const { store } = await setup();
    const item = await makeItem(store, "Nuts", 3);
    await store.setCount(item.id, 10);
    const hist = await store.history(item.id, 10);
    expect(hist[0]).toMatchObject({ delta: 7, count: 10 });

    await store.setCount(item.id, 10);
    expect(await store.history(item.id, 10)).toHaveLength(hist.length);

    await expect(store.setCount(item.id, -1)).rejects.toBeInstanceOf(ValidationError);
    await expect(store.setCount(9999, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("undoes back through the history", async () => {
    const { store } = await setup();
    const item = await makeItem(store, "Soap");
    await store.adjust(item.id, 1);
    await store.setCount(item.id, 5);

    expect((await store.undo(item.id)).count).toBe(1);
    const hist = await store.history(item.id, 10);
    expect(hist).toHaveLength(1);
    expect(hist[0]?.delta).toBe(1);

    expect((await store.undo(item.id)).count).toBe(0);
    expect(await store.history(item.id, 10)).toHaveLength(0);
  });

  it("refuses to undo when there is nothing to undo", async () => {
    const { store } = await setup();
    const item = await makeItem(store, "Foil");
    await expect(store.undo(item.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses an undo that would make the count negative", async () => {
    const { store, driver } = await setup();
    const item = await makeItem(store, "Rice");
    await store.setCount(item.id, 5);
    await raw(driver, "UPDATE items SET count = 3 WHERE id = ?", [item.id]);

    await expect(store.undo(item.id)).rejects.toBeInstanceOf(BelowZeroError);
    expect((await store.getItem(item.id)).count).toBe(3);
    expect(await store.history(item.id, 10)).toHaveLength(1);
  });

  it("leaves items blank when a list value is deleted", async () => {
    const { store } = await setup();
    const item = await makeItem(store, "Bleach", 2);
    await store.deleteListValue("categories", item.categoryId);
    await store.deleteListValue("locations", item.locationId);
    await store.deleteListValue("stores", item.storeId);

    const got = await store.getItem(item.id);
    expect([got.categoryId, got.locationId, got.storeId]).toEqual([0, 0, 0]);
    expect(got.count).toBe(2);
  });

  it("deletes the history of a deleted item", async () => {
    const { store, driver } = await setup();
    const item = await makeItem(store, "Pasta");
    await store.adjust(item.id, 1);
    await store.deleteItem(item.id);

    await expect(store.getItem(item.id)).rejects.toBeInstanceOf(NotFoundError);
    const rows = await driver.query("SELECT count(*) AS n FROM changes WHERE item_id = ?", [
      item.id,
    ]);
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("keeps names unique regardless of case", async () => {
    const { store } = await setup();
    await store.createListValue("categories", "Toiletries");
    for (const dup of ["toiletries", "  TOILETRIES  "]) {
      await expect(store.createListValue("categories", dup)).rejects.toBeInstanceOf(DuplicateError);
    }
    // The same name in another list is fine.
    await store.createListValue("locations", "Toiletries");

    const item = await makeItem(store, "Beans");
    await expect(
      store.createItem({
        name: " beans ",
        categoryId: item.categoryId,
        locationId: item.locationId,
        storeId: item.storeId,
      }),
    ).rejects.toBeInstanceOf(DuplicateError);
  });

  it("does not record a history entry or change updated_at for the shopping flag", async () => {
    const { store } = await setup();
    const item = await makeItem(store, "Rice", 1);
    const before = await store.getItem(item.id);
    const after = await store.setOnList(item.id, true);
    expect(after.onList).toBe(true);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(await store.history(item.id, 10)).toHaveLength(1);
  });

  it("gives items from before the unit column the default unit", async () => {
    const driver = await newDriver();
    const { sql, migrations } = driver.dialect;
    // Build a 1.x database: migrations 1 and 2 only, no schema_migrations table.
    for (const m of migrations.filter((m) => m.version <= 2)) {
      await driver.batch(m.statements.map((s) => ({ sql: s })));
    }
    await driver.batch([
      { sql: "INSERT INTO categories (name) VALUES ('Food')" },
      { sql: "INSERT INTO locations (name) VALUES ('Pantry')" },
      { sql: "INSERT INTO stores (name) VALUES ('Aldi')" },
      {
        sql: "INSERT INTO items (name, count, category_id, location_id, store_id) VALUES ('Beans', 3, 1, 1, 1)",
      },
      { sql: sql.createMigrationsTable },
      sql.recordMigration(1, "2026-01-01T00:00:00.000Z"),
      sql.recordMigration(2, "2026-01-01T00:00:00.000Z"),
    ]);

    const items = await createStore(driver).listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Beans", unit: "items", count: 3 });
  });

  it("imports rows in one batch and skips the bad ones", async () => {
    const { store } = await setup();
    const row = (line: number, name: string, extra: Partial<Record<string, string>> = {}) => ({
      line,
      name,
      count: "1",
      unit: "",
      category: "Food",
      location: "Garage",
      store: "Aldi",
      notes: "",
      ...extra,
    });
    const result = await store.importItems([
      row(2, "Beans", { count: "4", unit: " tins " }),
      row(3, "beans"),
      row(4, "Salt", { category: "" }),
      row(5, "Oil", { location: "Shed", category: "food" }),
    ]);
    expect(result.added).toBe(2);
    expect(result.skipped.map((s) => s.line)).toEqual([3, 4]);

    const beans = (await store.listItems({ search: "Beans" }))[0];
    expect(beans).toMatchObject({ count: 4, unit: "tins" });
    expect(await store.history(beans?.id ?? 0, 10)).toHaveLength(1);
    expect(await store.lists("categories")).toHaveLength(1);
    expect((await store.lists("locations")).map((l) => l.name)).toEqual(["Garage", "Shed"]);
  });
});
