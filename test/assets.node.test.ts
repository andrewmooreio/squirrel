import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/app";
import { nodeSqliteDriver } from "../src/db/drivers/node-sqlite";
import { diskAssets } from "../src/entry/assets";
import { newApp } from "./support/app";

describe("static assets on Node", () => {
  const assets = diskAssets("dist/assets/static");
  const app = createApp({ driver: nodeSqliteDriver(":memory:"), version: "dev", assets });

  it("serves every asset", async () => {
    for (const p of [
      "/static/app.css",
      "/static/app.js",
      "/static/vendor/htmx.min.js",
      "/static/icon.svg",
      "/static/icons/icon-192.png",
      "/static/icons/icon-512.png",
      "/static/icons/apple-touch-icon.png",
    ]) {
      expect((await app.request(p)).status, p).toBe(200);
    }
  });

  it("caches a hashed URL for a year, and revalidates the rest", async () => {
    const hashed = await app.request("/static/app.js?v=abc");
    expect(hashed.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const plain = await app.request("/static/app.js");
    expect(plain.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("does not leave the static directory", async () => {
    expect((await app.request("/static/..%2Fnode/server.js")).status).toBe(404);
    expect((await app.request("/static/nope.css")).status).toBe(404);
  });

  it("answers 404 when the host has no asset server", async () => {
    expect((await (await newApp()).get("/static/app.css")).status).toBe(404);
  });
});
