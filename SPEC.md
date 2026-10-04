# Squirrel — Spec (v1)

## Problem Statement

We buy household staples in bulk — toothpaste, tins of tomatoes, fruit & nut mix, and so on — and store them around the house. We lose track of how much of each thing we have. We find out we're out of something only when the cupboard is empty, or we buy more of something we already have plenty of.

We need a quick, shared way for everyone in the household to see how many of each item we have, and to update that number the moment we take something out or put new stock away. It must be fast enough to use one-handed on a phone in the garage, and comfortable on a desktop.

## Solution

Squirrel is a small, self-hosted web app that counts household stock. It does not decide when to buy more — the household decides that by looking at the counts.

- Every **item** has a name, a **count** of individual units, a **category**, a **location**, a **store**, and optional notes.
- **Categories**, **locations**, and **stores** are **managed lists** that the household creates, renames, and deletes in the app.
- The main screen shows items in tabs: **All**, then one tab per category. Each row has large **−1** / **+1** buttons, and the count can be tapped to type an exact number.
- Search finds items across all categories. Filter chips narrow by location and store.
- Each item keeps a short **history** of changes, and the latest change can be **undone**.
- Squirrel runs as a single Docker container with its SQLite database in a volume. It has no login; it is intended for a trusted home network, optionally behind an authenticating reverse proxy.
- Squirrel can be added to a phone home screen and opens full-screen.

## User Stories

### Viewing stock

1. As a household member, I want to see all items and their counts on one screen, so that I know what we have at a glance.
2. As a household member, I want an "All" tab, so that I can see every item regardless of category.
3. As a household member, I want one tab per category, so that I can focus on, for example, only toiletries.
4. As a household member, I want category tabs sorted by name, so that I can find a tab predictably.
5. As a household member, I want items within a view sorted by name, so that I can scan the list quickly.
6. As a household member, I want each row to show the item's name, count, and location, so that I know how many there are and where to find them.
7. As a phone user, I want the tab bar to scroll sideways when there are many categories, so that tabs never wrap or overflow the screen.
8. As a household member, I want the current tab kept in the URL, so that a page refresh or a bookmark brings me back to the same tab.
9. As a household member, I want items whose category was deleted to appear in an "Uncategorised" tab, so that no item becomes hidden.
10. As a household member, I want the "Uncategorised" tab to show only when it contains items, so that it does not clutter the screen.
11. As a household member, I want a deleted location or store to show as "—" on an item, so that I can see the value is missing.

### Searching and filtering

12. As a household member, I want a search box at the top of the main screen, so that I can find an item by typing part of its name.
13. As a household member, I want search to filter as I type, so that I do not need to press a button.
14. As a household member, I want search to look across all categories, so that I can find "tomatoes" from any tab.
15. As a household member, I want the view to switch to "All" while I search, so that results from every category are visible.
16. As a household member, I want to filter by location, so that I can see everything kept in, for example, the garage.
17. As a household member, I want to filter by store, so that I can see everything we normally buy at one shop.
18. As a household member, I want to combine search, location, and store filters, so that I can narrow the list precisely.
19. As a household member, I want to clear filters easily, so that I can get back to the full list.

### Changing counts

20. As a household member, I want a large −1 button on each row, so that I can record taking one item out with a single tap.
21. As a household member, I want a large +1 button on each row, so that I can record putting one item away with a single tap.
22. As a household member, I want the count to update in place without a full page reload, so that the app feels instant.
23. As a household member, I want the −1 button disabled when the count is 0, so that a count can never go negative.
24. As a household member, I want to tap the count and type an exact number, so that I can correct the count or record a large restock quickly.
25. As a household member, I want the exact-count input to accept only whole numbers of 0 or more, so that I cannot enter an invalid count.
26. As a household member, I want two people tapping at the same time to both be counted, so that simultaneous updates never overwrite each other.
27. As a household member, I want the list to refresh when I return to the app, so that I see changes another person made while the app was in the background.

### History and undo

