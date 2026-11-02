# AGENTS.md

Squirrel is a web app that counts household stock. TypeScript, Hono, server-rendered JSX, HTMX 4, Tailwind with Basecoat, and SQLite. It runs as a Node container or on Cloudflare Workers with D1.

## Build and test

`package.json` holds the commands.

- `npm test` runs every test file in two Vitest projects: `node` (driver `node-sqlite`) and `workers` (driver `d1` in Miniflare). It runs `npm run build:static` first, because the web tests need `src/generated/build.json`, which is gitignored.
- `npm run dev` runs the app on `./tmp/squirrel.db`, which holds the developer's own data. For a throwaway run, set `DATABASE_URL` and `PORT` to a temporary file and a free port.
- `npm run dev:worker` runs the Worker locally with Wrangler.

Before you finish, run `npm run typecheck`, `npm run lint` and `npm test`. CI runs the same checks.

## Generated and vendored files

- `src/generated/` and `dist/` are build output. Do not commit them.
- Tailwind scans only `src/views` (`source(none)` in `src/static/input.css`). Put Tailwind classes in the views, or they are not built.
- Tailwind, Basecoat and HTMX come from npm at pinned versions. `scripts/build-static.mjs` copies them into `dist/assets/static`. Put custom styles in `src/static/input.css`.
- Asset URLs carry a content hash (`?v=…`) from `src/generated/build.json`.

## HTMX 4

The app uses **HTMX 4**, not HTMX 2. Event names and some attributes differ, for example `htmx:after:swap` in place of `htmx:afterSwap`. HTMX 4 sends `HX-Target` as `tag#id`. Check HTMX 4 documentation before you write `hx-*` attributes or event listeners.

## Code layout

- `src/app` is the core. It uses only web-standard `Request` and `Response`. No runtime-specific API is allowed here.
  - `store.ts` holds every data rule: atomic adjust, the count floor of zero, undo, list deletes, import. It returns typed errors (`NotFoundError`, `DuplicateError`, `BelowZeroError`, `ValidationError`).
  - `routes/` handlers are thin: parse the request, call the store, render. Each action answers two ways: an HTMX request gets a fragment, a plain form post gets a redirect or a full page. Keep both paths working. Two exceptions answer one way only: the read-only JSON API under `/api/` always answers JSON, and `POST /import` always answers a full page.
- `src/views` holds the Hono JSX components.
- `src/db` is the database layer.
  - A **dialect** (`dialects/sqlite`) holds the SQL text and the migrations for one database family.
  - A **driver** (`drivers/`) runs that SQL on one runtime. It gives `query`, an atomic `batch`, and `mapError`.
  - The core never uses an interactive transaction, because D1 has none. Write an atomic change as one batch, and let SQL do the computation.
  - The Workers entry imports `drivers/d1` only. Never import `node-sqlite` from the core or from `entry/worker.ts`.
- `src/entry/node.ts` and `src/entry/worker.ts` start the core on each host. `src/entry/drivers.ts` maps a `DATABASE_URL` scheme to a driver.
- Schema changes go in a new migration in `src/db/dialects/sqlite/migrations.ts`. Applied migrations are frozen. The app tracks them in the `schema_migrations` table.
- The app writes every timestamp itself, as `YYYY-MM-DDTHH:MM:SS.sssZ` in UTC.

## Tests

- Test through the HTTP seam first: `app.request` against a real driver, see `test/support/app.ts`. The driver comes from the `#driver` alias, so each file runs on both drivers.
- Add a driver conformance test (`test/conformance.test.ts`) only for a data rule that the HTML cannot show, such as concurrency. A new driver must pass this file.
- A test that needs a file on disk is named `*.node.test.ts` and runs in the Node project only.
- Tests use the real drivers and real migrations, and check behaviour a user or caller can observe.

## Writing style

User-facing text (README, UI copy, error messages) uses short, plain sentences: one idea per sentence, active voice, imperative for instructions. Match the README.

## Commits and releases

Commits follow Conventional Commits. release-please turns `feat:` and `fix:` into version bumps and `CHANGELOG.md` entries, so pick the type for its release effect. The version lives in `package.json`. Work on a branch and open a pull request to `main`.
