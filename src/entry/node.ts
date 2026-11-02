import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "../app/app";
import { ensureMigrated } from "../db/migrate";
import build from "../generated/build.json";
import { diskAssets } from "./assets";
import { loadConfig } from "./config";
import { selectDriver } from "./drivers";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  const config = loadConfig();
  const driver = await selectDriver(config.databaseUrl, "node");
  await ensureMigrated(driver);

  const app = createApp({
    driver,
    version: build.version,
    assets: diskAssets(fileURLToPath(new URL("../assets/static/", import.meta.url))),
  });
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(
      `squirrel ${build.version}: listening on ${config.host}:${info.port}, database ${config.databaseUrl}`,
    );
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log("squirrel: shutting down");
    const timer = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    server.close(async () => {
      await driver.close?.();
      process.exit(0);
    });
    (server as unknown as Server).closeIdleConnections?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
