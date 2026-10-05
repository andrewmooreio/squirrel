# 🐿️ Squirrel

Squirrel is a small, self-hosted web app that counts the stock in your house.

You buy toothpaste, tinned tomatoes and fruit & nut mix in bulk, and you put it all over the house. Squirrel tells everyone in the household how many of each thing is left. Tap **−1** when you take one out. Tap **+1** when you put one away.

Squirrel does not decide when to buy more. You look at the counts and decide.

<p align="center">
  <img src="docs/screenshot.png" alt="Squirrel on a phone. Links to the shopping list and Manage lists at the top, then search, filters and a sort menu. Below is a list of household items such as basmati rice, bin bags and olive oil, each with a cart button, a −1 button, a count and a +1 button. Olive oil and shampoo are on the shopping list." width="320">
</p>

## Features

- A list of items with large **−1** and **+1** buttons, made for one hand on a phone.
- Tap a count to type an exact number.
- Tabs for **All** and for each category, plus search and filters for location and store.
- Sort from A to Z or Z to A, by lowest count first, or by the most recent change.
- A **Shopping list**. Tap the cart on an item to add it. Tap it again when you buy it. The list groups items by store.
- Every change is recorded. See the last 10 changes of an item and **undo** the latest one.
- Categories, locations and stores are lists that you manage in the app.
- Export your items to a CSV file, and import items from one.
- Works on a phone and on a desktop. Add it to your home screen for a full-screen app.
- A read-only JSON API for dashboards and home automation, for example Home Assistant.
- One small container. One SQLite file. No internet needed at runtime.

## Security: read this first

> [!WARNING]
> **Squirrel has no login.** Anyone who can reach it can read and change your stock.
> Run it on a trusted home network only.
>
> To use it away from home, put it behind a reverse proxy or tunnel that signs people in. For example, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/). Do not open the port to the internet.

## Quick start

### Docker Compose

Save this as `docker-compose.yml`, then run `docker compose up -d`.

```yaml
services:
  squirrel:
    image: ghcr.io/andrewmooreio/squirrel:latest
    container_name: squirrel
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - squirrel-data:/data

volumes:
  squirrel-data:
```

### Docker run

```sh
docker run -d \
  --name squirrel \
  --restart unless-stopped \
  -p 8080:8080 \
  -v squirrel-data:/data \
  ghcr.io/andrewmooreio/squirrel:latest
```

Open <http://localhost:8080>.

### First start

Squirrel starts empty. Before you add an item, open **Manage lists** and create at least one category, one location and one store. Then add your first item.

