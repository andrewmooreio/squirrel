// Builds the static assets into dist/static and writes src/generated/build.json.
// The JSON holds the version and a content hash for each asset.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = "dist/assets/static";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/vendor`, { recursive: true });

execFileSync(
  "node_modules/.bin/tailwindcss",
  ["-i", "src/static/input.css", "-o", `${out}/app.css`, "--minify"],
  { stdio: "inherit" },
);
cpSync("src/static/app.js", `${out}/app.js`);
cpSync("src/static/icon.svg", `${out}/icon.svg`);
cpSync("src/static/icons", `${out}/icons`, { recursive: true });
cpSync("node_modules/htmx.org/dist/htmx.min.js", `${out}/vendor/htmx.min.js`);

const hash = (file) =>
  createHash("sha256")
    .update(readFileSync(`${out}/${file}`))
    .digest("hex")
    .slice(0, 10);
const assets = Object.fromEntries(
  ["app.css", "app.js", "vendor/htmx.min.js"].map((f) => [f, hash(f)]),
);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = process.env.VERSION || pkg.version;

mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/build.json", `${JSON.stringify({ version, assets }, null, 2)}\n`);
