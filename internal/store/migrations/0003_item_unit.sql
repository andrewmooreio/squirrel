-- The unit is a label for the count, such as "tins" or "kg". It does not
-- change the count. Existing items get the default.
ALTER TABLE items ADD COLUMN unit TEXT NOT NULL DEFAULT 'items' CHECK (unit <> '' AND unit = trim(unit));
