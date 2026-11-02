import type { Dialect } from "../../types";
import { sqliteMigrations } from "./migrations";
import { sqliteSql } from "./sql";

export const sqliteDialect: Dialect = {
  name: "sqlite",
  migrations: sqliteMigrations,
  sql: sqliteSql,
};
