-- The shopping list is set by hand. Squirrel never changes this flag by itself.
ALTER TABLE items ADD COLUMN on_list INTEGER NOT NULL DEFAULT 0 CHECK (on_list IN (0, 1));
