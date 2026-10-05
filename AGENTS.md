# AGENTS.md

Squirrel is a self-hosted web app that counts household stock. Go `net/http`, templ, HTMX, Tailwind with Basecoat, and SQLite. One binary with every asset embedded.

## Build and test

The `Makefile` holds the commands. Two of them carry a trap:

- `make test` needs `internal/web/static/app.css`, which is gitignored. Run `make css` first in a fresh checkout, or the web tests fail on the missing stylesheet.
- `make run` uses `./tmp/squirrel.db`, which holds the developer's own data. For a throwaway run, set `SQUIRREL_DB_PATH` and `SQUIRREL_PORT` to a temporary file and a free port.

Before you finish, run `make generate`, `make css`, `make test` and `make lint`. CI runs the same checks.

## Generated and vendored files

- `*_templ.go` files are generated from `*.templ` and **committed**. After you edit a `.templ` file, run `make generate` and commit both files. CI fails if they drift.
- Tailwind scans only `internal/web/views` (`source(none)` in `internal/web/css/input.css`). Put Tailwind classes in the views package, or they are not built.
- `internal/web/css/basecoat/` and `internal/web/static/vendor/` are vendored copies. Put custom styles in `internal/web/css/input.css`.

## HTMX 4

The app vendors **HTMX 4**, not HTMX 2. Event names and some attributes differ, for example `htmx:after:swap` in place of `htmx:afterSwap`. Check HTMX 4 documentation before you write `hx-*` attributes or event listeners.

## Code layout

- `internal/store` is the only package that talks to SQLite. Every data rule lives here: atomic adjust, the count floor of zero, undo, list deletes. It returns typed errors (`ErrNotFound`, `ErrDuplicate`, `ErrBelowZero`, `*ValidationError`).
- `internal/web` handlers are thin: parse the request, call the store, render. Each action answers two ways: an HTMX request gets a fragment, a plain form post gets a redirect or a full page. Keep both paths working. Two exceptions answer one way only: the read-only JSON API under `/api/` always answers JSON, and `POST /import` (a file upload) always answers a full page.
- Schema changes go in a new file `internal/store/migrations/NNNN_name.sql`. Applied migrations are frozen; the version is tracked in `PRAGMA user_version`.

## Tests

- Test through the HTTP seam first: `web.New` against a real store in `t.TempDir()`, driven by `httptest`. See the helpers at the top of `internal/web/web_test.go`.
- Add a store test only for a data rule that the HTML cannot show, such as concurrency.
- Tests use the real SQLite driver and real migrations, and check behaviour a user or caller can observe.

## Writing style

User-facing text (README, UI copy, error messages) uses short, plain sentences: one idea per sentence, active voice, imperative for instructions. Match the README.

## Commits and releases

Commits follow Conventional Commits. release-please turns `feat:` and `fix:` into version bumps and `CHANGELOG.md` entries, so pick the type for its release effect. Work on a branch and open a pull request to `main`.
