import type { Migration } from "../../types";

// Migrations 0001 to 0003 are frozen. Their SQL is the same as in version 1.
// A new change goes in a new migration.
export const sqliteMigrations: Migration[] = [
  {
    version: 1,
    name: "0001_init",
    statements: [
      // Managed lists. Names are stored trimmed and are unique ignoring case.
      `CREATE TABLE categories (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (name <> '' AND name = trim(name))
)`,
      `CREATE TABLE locations (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (name <> '' AND name = trim(name))
)`,
      `CREATE TABLE stores (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (name <> '' AND name = trim(name))
)`,
      // List references are nullable so that deleting a list value leaves items
      // blank rather than deleting them. Required fields are enforced by the app.
      `CREATE TABLE items (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (name <> '' AND name = trim(name)),
    count       INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    location_id INTEGER REFERENCES locations (id) ON DELETE SET NULL,
    store_id    INTEGER REFERENCES stores (id) ON DELETE SET NULL,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
      "CREATE INDEX items_category_id ON items (category_id)",
      "CREATE INDEX items_location_id ON items (location_id)",
      "CREATE INDEX items_store_id ON items (store_id)",
      // One row per count change. count is the resulting count after the change.
      `CREATE TABLE changes (
    id         INTEGER PRIMARY KEY,
    item_id    INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    delta      INTEGER NOT NULL,
    count      INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
      "CREATE INDEX changes_item_id ON changes (item_id, id)",
    ],
  },
  {
    version: 2,
    name: "0002_shopping_list",
    statements: [
      // The shopping list is set by hand. Squirrel never changes this flag by itself.
      "ALTER TABLE items ADD COLUMN on_list INTEGER NOT NULL DEFAULT 0 CHECK (on_list IN (0, 1))",
    ],
  },
  {
    version: 3,
    name: "0003_item_unit",
    statements: [
      // The unit is a label for the count, such as "tins" or "kg". It does not
      // change the count. Existing items get the default.
      "ALTER TABLE items ADD COLUMN unit TEXT NOT NULL DEFAULT 'items' CHECK (unit <> '' AND unit = trim(unit))",
    ],
  },
];
