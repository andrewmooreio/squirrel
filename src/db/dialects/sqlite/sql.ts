import type { ItemFields, ItemFilter, ListKind, Statement } from "../../types";

const COLUMN: Record<ListKind, string> = {
  categories: "category_id",
  locations: "location_id",
  stores: "store_id",
};

const ITEM_SELECT = `
  SELECT i.id, i.name, i.count,
         coalesce(i.category_id, 0) AS category_id, coalesce(c.name, '') AS category_name,
         coalesce(i.location_id, 0) AS location_id, coalesce(l.name, '') AS location_name,
         coalesce(i.store_id, 0) AS store_id, coalesce(s.name, '') AS store_name,
         i.notes, i.unit, i.on_list, i.created_at, i.updated_at
  FROM items i
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN locations l ON l.id = i.location_id
  LEFT JOIN stores s ON s.id = i.store_id`;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** The SQL text of the SQLite family. D1, node:sqlite and libSQL share it. */
export const sqliteSql = {
  ping: "SELECT 1",

  // Migrations.
  createMigrationsTable:
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  appliedMigrations: "SELECT version FROM schema_migrations",
  userVersion: "PRAGMA user_version",
  recordMigration(version: number, now: string): Statement {
    return {
      sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      params: [version, now],
    };
  },

  // Items.
  listItems(f: ItemFilter): Statement {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (f.uncategorised) {
      where.push("i.category_id IS NULL");
    } else if (f.categoryId) {
      where.push("i.category_id = ?");
      params.push(f.categoryId);
    }
    if (f.locationId) {
      where.push("i.location_id = ?");
      params.push(f.locationId);
    }
    if (f.storeId) {
      where.push("i.store_id = ?");
      params.push(f.storeId);
    }
    if (f.list === "on") where.push("i.on_list = 1");
    if (f.list === "off") where.push("i.on_list = 0");
    const q = (f.search ?? "").trim();
    if (q) {
      where.push("i.name LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(q)}%`);
    }
    let sql = ITEM_SELECT;
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    switch (f.sort) {
      case "name-desc":
        sql += " ORDER BY i.name COLLATE NOCASE DESC, i.id DESC";
        break;
      case "count":
        sql += " ORDER BY i.count, i.name COLLATE NOCASE, i.id";
        break;
      case "updated":
        sql += " ORDER BY i.updated_at DESC, i.name COLLATE NOCASE, i.id";
        break;
      default:
        sql += " ORDER BY i.name COLLATE NOCASE, i.id";
    }
    return { sql, params };
  },
  getItem(id: number): Statement {
    return { sql: `${ITEM_SELECT} WHERE i.id = ?`, params: [id] };
  },
  hasUncategorised: "SELECT EXISTS (SELECT 1 FROM items WHERE category_id IS NULL) AS found",
  createItem(f: ItemFields, count: number, now: string): Statement[] {
    const out: Statement[] = [
      {
        sql: `INSERT INTO items (name, count, category_id, location_id, store_id, notes, unit, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [f.name, count, f.categoryId, f.locationId, f.storeId, f.notes, f.unit, now, now],
      },
    ];
    if (count > 0) {
      out.push({
        sql: "INSERT INTO changes (item_id, delta, count, created_at) SELECT id, ?, ?, ? FROM items WHERE name = ?",
        params: [count, count, now, f.name],
      });
    }
    return out;
  },
  updateItem(id: number, f: ItemFields, now: string): Statement {
    return {
      sql: `UPDATE items
            SET name = ?, category_id = ?, location_id = ?, store_id = ?, notes = ?, unit = ?, updated_at = ?
            WHERE id = ?`,
      params: [f.name, f.categoryId, f.locationId, f.storeId, f.notes, f.unit, now, id],
    };
  },
  setOnList(id: number, on: boolean): Statement {
    return { sql: "UPDATE items SET on_list = ? WHERE id = ?", params: [on ? 1 : 0, id] };
  },
  deleteItem(id: number): Statement {
    return { sql: "DELETE FROM items WHERE id = ?", params: [id] };
  },
  units: `
    WITH spellings AS (
      SELECT unit, lower(unit) AS key, count(*) AS n FROM items GROUP BY unit
    ), ranked AS (
      SELECT unit, key, sum(n) OVER (PARTITION BY key) AS total,
             row_number() OVER (PARTITION BY key ORDER BY n DESC, unit) AS pick
      FROM spellings
    )
    SELECT unit FROM ranked WHERE pick = 1 ORDER BY total DESC, key`,

  // Count changes. Each is a batch, so it is atomic on every host.
  // The CHECK (count >= 0) constraint cancels the batch on a negative result.
  adjust(id: number, delta: number, now: string): Statement[] {
    return [
      {
        sql: "UPDATE items SET count = count + ?, updated_at = ? WHERE id = ?",
        params: [delta, now, id],
      },
      {
        sql: "INSERT INTO changes (item_id, delta, count, created_at) SELECT id, ?, count, ? FROM items WHERE id = ?",
        params: [delta, now, id],
      },
    ];
  },
  setCount(id: number, count: number, now: string): Statement[] {
    return [
      {
        sql: "INSERT INTO changes (item_id, delta, count, created_at) SELECT id, ? - count, ?, ? FROM items WHERE id = ? AND count <> ?",
        params: [count, count, now, id, count],
      },
      {
        sql: "UPDATE items SET count = ?, updated_at = ? WHERE id = ? AND count <> ?",
        params: [count, now, id, count],
      },
    ];
  },
  undo(id: number, now: string): Statement[] {
    return [
      {
        sql: `UPDATE items
              SET count = count - (SELECT delta FROM changes WHERE item_id = ? ORDER BY id DESC LIMIT 1),
                  updated_at = ?
              WHERE id = ? AND EXISTS (SELECT 1 FROM changes WHERE item_id = ?)`,
        params: [id, now, id, id],
      },
      {
        sql: "DELETE FROM changes WHERE id = (SELECT max(id) FROM changes WHERE item_id = ?)",
        params: [id],
      },
    ];
  },
  history(id: number, n: number): Statement {
    return {
      sql: "SELECT id, delta, count, created_at FROM changes WHERE item_id = ? ORDER BY id DESC LIMIT ?",
      params: [id, n],
    };
  },

  // Lists.
  listValues(kind: ListKind): string {
    return `SELECT l.id, l.name, count(i.id) AS uses
            FROM ${kind} l
            LEFT JOIN items i ON i.${COLUMN[kind]} = l.id
            GROUP BY l.id
            ORDER BY l.name COLLATE NOCASE, l.id`;
  },
  getListValue(kind: ListKind, id: number): Statement {
    return {
      sql: `SELECT l.id, l.name, (SELECT count(*) FROM items WHERE ${COLUMN[kind]} = l.id) AS uses
            FROM ${kind} l WHERE l.id = ?`,
      params: [id],
    };
  },
  listValueExists(kind: ListKind, id: number): Statement {
    return { sql: `SELECT id FROM ${kind} WHERE id = ?`, params: [id] };
  },
  insertListValue(kind: ListKind, name: string): Statement {
    return { sql: `INSERT INTO ${kind} (name) VALUES (?)`, params: [name] };
  },
  renameListValue(kind: ListKind, id: number, name: string): Statement {
    return { sql: `UPDATE ${kind} SET name = ? WHERE id = ?`, params: [name, id] };
  },
  deleteListValue(kind: ListKind, id: number): Statement {
    return { sql: `DELETE FROM ${kind} WHERE id = ?`, params: [id] };
  },

  // Import. Each statement reads a JSON array, so the number of statements
  // does not grow with the number of rows. This keeps an import inside the
  // D1 limit of queries for each request.
  existingItemNames: "SELECT name FROM items",
  listNames(kind: ListKind): string {
    return `SELECT name FROM ${kind}`;
  },
  importListValues(kind: ListKind, namesJson: string): Statement {
    return {
      sql: `INSERT INTO ${kind} (name) SELECT value FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`,
      params: [namesJson],
    };
  },
  importItems(rowsJson: string, stamp: string): Statement {
    return {
      sql: `INSERT INTO items (name, count, unit, category_id, location_id, store_id, notes, created_at, updated_at)
            SELECT json_extract(j.value, '$.name'), json_extract(j.value, '$.count'), json_extract(j.value, '$.unit'),
                   (SELECT id FROM categories WHERE name = json_extract(j.value, '$.category')),
                   (SELECT id FROM locations WHERE name = json_extract(j.value, '$.location')),
                   (SELECT id FROM stores WHERE name = json_extract(j.value, '$.store')),
                   json_extract(j.value, '$.notes'), ?, ?
            FROM json_each(?) j WHERE true
            ON CONFLICT DO NOTHING`,
      params: [stamp, stamp, rowsJson],
    };
  },
  importChanges(rowsJson: string, stamp: string): Statement {
    return {
      sql: `INSERT INTO changes (item_id, delta, count, created_at)
            SELECT i.id, json_extract(j.value, '$.count'), json_extract(j.value, '$.count'), ?
            FROM json_each(?) j
            JOIN items i ON i.name = json_extract(j.value, '$.name') AND i.created_at = ?
            WHERE json_extract(j.value, '$.count') > 0`,
      params: [stamp, rowsJson, stamp],
    };
  },
};
