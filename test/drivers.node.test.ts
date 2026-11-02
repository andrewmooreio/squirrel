import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectDriver, sqlitePath } from "../src/entry/drivers";

describe("driver selection", () => {
  it("reads the path from a sqlite URL", () => {
    expect(sqlitePath("sqlite:///data/squirrel.db")).toBe("/data/squirrel.db");
    expect(sqlitePath("sqlite://./tmp/x.db")).toBe("./tmp/x.db");
    expect(sqlitePath("sqlite://:memory:")).toBe(":memory:");
  });

  it("opens a database in a directory that does not exist yet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squirrel-"));
    const driver = await selectDriver(`sqlite://${join(dir, "new", "dir", "s.db")}`, "node");
    expect(driver.name).toBe("node-sqlite");
    expect(await driver.query("SELECT 1 AS one")).toEqual([{ one: 1 }]);
    driver.close?.();
  });

  it("names the driver and the runtime when the driver cannot run here", async () => {
    await expect(selectDriver("d1://squirrel", "node")).rejects.toThrow(
      "The d1 driver does not run on node.",
    );
    await expect(selectDriver("sqlite:///x.db", "workers")).rejects.toThrow(
      "The sqlite driver does not run on workers.",
    );
  });

  it("refuses an unknown scheme", async () => {
    await expect(selectDriver("postgres://localhost/db", "node")).rejects.toThrow(
      /unknown scheme "postgres"/,
    );
  });
});