28. As a household member, I want each change to an item's count to be recorded, so that I can see what happened recently.
29. As a household member, I want the item page to show the last 10 changes with their time and resulting count, so that I can check recent activity.
30. As a household member, I want an undo button on the most recent change of an item, so that I can fix an accidental tap.
31. As a household member, I want undo to restore the count to its value before that change, so that the mistake is fully reversed.
32. As a household member, I want undo available only on the latest change, so that the behaviour is simple and predictable.

### Managing items

33. As a household member, I want to add a new item from the UI, so that I can start tracking something new.
34. As a household member, I want name, category, location, and store to be required when I add an item, so that every item is fully described.
35. As a household member, I want notes to be optional, so that adding an item is quick.
36. As a household member, I want a new item's count to default to 0, so that I can add it before I have any.
37. As a household member, I want to set the starting count when I add an item, so that I can record existing stock in one step.
38. As a household member, I want to edit every field of an item, so that I can fix mistakes or move it to a new location.
39. As a household member, I want the edit form to require a new value for any field that became blank, so that items are completed the next time someone edits them.
40. As a household member, I want to delete an item, so that I can stop tracking something we no longer buy.
41. As a household member, I want to confirm before an item is deleted, so that I do not delete something by accident.
42. As a household member, I want an item's history deleted with the item, so that no orphaned data remains.
43. As a household member, I want item names to be unique, so that two rows never look the same.

### Managing lists

44. As a household member, I want one "Manage lists" screen with tabs for Categories, Locations, and Stores, so that all list management is in one place.
45. As a household member, I want to add a category, location, or store, so that I can describe new items.
46. As a household member, I want to rename a category, location, or store, so that I can fix a typo without editing every item.
47. As a household member, I want to delete a category, location, or store, so that I can tidy up values we no longer use.
48. As a household member, I want to see how many items use a list value before I delete it, so that I understand the effect.
49. As a household member, I want deleting a list value that items still use to be allowed, so that I am never blocked.
50. As a household member, I want list values within a list to be unique, so that I do not create duplicates.

### First start

51. As a new user, I want the app to start empty, so that I do not need to delete sample data.
52. As a new user, I want an empty state that tells me to create a category, a location, and a store first, so that I know how to begin.
53. As a new user, I want the "add item" action to point me to "Manage lists" until at least one of each list exists, so that I cannot get stuck on an unfillable form.

### Devices and installation

54. As a phone user, I want large touch targets, so that I can use the app one-handed.
55. As a desktop user, I want the same layout to use the extra width, so that the app is comfortable on a large screen.
56. As a phone user, I want to add Squirrel to my home screen with a squirrel icon, so that it opens like an app.
57. As a household member, I want the app to work with no internet connection on the home network, so that it does not depend on external services.
58. As a household member, I want a clean, modern UI, so that the app is pleasant to use.

### Running and operating

59. As a self-hoster, I want a single Docker image, so that I can deploy Squirrel with one container.
60. As a self-hoster, I want multi-architecture images for amd64 and arm64, so that I can run it on a NAS, a Raspberry Pi, or a server.
61. As a self-hoster, I want to set the listen host, port, and database path through environment variables, so that I can fit it into my setup.
62. As a self-hoster, I want sensible defaults for all settings, so that it works with no configuration.
63. As a self-hoster, I want the database stored in one file in a volume, so that backups are simple.
64. As a self-hoster, I want database migrations to run automatically at startup, so that upgrades need no manual steps.
65. As a self-hoster, I want a health check endpoint, so that Docker and my reverse proxy can monitor the app.
66. As a self-hoster, I want the container to run as a non-root user, so that it follows good security practice.
67. As a self-hoster, I want a README with a sample compose file and a `docker run` command, so that I can start quickly.

### Releases

68. As a self-hoster, I want versioned releases with a changelog, so that I know what changed before I upgrade.
69. As a self-hoster, I want image tags for the full version, minor version, major version, and latest, so that I can choose how closely to track updates.
70. As a self-hoster, I want a moving major-version git tag (for example `v1`), so that I can pin to a major version.
71. As a maintainer, I want versions calculated from conventional commits, so that I never set version numbers by hand.
72. As a maintainer, I want a release PR that collects unreleased changes, so that I choose when to release.
73. As a maintainer, I want every push to `main` to build an `edge` image, so that I can test unreleased changes.
74. As a contributor, I want CI to run tests, lint, and a generated-code check on every push and pull request, so that broken changes are caught early.

