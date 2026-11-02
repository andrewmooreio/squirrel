import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/entry/config";

describe("config", () => {
  it("uses defaults, and treats an empty value as unset", () => {
    const want = { host: "0.0.0.0", port: 8080, databaseUrl: "sqlite:///data/squirrel.db" };
    expect(loadConfig({})).toEqual(want);
    expect(loadConfig({ HOST: "", PORT: "", DATABASE_URL: "" })).toEqual(want);
  });

  it("applies overrides", () => {
    expect(
      loadConfig({ HOST: "127.0.0.1", PORT: "9000", DATABASE_URL: "sqlite:///tmp/s.db" }),
    ).toEqual({
      host: "127.0.0.1",
      port: 9000,
      databaseUrl: "sqlite:///tmp/s.db",
    });
  });

  it("ignores the old SQUIRREL_ variables", () => {
    expect(loadConfig({ SQUIRREL_PORT: "9000", SQUIRREL_DB_PATH: "/x.db" })).toMatchObject({
      port: 8080,
      databaseUrl: "sqlite:///data/squirrel.db",
    });
  });

  it.each(["abc", "0", "65536", "-1", "80x"])("refuses the port %s", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });
});
