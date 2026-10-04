-- Managed lists. Names are stored trimmed and are unique ignoring case.
CREATE TABLE categories (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (name <> '' AND name = trim(name))
);

CREATE TABLE locations (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (name <> '' AND name = trim(name))
);

CREATE TABLE stores (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (name <> '' AND name = trim(name))
);

-- List references are nullable so that deleting a list value leaves items
-- blank rather than deleting them. Required fields are enforced by the store.
CREATE TABLE items (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (name <> '' AND name = trim(name)),
    count       INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    location_id INTEGER REFERENCES locations (id) ON DELETE SET NULL,
    store_id    INTEGER REFERENCES stores (id) ON DELETE SET NULL,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX items_category_id ON items (category_id);
CREATE INDEX items_location_id ON items (location_id);
CREATE INDEX items_store_id ON items (store_id);

-- One row per count change. count is the resulting count after the change.
CREATE TABLE changes (
    id         INTEGER PRIMARY KEY,
    item_id    INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    delta      INTEGER NOT NULL,
    count      INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX changes_item_id ON changes (item_id, id);
