import type { Driver, Runtime } from "../db/types";

interface Registered {
  runtimes: Runtime[];
  /** Loads the driver module only when it is selected. */
  load: (url: URL, rest: string) => Promise<Driver>;
}

// The registry for the Node entry. The Workers entry makes the D1 driver from
// its binding and never imports this file, so the Worker bundle has no
// Node-only driver code. To add a driver, add a scheme here.
const registry: Record<string, Registered> = {
  sqlite: {
    runtimes: ["node"],
    load: async (_url, rest) => (await import("../db/drivers/node-sqlite")).nodeSqliteDriver(rest),
  },
  d1: {
    runtimes: ["workers"],
    load: async () => {
      throw new Error("unreachable");
    },
  },
};

/** The file path in a sqlite: URL. sqlite:///data/x.db is /data/x.db. */
export function sqlitePath(databaseUrl: string): string {
  const rest = databaseUrl.replace(/^sqlite:/, "").replace(/^\/\//, "");
  if (rest === "" || rest === ":memory:") return ":memory:";
  return rest;
}

/** Selects and loads the driver for DATABASE_URL on the current runtime. */
export async function selectDriver(databaseUrl: string, runtime: Runtime): Promise<Driver> {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(databaseUrl);
  const scheme = m?.[1]?.toLowerCase() ?? "";
  const entry = registry[scheme];
  if (!entry) {
    throw new Error(
      `DATABASE_URL has an unknown scheme "${scheme}". Use one of: ${Object.keys(registry).join(", ")}.`,
    );
  }
  if (!entry.runtimes.includes(runtime)) {
    throw new Error(`The ${scheme} driver does not run on ${runtime}.`);
  }
  return entry.load(new URL("sqlite://x"), sqlitePath(databaseUrl));
}