If your items are in a spreadsheet, import them instead. Read [Import and export](#import-and-export).

## Import and export

Open **Manage lists**, then **Import and export**.

**Export CSV** downloads every item. Use it to move your items to a new install or to edit them in a spreadsheet.

To import, choose a CSV file of 1 MB or less. The first row names the columns:

```csv
name,count,category,location,store,notes
Tinned tomatoes,24,Food,Pantry,Costco,
Bin bags,9,Cleaning,Under the stairs,Costco,Black ones
```

- `name`, `category`, `location` and `store` are required. `count` and `notes` are optional. A blank count is 0.
- The columns can be in any order. Squirrel ignores other columns.
- Squirrel creates a category, location or store that does not exist yet.
- An import only adds items. If an item with the same name exists, Squirrel skips the row and does not change the item.
- Squirrel also skips a row with a problem, for example a missing category. The result page lists each skipped row with its line number and the reason.

## Configuration

Set these environment variables on the container. All of them are optional.

| Variable           | Default             | Meaning                     |
| ------------------ | ------------------- | --------------------------- |
| `SQUIRREL_HOST`    | `0.0.0.0`           | Address to listen on        |
| `SQUIRREL_PORT`    | `8080`              | Port to listen on           |
| `SQUIRREL_DB_PATH` | `/data/squirrel.db` | Path of the SQLite database |

If you change `SQUIRREL_PORT`, change the port mapping too. The container runs as a non-root user (UID 65532), so a folder that you mount at `/data` must be writable by that user.

## Image tags

Images are built for `linux/amd64` and `linux/arm64`. They run on a server, a NAS or a Raspberry Pi.

| Tag                 | What it is                                     |
| ------------------- | ---------------------------------------------- |
| `1.2.3`             | One exact release                              |
| `1.2`               | The newest `1.2.x` release                     |
| `1`                 | The newest `1.x.x` release                     |
| `latest`            | The newest release                             |
| `edge`              | The newest commit on `main`, not yet released  |
| `sha-<short>`       | One exact commit on `main`                     |

To avoid surprises, pin to `1` or `1.2`. Read the [changelog](CHANGELOG.md) before you upgrade. Database changes run by themselves when the container starts.

The version shows at the bottom of every page, for example `v1.1.0`. An `edge` image shows `edge-` and the commit.

## Backups

Squirrel keeps everything in one SQLite file, in WAL mode, in the `/data` volume.

Back up the **whole `/data` volume**, not only `squirrel.db`. In WAL mode, recent changes can be in the `-wal` file next to it.

For the safest backup, stop the container first:

```sh
docker compose stop squirrel
docker run --rm -v squirrel-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/squirrel-backup.tar.gz -C /data .
docker compose start squirrel
```

To restore, stop the container and unpack the archive into the volume.

A [CSV export](#import-and-export) is not a full backup, because it has no history. Back up the `/data` volume for that.

## Health check

`GET /healthz` returns `200 ok` when the database is reachable. The image already uses it for its Docker health check. You can also point your reverse proxy or monitoring at it.

## JSON API

Squirrel has a read-only JSON API. Use it for dashboards and home automation. It cannot change your stock.

> [!WARNING]
> The API has no login, like the rest of Squirrel. Anyone who can reach Squirrel can read it. Read [Security](#security-read-this-first).

| Endpoint                | Returns                      |
| ----------------------- | ---------------------------- |
| `GET /api/items`        | A list of items              |
| `GET /api/items/{id}`   | One item                     |

`GET /api/items` takes these query parameters. All of them are optional.

| Parameter  | Meaning                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| `q`        | Search in the name                                                                        |
| `category` | A category id, or `none` for items without a category                                     |
| `location` | A location id                                                                             |
| `store`    | A store id                                                                                |
| `sort`     | `name-desc` (Z to A), `count` (lowest first) or `updated` (newest first). Default: A to Z |
| `on_list`  | `1` for items on the shopping list, `0` for items off it                                  |

To find an id, use the main page. Click a category tab, or choose a location or store filter. The address bar then shows the id, for example `?tab=3`, `?loc=2` or `?store=1`. The id of an item is in the address of its page, for example `/items/7`.

```sh
curl 'http://localhost:8080/api/items?sort=count'
```

```json
{
  "items": [
    {
      "id": 1,
      "name": "Tinned tomatoes",
      "count": 3,
      "category": "Food",
      "location": "Garage",
      "store": "Costco",
      "notes": "",
      "on_list": false,
      "updated_at": "2026-10-05T09:40:33Z"
    }
  ]
}
```

A list field that is blank is `null`. Times are UTC. An empty list is `[]`.

Errors are JSON, for example `{"error":"Not found."}`. An unknown item gives `404`. An id that is not a number gives `400`.

## Development

You need Go. The Makefile downloads the Tailwind CLI and `golangci-lint` into `./bin`. You do not need Node.js.

```sh
make run        # generate templ code, build the CSS, run on :8080 with ./tmp/squirrel.db
make test       # run all tests
make lint       # run golangci-lint
make generate   # run templ generate (commit the result)
make css        # rebuild the stylesheet
make build      # build ./bin/squirrel, with the version from git describe
```

The stack is Go (`net/http`), [templ](https://templ.guide), [HTMX](https://htmx.org), [Tailwind CSS](https://tailwindcss.com) with [Basecoat](https://basecoatui.com), and SQLite through [`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite). All assets are embedded in the binary.

Commits follow [Conventional Commits](https://www.conventionalcommits.org). Releases and version numbers come from them through [release-please](https://github.com/googleapis/release-please).

## Licence

[MIT](LICENSE)
