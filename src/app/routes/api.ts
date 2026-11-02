import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ItemFilter } from "../../db/types";
import { NotFoundError } from "../errors";
import type { Deps } from "../http";
import { pathIdOf } from "../http";
import type { Item } from "../store";
import { atoi } from "../validate";

/** An item as the JSON API shows it. A blank list field is null. */
function apiItem(it: Item) {
  return {
    id: it.id,
    name: it.name,
    count: it.count,
    unit: it.unit,
    category: it.categoryName || null,
    location: it.locationName || null,
    store: it.storeName || null,
    notes: it.notes,
    on_list: it.onList,
    updated_at: rfc3339Nano(it.updatedAt),
  };
}

/** RFC 3339 in UTC. Trailing zeros of the fraction are cut, as in version 1. */
function rfc3339Nano(iso: string): string {
  return new Date(iso).toISOString().replace(/\.?0+Z$/, "Z");
}

export function apiError(c: Context, status: number, msg: string) {
  c.header("Cache-Control", "no-store");
  return c.json({ error: msg }, status as ContentfulStatusCode);
}

const json = (c: Context, body: unknown) => {
  c.header("Cache-Control", "no-store");
  return c.json(body as object, 200);
};

/** Reads an optional id query parameter. Blank means no filter. */
function apiId(c: Context, name: string): number | null {
  const v = (c.req.query(name) ?? "").trim();
  if (v === "") return 0;
  const n = atoi(v);
  return n !== null && n >= 0 ? n : null;
}

export function apiRoutes(app: Hono, d: Deps) {
  app.get("/api/items", async (c) => {
    const f: ItemFilter = { search: c.req.query("q") ?? "", sort: c.req.query("sort") ?? "" };
    if ((c.req.query("category") ?? "").trim() === "none") {
      f.uncategorised = true;
    } else {
      const id = apiId(c, "category");
      if (id === null) return apiError(c, 400, "Invalid category.");
      f.categoryId = id;
    }
    const loc = apiId(c, "location");
    if (loc === null) return apiError(c, 400, "Invalid location.");
    f.locationId = loc;
    const store = apiId(c, "store");
    if (store === null) return apiError(c, 400, "Invalid store.");
    f.storeId = store;

    switch ((c.req.query("on_list") ?? "").trim().toLowerCase()) {
      case "":
        break;
      case "1":
      case "true":
        f.list = "on";
        break;
      case "0":
      case "false":
        f.list = "off";
        break;
      default:
        return apiError(c, 400, "Invalid on_list.");
    }
    const items = await d.store.listItems(f);
    return json(c, { items: items.map(apiItem) });
  });

  app.get("/api/items/:id", async (c) => {
    const id = pathIdOf(c, "id");
    if (id === null) return apiError(c, 404, "Not found.");
    try {
      return json(c, apiItem(await d.store.getItem(id)));
    } catch (err) {
      if (err instanceof NotFoundError) return apiError(c, 404, "Not found.");
      throw err;
    }
  });

  // A known API path sent with a method other than GET.
  const readOnly = (c: Context) => {
    c.header("Allow", "GET, HEAD");
    return apiError(c, 405, "Method not allowed.");
  };
  app.all("/api/items", readOnly);
  app.all("/api/items/:id", readOnly);

  // The catch-all for /api/, so API clients never get HTML.
  app.all("/api/*", (c) => apiError(c, 404, "Not found."));
}