## Implementation Decisions

### Stack

- **Language:** Go, using the standard library `net/http` server and its method-and-path pattern router. No web framework.
- **Templates:** templ. Generated files are committed, and CI checks they are up to date.
- **Interactivity:** HTMX for in-place updates (±1, exact count, search, filters, tab switches). Minimal custom JavaScript, limited to the `visibilitychange` refresh and small UI behaviours.
- **Styling:** Tailwind CSS, built with the Tailwind standalone CLI (no Node.js), plus Basecoat for shadcn-style components (buttons, tabs, inputs, dialogs, selects, badges).
- **Database:** SQLite via `modernc.org/sqlite` (pure Go, no CGO). WAL mode and foreign keys enabled.
- **Assets:** HTMX, compiled CSS, icons, and the web app manifest are embedded in the binary. No CDN is used at runtime.
- **Dependencies:** kept minimal — templ and the SQLite driver are the only expected non-standard runtime dependencies.

### Modules

- **config** — reads environment variables and applies defaults. Interface: a single load function that returns a config value (host, port, database path) or an error for invalid values (for example a non-numeric port).
- **store** — the only module that talks to SQLite. Owns migrations and all data rules. Deep interface, roughly:
  - Items: list (with optional category, location, store, and search-text filters), get, create, update, delete.
  - Counts: adjust by a delta (+1 / −1), set an exact count, undo the latest change.
  - History: list the latest N changes for an item.
  - Managed lists (one generic interface used for categories, locations, and stores): list with usage counts, create, rename, delete.
  - Returns typed errors for "not found", "duplicate name", "validation failed", and "count would go below zero".
- **web** — HTTP handlers, routing, templ views, and embedded static assets. Handlers are thin: parse the request, call the store, render a full page or an HTMX fragment. Takes a store and returns an `http.Handler`, so tests can build the full app in-process.
- **main** — wires config, store, and web together, runs migrations, and starts the server with graceful shutdown.

### Schema

- **categories**, **locations**, **stores** — each has an integer id and a unique, non-empty name.
- **items** — integer id, unique non-empty name, count (integer, `CHECK (count >= 0)`), nullable `category_id`, `location_id`, and `store_id` (foreign keys with `ON DELETE SET NULL`), optional notes, created and updated timestamps.
- **changes** — integer id, `item_id` (foreign key with `ON DELETE CASCADE`), delta, resulting count, timestamp.
- Name uniqueness is case-insensitive and ignores leading and trailing whitespace.
- Migrations are plain SQL files, embedded, applied in order at startup, and tracked by a schema version.

### Data rules

- **Adjust** is a single atomic SQL update (`count = count + delta`) guarded by the `count >= 0` constraint, plus an insert into `changes`, in one transaction. A −1 at 0 returns the "below zero" error and changes nothing.
- **Set exact count** records a change whose delta is the difference between the new and old count. Setting the same value records nothing.
- **Undo** reverses only the most recent change of an item: it applies the negative delta and deletes that change row, in one transaction. If the result would go below zero (possible after concurrent changes), undo fails with the "below zero" error.
- **Deleting a list value** is always allowed. The database sets the matching item references to null.
- **Mandatory fields** are enforced on create and update by the store's validation, not by `NOT NULL` columns, so that deleted list values can leave items blank.
- Editing an item's fields does not create a history entry. Only count changes are recorded.

### HTTP and UI behaviour

