import { ensureMigrated } from "../db/migrate";
import {
  type Driver,
  type ItemFields,
  type ItemFilter,
  LIST_KINDS,
  type ListKind,
  type Param,
  type Row,
  type Statement,
  type StatementResult,
} from "../db/types";
import { BelowZeroError, DuplicateError, invalid, NotFoundError, ValidationError } from "./errors";
import { COUNT_MESSAGE, cleanName, cleanNotes, cleanUnit, DEFAULT_UNIT } from "./validate";

export interface Item {
  id: number;
  name: string;
  count: number;
  /** 0 means the list value was deleted and the field is blank. */
  categoryId: number;
  categoryName: string;
  locationId: number;
  locationName: string;
  storeId: number;
  storeName: string;
  notes: string;
  unit: string;
  onList: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemInput {
  name: string;
  /** Used only by createItem. */
  count?: number;
  categoryId: number;
  locationId: number;
  storeId: number;
  notes?: string;
  unit?: string;
}

export interface Change {
  id: number;
  delta: number;
  count: number;
  createdAt: string;
}

export interface ListValue {
  id: number;
  name: string;
  uses: number;
}

export interface ImportRow {
  line: number;
  name: string;
  count: string;
  unit: string;
  category: string;
  location: string;
  store: string;
  notes: string;
}

export interface ImportSkip {
  line: number;
  name: string;
  reason: string;
}

export interface ImportResult {
  added: number;
  skipped: ImportSkip[];
}

export const SKIP_EXISTS = "An item with this name exists. Squirrel did not change it.";

export const isListKind = (s: string): s is ListKind => (LIST_KINDS as string[]).includes(s);

const toItem = (r: Row): Item => ({
  id: Number(r.id),
  name: String(r.name),
  count: Number(r.count),
  categoryId: Number(r.category_id),
  categoryName: String(r.category_name),
  locationId: Number(r.location_id),
  locationName: String(r.location_name),
  storeId: Number(r.store_id),
  storeName: String(r.store_name),
  notes: String(r.notes),
  unit: String(r.unit),
  onList: Number(r.on_list) === 1,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const now = () => new Date().toISOString();

export type Store = ReturnType<typeof createStore>;

/** All data rules live here. The store talks to the driver and to nothing else. */
export function createStore(driver: Driver) {
  const sql = driver.dialect.sql;

  const query = async (s: Statement | string): Promise<Row[]> => {
    await ensureMigrated(driver);
    const st = typeof s === "string" ? { sql: s } : s;
    try {
      return await driver.query(st.sql, st.params as Param[] | undefined);
    } catch (err) {
      throw driver.mapError(err);
    }
  };

  const batch = async (statements: Statement[]): Promise<StatementResult[]> => {
    await ensureMigrated(driver);
    try {
      return await driver.batch(statements);
    } catch (err) {
      throw driver.mapError(err);
    }
  };

  const getItem = async (id: number): Promise<Item> => {
    const rows = await query(sql.getItem(id));
    if (!rows[0]) throw new NotFoundError();
    return toItem(rows[0]);
  };

  /** Trims the input and checks the required fields and the list references. */
  const validate = async (input: ItemInput): Promise<{ fields: ItemFields; count: number }> => {
    const errors: Record<string, string> = {};
    let name = input.name;
    try {
      name = cleanName(input.name);
    } catch (err) {
      if (err instanceof ValidationError) errors.name = err.fields.name ?? "";
    }
    const { notes, message: notesMsg } = cleanNotes(input.notes ?? "");
    if (notesMsg) errors.notes = notesMsg;
    const { unit, message: unitMsg } = cleanUnit(input.unit ?? "");
    if (unitMsg) errors.unit = unitMsg;

    const refs: [ListKind, string, number, string][] = [
      ["categories", "category", input.categoryId, "a category"],
      ["locations", "location", input.locationId, "a location"],
      ["stores", "store", input.storeId, "a store"],
    ];
    for (const [kind, field, id, label] of refs) {
      if (!id || (await query(sql.listValueExists(kind, id))).length === 0) {
        errors[field] = `Choose ${label}.`;
      }
    }
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    return {
      fields: {
        name,
        categoryId: input.categoryId,
        locationId: input.locationId,
        storeId: input.storeId,
        notes,
        unit,
      },
      count: input.count ?? 0,
    };
  };

  const mustChange = (r: StatementResult | undefined) => {
    if (!r || r.changes === 0) throw new NotFoundError();
  };

  const listIds = async (kind: ListKind): Promise<Map<string, number>> => {
    const rows = await query(`SELECT id, name FROM ${kind}`);
    return new Map(rows.map((r) => [String(r.name).toLowerCase(), Number(r.id)]));
  };

  return {
    ping: () => query(sql.ping),

    // Items.
    async listItems(f: ItemFilter = {}): Promise<Item[]> {
      return (await query(sql.listItems(f))).map(toItem);
    },
    async hasUncategorised(): Promise<boolean> {
      return Number((await query(sql.hasUncategorised))[0]?.found) === 1;
    },
    getItem,
    async createItem(input: ItemInput): Promise<Item> {
      const { fields, count } = await validate(input);
      if (count < 0) throw invalid("count", COUNT_MESSAGE);
      const results = await batch(sql.createItem(fields, count, now()));
      return getItem(results[0]?.lastInsertId ?? 0);
    },
    async updateItem(id: number, input: ItemInput): Promise<Item> {
      const { fields } = await validate(input);
      const [r] = await batch([sql.updateItem(id, fields, now())]);
      mustChange(r);
      return getItem(id);
    },
    /** Does not change updated_at, and records no change in the history. */
    async setOnList(id: number, on: boolean): Promise<Item> {
      const [r] = await batch([sql.setOnList(id, on)]);
      mustChange(r);
      return getItem(id);
    },
    async deleteItem(id: number): Promise<void> {
      const [r] = await batch([sql.deleteItem(id)]);
      mustChange(r);
    },
    /** DEFAULT_UNIT and every unit in use, most used first. */
    async units(): Promise<string[]> {
      const out = (await query(sql.units)).map((r) => String(r.unit));
      if (!out.some((u) => u.toLowerCase() === DEFAULT_UNIT)) out.push(DEFAULT_UNIT);
      return out;
    },

    // Count changes.
    async adjust(id: number, delta: number): Promise<Item> {
      if (delta === 0) return getItem(id);
      const [r] = await batch(sql.adjust(id, delta, now()));
      mustChange(r);
      return getItem(id);
    },
    async setCount(id: number, count: number): Promise<Item> {
      if (!Number.isInteger(count) || count < 0) throw invalid("count", COUNT_MESSAGE);
      await batch(sql.setCount(id, count, now()));
      return getItem(id);
    },
    async undo(id: number): Promise<Item> {
      const [r] = await batch(sql.undo(id, now()));
      mustChange(r);
      return getItem(id);
    },
    async history(id: number, n: number): Promise<Change[]> {
      return (await query(sql.history(id, n))).map((r) => ({
        id: Number(r.id),
        delta: Number(r.delta),
        count: Number(r.count),
        createdAt: String(r.created_at),
      }));
    },

    // Lists.
    async lists(kind: ListKind): Promise<ListValue[]> {
      return (await query(sql.listValues(kind))).map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        uses: Number(r.uses),
      }));
    },
    async createListValue(kind: ListKind, name: string): Promise<number> {
      const [r] = await batch([sql.insertListValue(kind, cleanName(name))]);
      return r?.lastInsertId ?? 0;
    },
    async renameListValue(kind: ListKind, id: number, name: string): Promise<void> {
      const [r] = await batch([sql.renameListValue(kind, id, cleanName(name))]);
      mustChange(r);
    },
    async deleteListValue(kind: ListKind, id: number): Promise<void> {
      const [r] = await batch([sql.deleteListValue(kind, id)]);
      mustChange(r);
    },

    /**
     * Adds the rows that are valid and new. It plans in code, then writes
     * everything in one batch. Only a database error throws, and then
     * nothing is written.
     */
    async importItems(rows: ImportRow[]): Promise<ImportResult> {
      const existing = new Set(
        (await query(sql.existingItemNames)).map((r) => String(r.name).toLowerCase()),
      );
      const lists: Record<ListKind, Map<string, number>> = {
        categories: await listIds("categories"),
        locations: await listIds("locations"),
        stores: await listIds("stores"),
      };

      const skipped: ImportSkip[] = [];
      const plan: {
        name: string;
        count: number;
        unit: string;
        category: string;
        location: string;
        store: string;
        notes: string;
      }[] = [];
      const newValues: Record<ListKind, Map<string, string>> = {
        categories: new Map(),
        locations: new Map(),
        stores: new Map(),
      };

      for (const row of rows) {
        const clean = cleanImportRow(row);
        if (typeof clean === "string") {
          skipped.push({ line: row.line, name: row.name.trim(), reason: clean });
          continue;
        }
        const key = clean.name.toLowerCase();
        if (existing.has(key)) {
          skipped.push({ line: row.line, name: clean.name, reason: SKIP_EXISTS });
          continue;
        }
        existing.add(key);
        plan.push(clean);
        const refs: [ListKind, string][] = [
          ["categories", clean.category],
          ["locations", clean.location],
          ["stores", clean.store],
        ];
        for (const [kind, value] of refs) {
          const k = value.toLowerCase();
          if (!lists[kind].has(k) && !newValues[kind].has(k)) newValues[kind].set(k, value);
        }
      }

      if (plan.length > 0) {
        const stamp = now();
        const statements: Statement[] = [];
        for (const kind of LIST_KINDS) {
          if (newValues[kind].size > 0) {
            statements.push(
              sql.importListValues(kind, JSON.stringify([...newValues[kind].values()])),
            );
          }
        }
        // Chunks keep each bound value well under the D1 limit of 2 MB.
        for (const chunk of chunks(plan, 2000)) {
          const json = JSON.stringify(chunk);
          statements.push(sql.importItems(json, stamp));
          statements.push(sql.importChanges(json, stamp));
        }
        await batch(statements);
      }
      return { added: plan.length, skipped };
    },
  };
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/**
 * Trims the row. It returns the first problem as a message, in the order
 * name, count, unit, category, location, store, notes.
 */
function cleanImportRow(row: ImportRow):
  | string
  | {
      name: string;
      count: number;
      unit: string;
      category: string;
      location: string;
      store: string;
      notes: string;
    } {
  let name: string;
  try {
    name = cleanName(row.name);
  } catch (err) {
    return err instanceof ValidationError ? (err.fields.name ?? "") : String(err);
  }
  const rawCount = row.count.trim() === "" ? "0" : row.count.trim();
  if (
    !/^[+-]?\d+$/.test(rawCount) ||
    Number(rawCount) < 0 ||
    !Number.isSafeInteger(Number(rawCount))
  ) {
    return COUNT_MESSAGE;
  }
  const { unit, message } = cleanUnit(row.unit);
  if (message) return message;

  const refs: Record<string, string> = {};
  for (const [field, value] of [
    ["category", row.category],
    ["location", row.location],
    ["store", row.store],
  ] as const) {
    if (value.trim() === "") return `Enter a ${field}.`;
    try {
      refs[field] = cleanName(value);
    } catch (err) {
      return err instanceof ValidationError ? (err.fields.name ?? "") : String(err);
    }
  }
  const { notes, message: notesMsg } = cleanNotes(row.notes);
  if (notesMsg) return notesMsg;
  return {
    name,
    count: Number(rawCount),
    unit,
    category: refs.category ?? "",
    location: refs.location ?? "",
    store: refs.store ?? "",
    notes,
  };
}

export { BelowZeroError, DuplicateError };
