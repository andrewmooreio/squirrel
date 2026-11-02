import type { Driver } from "./types";

const pending = new WeakMap<Driver, Promise<void>>();

/**
 * Applies any migration that is not applied yet. The work runs once for each
 * driver. A failure is not kept, so the next call tries again.
 */
export function ensureMigrated(driver: Driver): Promise<void> {
  let p = pending.get(driver);
  if (!p) {
    p = migrate(driver).catch((err) => {
      pending.delete(driver);
      throw err;
    });
    pending.set(driver, p);
  }
  return p;
}

async function migrate(driver: Driver): Promise<void> {
  const { sql, migrations } = driver.dialect;
  const run = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      throw driver.mapError(err);
    }
  };

  await run(() => driver.query(sql.createMigrationsTable));
  const rows = await run(() => driver.query(sql.appliedMigrations));
  const applied = new Set(rows.map((r) => Number(r.version)));

  if (applied.size === 0) {
    // A 1.x database tracked its version in PRAGMA user_version. Seed the
    // table from it once. Some hosts do not support the pragma.
    let legacy = 0;
    try {
      const v = await driver.query(sql.userVersion);
      legacy = Number(v[0]?.user_version ?? 0);
    } catch {
      legacy = 0;
    }
    const seed = migrations.filter((m) => m.version <= legacy);
    if (seed.length > 0) {
      await run(() =>
        driver.batch(seed.map((m) => sql.recordMigration(m.version, new Date().toISOString()))),
      );
      for (const m of seed) applied.add(m.version);
    }
  }

  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const m of ordered) {
    if (applied.has(m.version)) continue;
    try {
      await driver.batch([
        ...m.statements.map((s) => ({ sql: s })),
        sql.recordMigration(m.version, new Date().toISOString()),
      ]);
    } catch (err) {
      // Another isolate may have applied it first. If so, carry on.
      const now = await run(() => driver.query(sql.appliedMigrations));
      if (now.some((r) => Number(r.version) === m.version)) continue;
      throw new Error(`migration ${m.name}: ${(driver.mapError(err) as Error).message}`);
    }
  }
}