- The main page accepts query parameters for the category tab, search text, location filter, and store filter. The URL always reflects the current view.
- HTMX requests receive HTML fragments (for example an updated row, or an updated list). Normal requests receive full pages. All actions also work as plain form posts with a redirect, so the app degrades gracefully.
- While search text is present, the view behaves as the "All" tab.
- "Uncategorised" is a tab value for items with no category. It is shown only when such items exist.
- The item page shows item details, the last 10 changes, and an undo control on the latest change only.
- Item delete and list-value delete use a confirmation dialog. The list-value dialog shows how many items use the value.
- When the user returns to the page, a `visibilitychange` listener re-fetches the current list.
- The app serves a web app manifest and icons for home-screen installation. No service worker and no offline mode.
- A `/healthz` endpoint returns success when the database is reachable.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SQUIRREL_HOST` | `0.0.0.0` | Listen address |
| `SQUIRREL_PORT` | `8080` | Listen port |
| `SQUIRREL_DB_PATH` | `/data/squirrel.db` | SQLite database file |

### Container

- Multi-stage build: generate templ, build CSS with the Tailwind standalone CLI, build a static Go binary.
- Final image based on `distroless/static`, running as a non-root user, with `/data` declared as a volume and a health check against `/healthz`.
- Images for `linux/amd64` and `linux/arm64`, published to GitHub Container Registry.

### Repository, CI, and releases

- Public repository, MIT licence, generic and friendly README with a sample compose file and a `docker run` command.
- **CI workflow** on push and pull request: `go test`, `golangci-lint`, and a check that `templ generate` produces no diff.
- **release-please** reads conventional commits, keeps a release PR open, and writes `CHANGELOG.md`. Merging the release PR creates the `vX.Y.Z` tag and a GitHub Release.
- **On a release:** build and push images tagged `X.Y.Z`, `X.Y`, `X`, and `latest`, and move the git tags `vX` and `vX.Y` to the release commit.
- **On a push to `main` without a release:** build and push images tagged `edge` and `sha-<short>` only.

## Testing Decisions

### What makes a good test

- Tests check external behaviour only: what a user or caller can observe. They do not check SQL text, internal structs, or private helpers.
- Each test builds its own fresh database in a temporary directory, so tests are independent and can run in parallel.
- Tests use the real SQLite driver and real migrations. No database mocks.
- Keep tests simple and readable. Table-driven tests where they make cases clearer.

### Seams

1. **HTTP (primary seam).** Build the full app handler in-process against a temporary database and drive it with `httptest`. Check status codes, redirects, and the presence of key content in the HTML or HTMX fragments. Follow up with a GET to confirm that a change is visible. This covers:
   - Main page tabs, including "All" and "Uncategorised".
   - Search and filters, including combined filters.
   - ±1 and exact-count actions, including the disabled −1 at 0 and rejected invalid input.
   - Item create, edit (including required fields), and delete.
   - Managed list create, rename, and delete.
   - Empty-state behaviour on first start.
   - `/healthz`.
2. **Store (secondary seam).** Test the store interface directly, only for data rules that are hard to see through HTML:
   - Atomic adjust, including many concurrent +1 calls producing the correct total.
   - The count never going below zero.
   - Set exact count recording the correct delta, and recording nothing when unchanged.
   - Undo of the latest change, and undo failing when it would go below zero.
   - Deleting a list value leaving items blank, not deleted.
   - Deleting an item deleting its history.
   - Case-insensitive name uniqueness.

**config** gets a small unit test for defaults and invalid values.

### Prior art

The repository is new, so there are no existing tests. Use standard Go testing conventions: the `testing` package, `httptest`, and `t.TempDir()` for databases. No browser end-to-end tests in v1.

## Out of Scope

- Packs, pack sizes, and unit names — Squirrel counts individual items only.
- Minimum levels, targets, low-stock alerts, and shopping lists.
- Consumption tracking or run-out predictions.
- Barcode scanning.
- Photos, prices, and expiry dates or batches.
- One item in more than one location, or with more than one store.
- Authentication, user accounts, and recording who made a change.
- Live push updates (SSE or WebSockets) and polling.
- Offline mode and service workers.
- Archiving or soft-deleting items.
- Undo of any change other than the latest one.
- Seed or sample data.
- Import and export.
- Deployment configuration for any specific server.

## Further Notes

- **Name:** Squirrel — it stores things for later. The icon is a squirrel.
- **Trust model:** Squirrel has no authentication. The README must say clearly that it is intended for a trusted network, and that remote access should go through an authenticating reverse proxy or tunnel (for example Cloudflare Tunnel with Cloudflare Access).
- **Future-friendly:** the `changes` table records every count change with a timestamp. This makes later features such as consumption rates possible without a data migration.
- **Backups:** the database is a single SQLite file in WAL mode. The README should recommend backing up the whole `/data` volume.
