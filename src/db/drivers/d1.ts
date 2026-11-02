import { sqliteDialect } from "../dialects/sqlite";
import { BelowZeroError, DuplicateError } from "../errors";
import type { Driver, Row, Statement, StatementResult } from "../types";

/** Runs the SQLite dialect on a Cloudflare D1 binding. */
export function d1Driver(binding: D1Database): Driver {
  const prepare = (s: Statement) => binding.prepare(s.sql).bind(...(s.params ?? []));
  return {
    name: "d1",
    dialect: sqliteDialect,
    runtimes: ["workers"],
    async query(sql, params = []) {
      const r = await prepare({ sql, params }).all<Row>();
      return r.results;
    },
    async batch(statements: Statement[]) {
      if (statements.length === 0) return [];
      const results = await binding.batch<Row>(statements.map(prepare));
      return results.map(
        (r): StatementResult => ({
          rows: r.results ?? [],
          changes: r.meta?.changes ?? 0,
          lastInsertId: r.meta?.last_row_id ?? 0,
        }),
      );
    },
    mapError(err) {
      // D1 gives message strings, for example "UNIQUE constraint failed: items.name".
      const msg = String((err as Error)?.message ?? err);
      const cause = String(((err as Error)?.cause as Error | undefined)?.message ?? "");
      const text = `${msg} ${cause}`;
      if (/UNIQUE constraint failed/.test(text)) return new DuplicateError();
      if (/CHECK constraint failed:[^:]*\bcount\b/.test(text)) return new BelowZeroError();
      return err;
    },
  };
}
