// Bundles the Node entry and the health check script into dist/node.
import { build } from "esbuild";

await build({
  entryPoints: { server: "src/entry/node.ts", healthcheck: "src/entry/healthcheck.ts" },
  outdir: "dist/node",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["node:*"],
  minify: false,
  sourcemap: false,
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
});
