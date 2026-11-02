import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { sqliteDialect } from "../dialects/sqlite";
import { BelowZeroError, DuplicateError } from "../errors";
import type { Driver, Param, Row, Statement, StatementResult } from "../types";

// SQLite extended result codes.
const CONSTRAINT_CHECK = 275;
const CONSTRAINT_UNIQUE = 2067;

/** Opens the SQLite file at path. Use ":memory:" for a throwaway database. */
export function nodeSqliteDriver(path: string): Driver {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");

  const run = (stmt: StatementSync, params: Param[]): StatementResult => {
    if (stmt.columns().length > 0) {
      return { rows: stmt.all(...params) as Row[], changes: 0, lastInsertId: 0 };
    }
    const r = stmt.run(...params);
    return { rows: [], changes: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  };

  return {
    name: "node-sqlite",
    dialect: sqliteDialect,
    runtimes: ["node"],
    async query(sql, params = []) {
      return db.prepare(sql).all(...params) as Row[];
    },
    async batch(statements: Statement[]) {
      // The calls below do not yield, so no other request runs in between.
      // IMMEDIATE takes the write lock up front, for other processes.
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = statements.map((s) => run(db.prepare(s.sql), s.params ?? []));
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    mapError(err) {
      const e = err as { errcode?: number; message?: string };
      if (e.errcode === CONSTRAINT_UNIQUE) {
        return new DuplicateError();
      }
      if (e.errcode === CONSTRAINT_CHECK && /count/.test(e.message ?? "")) {
        return new BelowZeroError();
      }
      return err;
    },
    close() {
      db.close();
    },
  };
}
