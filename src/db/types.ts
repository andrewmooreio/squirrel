export type Param = string | number | null;

export interface Statement {
  sql: string;
  params?: Param[];
}

export type Row = Record<string, unknown>;

/** The result of one statement in a batch. */
export interface StatementResult {
  rows: Row[];
  /** Rows that an INSERT, UPDATE or DELETE changed. */
  changes: number;
  lastInsertId: number;
}

export type Runtime = "node" | "workers";

/** The SQL text and the migrations for one database family. */
export interface Dialect {
  name: string;
  migrations: Migration[];
  sql: DialectSql;
}

export interface Migration {
  version: number;
  name: string;
  /** One entry for each statement. A batch cannot hold a script. */
  statements: string[];
}

/** One module runs the SQL of a dialect on one runtime. */
export interface Driver {
  name: string;
  dialect: Dialect;
  runtimes: Runtime[];
  /** Runs one statement and returns its rows. */
  query(sql: string, params?: Param[]): Promise<Row[]>;
  /**
   * Runs the statements in order as one atomic unit. If one fails, none apply.
   * It returns the result of each statement.
   */
  batch(statements: Statement[]): Promise<StatementResult[]>;
  /** Turns a native error into a typed error, or returns it as it is. */
  mapError(err: unknown): unknown;
  close?(): Promise<void> | void;
}

// The SQL text is defined in the dialect. This type is filled in by dialects/sqlite/sql.ts.
export type DialectSql = typeof import("./dialects/sqlite/sql").sqliteSql;

/** The managed lists. */
export type ListKind = "categories" | "locations" | "stores";

export const LIST_KINDS: ListKind[] = ["categories", "locations", "stores"];

export interface ItemFilter {
  categoryId?: number;
  uncategorised?: boolean;
  locationId?: number;
  storeId?: number;
  search?: string;
  /** Keep the items that are on, or off, the shopping list. */
  list?: "any" | "on" | "off";
  /** "", "name-desc", "count" or "updated". Any other value sorts by name. */
  sort?: string;
}

export interface ItemFields {
  name: string;
  categoryId: number;
  locationId: number;
  storeId: number;
  notes: string;
  unit: string;
}
