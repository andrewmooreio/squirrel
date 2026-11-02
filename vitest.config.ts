import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const support = (name: string) => fileURLToPath(new URL(`./test/support/${name}`, import.meta.url));

// Every test file runs in two projects. The alias "#driver" picks the driver
// under test: node-sqlite on Node, d1 in Miniflare.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { "#driver": support("driver.node.ts") } },
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: { "#driver": support("driver.d1.ts") } },
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
          }),
        ],
        test: {
          name: "workers",
          include: ["test/**/*.test.ts"],
          // Tests that need a file on disk run in the Node project only.
          exclude: ["test/**/*.node.test.ts"],
        },
      },
    ],
  },
});
